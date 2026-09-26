import { Constants, CONTEXT_COUNTER_CONTRACT_VERSION } from 'librechat-data-provider';
import type {
  TMessage,
  TContextBudget,
  TResponseUsage,
  TContextOccupied,
  TContextUsageEvent,
  TContextSessionUsage,
  TContextLastCallMeasurement,
} from 'librechat-data-provider';
import { groupToolTokens, normalizeTokenCount } from '~/utils/tokens';

/**
 * §7 «перезагрузка — из снапшота» without a new persistence layer: the send
 * pipeline already saves a pre-invoke context snapshot reconciled with the
 * primary call's provider usage on `responseMessage.metadata.contextUsage`,
 * and the per-response usage rollup on `metadata.usage`. This module maps
 * both onto the v2 contract for the branch root → `leafId`.
 */
export type BranchSnapshot = {
  lastCall: TContextLastCallMeasurement | null;
  sessionUsage: TContextSessionUsage | null;
};

function readContextUsage(message: TMessage): TContextUsageEvent | null {
  const blob = message.metadata?.contextUsage;
  if (blob == null || typeof blob !== 'object') {
    return null;
  }
  const event = blob as TContextUsageEvent;
  return event.breakdown != null && typeof event.breakdown === 'object' ? event : null;
}

function readResponseUsage(message: TMessage): TResponseUsage | null {
  const usage = message.metadata?.usage;
  if (usage == null || typeof usage !== 'object') {
    return null;
  }
  return usage as TResponseUsage;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function budgetOf(snapshot: TContextUsageEvent): TContextBudget {
  const window = normalizeTokenCount(snapshot.breakdown.maxContextTokens) || null;
  const budget =
    snapshot.contextBudget != null ? normalizeTokenCount(snapshot.contextBudget) : window;
  return {
    window,
    reserve: window != null && budget != null ? Math.max(0, window - budget) : 0,
    inputLimit: null,
    budget,
  };
}

/**
 * Splits the snapshot breakdown into the §5 `●` segments. Built-in tool
 * schemas and skills stay inside `systemPrompt`; only MCP schemas move to
 * `mcpTools`; the retained summary counts under `messages` (A's contract).
 */
function compositionOf(snapshot: TContextUsageEvent, input: number): TContextOccupied {
  const { breakdown } = snapshot;
  const instructions = normalizeTokenCount(
    snapshot.effectiveInstructionTokens ?? breakdown.instructionTokens,
  );
  const groups = groupToolTokens(breakdown.toolTokenCounts, breakdown.deferredToolNames);
  const mcpTools = Math.min(groups.mcp + groups.mcpDeferred, instructions);
  const messageTokens = normalizeTokenCount(breakdown.messageTokens);
  const toolCalls = Math.min(normalizeTokenCount(breakdown.toolMessageTokens), messageTokens);
  const known = instructions + messageTokens + normalizeTokenCount(breakdown.summaryTokens);
  return {
    messages: messageTokens - toolCalls + normalizeTokenCount(breakdown.summaryTokens),
    toolCalls,
    systemPrompt: instructions - mcpTools,
    mcpTools,
    attachments: 0,
    other: Math.max(0, input - known),
  };
}

function toLastCall(
  conversationId: string,
  leafId: string,
  message: TMessage,
  snapshot: TContextUsageEvent,
  now: number,
): TContextLastCallMeasurement {
  const budget = budgetOf(snapshot);
  /** `provider` is written only by the provider-usage reconcile step, so its
   *  presence proves the prompt total came from the provider (§10.5). */
  const reconciled = snapshot.provider != null || snapshot.model != null;
  const remaining =
    snapshot.remainingContextTokens != null
      ? normalizeTokenCount(snapshot.remainingContextTokens)
      : null;
  const estimatedInput =
    normalizeTokenCount(
      snapshot.effectiveInstructionTokens ?? snapshot.breakdown.instructionTokens,
    ) +
    normalizeTokenCount(snapshot.breakdown.messageTokens) +
    normalizeTokenCount(snapshot.breakdown.summaryTokens);
  const input =
    reconciled && budget.budget != null && remaining != null
      ? Math.max(0, budget.budget - remaining)
      : estimatedInput;
  const composition = compositionOf(snapshot, input);
  const compositionSum =
    composition.messages +
    composition.toolCalls +
    composition.systemPrompt +
    composition.mcpTools +
    composition.attachments +
    composition.other;
  const cacheRead = normalizeTokenCount(snapshot.cacheRead);
  const cacheWrite = normalizeTokenCount(snapshot.cacheWrite);
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId,
    branchLeafId: leafId,
    callId: snapshot.runId ?? message.messageId,
    responseMessageId: message.messageId,
    measuredAt: parseTimestamp(message.updatedAt) ?? parseTimestamp(message.createdAt) ?? now,
    configuration: {
      endpoint: message.endpoint ?? undefined,
      provider: snapshot.provider,
      model: snapshot.model ?? message.model ?? undefined,
      agentId: snapshot.agentId ?? null,
    },
    source: reconciled ? 'provider' : 'server_estimate',
    complete: reconciled,
    budget,
    input,
    output: normalizeTokenCount(snapshot.completedOutputTokens),
    cacheRead,
    cacheWrite,
    composition,
    compositionSource: 'server_estimate',
    compositionMismatch: compositionSum !== input || cacheRead + cacheWrite > input,
  };
}

/**
 * Walks root → leaf once, summing the per-response usage rollups into
 * `sessionUsage` and taking the deepest reconciled snapshot as `lastCall`.
 * Only this branch is read — a sibling's snapshot never leaks in (§10.11).
 */
export function deriveBranchSnapshot(
  conversationId: string,
  messages: readonly TMessage[] | null | undefined,
  leafId: string | null | undefined,
  now: number = Date.now(),
): BranchSnapshot {
  if (messages == null || messages.length === 0 || !leafId) {
    return { lastCall: null, sessionUsage: null };
  }
  const byId = new Map<string, TMessage>();
  for (const message of messages) {
    if (message?.messageId) {
      byId.set(message.messageId, message);
    }
  }

  let lastCall: TContextLastCallMeasurement | null = null;
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let calls = 0;
  let lastEventId: string | undefined;
  let currentId: string | null | undefined = leafId;
  let guard = byId.size;

  while (currentId && currentId !== Constants.NO_PARENT && guard-- > 0) {
    const message = byId.get(currentId);
    if (message == null) {
      break;
    }
    if (message.isCreatedByUser !== true) {
      const usage = readResponseUsage(message);
      if (usage != null) {
        input += normalizeTokenCount(usage.input);
        output += normalizeTokenCount(usage.output);
        cacheRead += normalizeTokenCount(usage.cacheRead);
        cacheWrite += normalizeTokenCount(usage.cacheWrite);
        calls += 1;
        lastEventId ??= message.messageId;
      }
      if (lastCall == null) {
        const snapshot = readContextUsage(message);
        if (snapshot != null) {
          lastCall = toLastCall(conversationId, leafId, message, snapshot, now);
        }
      }
    }
    currentId = message.parentMessageId;
  }

  const sessionUsage: TContextSessionUsage | null =
    calls > 0
      ? {
          version: CONTEXT_COUNTER_CONTRACT_VERSION,
          conversationId,
          branchLeafId: leafId,
          scope: 'branch',
          input,
          output,
          cacheRead,
          cacheWrite,
          calls,
          complete: true,
          cacheSplittable: true,
          updatedAt: now,
          lastEventId,
        }
      : null;

  return { lastCall, sessionUsage };
}
