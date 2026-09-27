import {
  Constants,
  computeContextBudget,
  emptyContextOccupied,
  CONTEXT_COUNTER_CONTRACT_VERSION,
} from 'librechat-data-provider';
import type {
  TContextOccupied,
  TContextConfiguration,
  TContextExclusionPlan,
  TContextEstimateStatus,
  TContextExcludedMessage,
  TContextIncompleteReason,
  TContextNextRequestEstimate,
} from 'librechat-data-provider';
import type { ContextUsageEvent } from '@librechat/agents';

/** The subset of a stored message row the exclusion popover needs (§4). */
export type EstimateSourceMessage = {
  messageId: string;
  isCreatedByUser?: boolean;
  role?: string;
  text?: string | null;
  content?: unknown;
  tokenCount?: number;
  createdAt?: string | Date;
};

/** A formatted (LangChain) message as far as the plan cares: its source row. */
export type EstimateFormattedMessage = {
  additional_kwargs?: Record<string, unknown>;
};

export type ComposeEstimateParams = {
  identity: { conversationId: string; branchLeafId: string };
  revision: number;
  fingerprint: string;
  computedAt: number;
  configuration: TContextConfiguration;
  /** W — the model window the initialized agent resolved; `null` when unknown. */
  window: number | null;
  /** R — the output reserve subtracted from the window. */
  outputReserve: number;
  /** SDK projection of the branch under the run's own pruner; `null` without a tokenizer/window. */
  usage: ContextUsageEvent | null;
  /** Graph input in send order, as handed to the SDK. */
  formattedMessages: readonly EstimateFormattedMessage[];
  /** Branch rows in send order (the draft is not one of them). */
  sourceMessages: readonly EstimateSourceMessage[];
  /** Raw tokens the current turn's attachments add to the draft message. */
  draftAttachmentTokens: number;
  /** Whether Send would summarize over-budget history instead of dropping it. */
  summarizationEnabled: boolean;
  incompleteReasons: readonly TContextIncompleteReason[];
  maxExcludedPreviews: number;
};

const PREVIEW_MAX_CHARS = 80;

function isMcpToolName(name: string): boolean {
  return name.includes(Constants.mcp_delimiter);
}

function sumMcpSchemaTokens(toolTokenCounts: Record<string, number> | undefined): number {
  if (toolTokenCounts == null) {
    return 0;
  }
  let total = 0;
  for (const [name, count] of Object.entries(toolTokenCounts)) {
    if (isMcpToolName(name) && Number.isFinite(count) && count > 0) {
      total += count;
    }
  }
  return total;
}

function nonNegative(value: number | undefined | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * §5 `occupied` from the SDK projection. The header total is what the pruner
 * left in the window (`contextBudget − remaining`); segments are derived from
 * the structural breakdown and `other` absorbs the calibration remainder so
 * the `●` rows always sum to the header (§10.21). Built-in tool schemas count
 * under `systemPrompt`, only MCP schemas under `mcpTools`, retained summary
 * under `messages`, tool traffic under `toolCalls` (contract doc).
 */
export function composeOccupied(
  usage: ContextUsageEvent,
  draftAttachmentTokens: number,
): TContextOccupied {
  const b = usage.breakdown;
  const calibration =
    typeof usage.calibrationRatio === 'number' && usage.calibrationRatio > 0
      ? usage.calibrationRatio
      : 1;
  const occupiedTotal =
    usage.contextBudget != null && usage.remainingContextTokens != null
      ? Math.max(0, usage.contextBudget - usage.remainingContextTokens)
      : nonNegative(b.instructionTokens) + nonNegative(b.messageTokens);

  const toolSchema = nonNegative(b.toolSchemaTokens);
  const mcpTools = Math.min(toolSchema, sumMcpSchemaTokens(b.toolTokenCounts));
  const toolCalls = Math.min(nonNegative(b.toolMessageTokens), nonNegative(b.messageTokens));
  const messageBody = Math.max(0, nonNegative(b.messageTokens) - toolCalls);
  const attachments = Math.min(messageBody, nonNegative(draftAttachmentTokens * calibration));
  const messages = messageBody - attachments + nonNegative(b.summaryTokens);
  let systemPrompt = nonNegative(b.systemMessageTokens) + (toolSchema - mcpTools);

  const occupied = emptyContextOccupied();
  occupied.messages = messages;
  occupied.toolCalls = toolCalls;
  occupied.mcpTools = mcpTools;
  occupied.attachments = attachments;
  const accounted = messages + toolCalls + mcpTools + attachments + systemPrompt;
  let other = occupiedTotal - accounted;
  if (other < 0) {
    systemPrompt = Math.max(0, systemPrompt + other);
    other = 0;
  }
  occupied.systemPrompt = systemPrompt;
  occupied.other = other;
  return occupied;
}

function previewText(message: EstimateSourceMessage): string | undefined {
  let text = typeof message.text === 'string' ? message.text : '';
  if (text.length === 0 && Array.isArray(message.content)) {
    text = (message.content as Array<{ type?: string; text?: string }>)
      .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .filter((part) => part.length > 0)
      .join(' ');
  }
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length === 0) {
    return undefined;
  }
  return compact.length > PREVIEW_MAX_CHARS
    ? `${compact.slice(0, PREVIEW_MAX_CHARS - 1)}…`
    : compact;
}

function previewRole(message: EstimateSourceMessage): TContextExcludedMessage['role'] {
  if (message.role === 'system') {
    return 'system';
  }
  if (message.isCreatedByUser === true || message.role === 'user') {
    return 'user';
  }
  if (message.role === 'tool') {
    return 'tool';
  }
  return 'assistant';
}

function isoDate(value: string | Date | undefined): string | undefined {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === 'string' ? value : undefined;
}

function toExcludedMessage(message: EstimateSourceMessage): TContextExcludedMessage {
  const createdAt = isoDate(message.createdAt);
  return {
    messageId: message.messageId,
    role: previewRole(message),
    preview: previewText(message),
    tokens: typeof message.tokenCount === 'number' ? message.tokenCount : undefined,
    createdAt,
  };
}

function sourceMessageIdOf(message: EstimateFormattedMessage): string | undefined {
  const id = message.additional_kwargs?.sourceMessageId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * §4 exclusion plan. The SDK pruner keeps the newest messages, so what it
 * drops is a prefix of the graph input; a stored row counts as excluded only
 * when none of its formatted parts survived. With auto-summarization on, Send
 * summarizes that prefix instead of dropping it, hence `reason: 'summarized'`.
 */
export function composeExclusionPlan(
  usage: ContextUsageEvent,
  formattedMessages: readonly EstimateFormattedMessage[],
  sourceMessages: readonly EstimateSourceMessage[],
  summarizationEnabled: boolean,
  maxExcludedPreviews: number,
): TContextExclusionPlan | null {
  const total = formattedMessages.length;
  const retained = Math.min(total, nonNegative(usage.breakdown.messageCount));
  const dropped = total - retained;
  if (dropped <= 0) {
    return null;
  }
  const droppedIds = new Set<string>();
  const retainedIds = new Set<string>();
  for (let i = 0; i < total; i++) {
    const id = sourceMessageIdOf(formattedMessages[i]);
    if (id == null) {
      continue;
    }
    (i < dropped ? droppedIds : retainedIds).add(id);
  }
  const excluded = sourceMessages.filter(
    (message) => droppedIds.has(message.messageId) && !retainedIds.has(message.messageId),
  );
  const count = excluded.length > 0 ? excluded.length : dropped;
  const prePruneTokens =
    nonNegative(usage.prePruneContextTokens) +
    nonNegative(usage.effectiveInstructionTokens ?? usage.breakdown.instructionTokens);
  return {
    count,
    reason: summarizationEnabled ? 'summarized' : 'over_budget',
    messages: excluded.slice(0, Math.max(0, maxExcludedPreviews)).map(toExcludedMessage),
    prePruneTokens,
  };
}

function resolveStatus(
  usage: ContextUsageEvent | null,
  incompleteReasons: readonly TContextIncompleteReason[],
): { status: TContextEstimateStatus; incompleteReasons: TContextIncompleteReason[] } {
  if (usage == null) {
    const reasons = new Set<TContextIncompleteReason>(incompleteReasons);
    reasons.add('tokenizer_unavailable');
    return { status: 'unavailable', incompleteReasons: [...reasons] };
  }
  if (incompleteReasons.length > 0) {
    return { status: 'partial', incompleteReasons: [...new Set(incompleteReasons)] };
  }
  return { status: 'fresh', incompleteReasons: [] };
}

/**
 * Maps the dry run onto the §7 `nextRequestEstimate` contract. Never
 * `provider`-sourced, never a cache guess (`cache` rows stay `null` — no
 * honest expected hit exists before the call), and `B` is `W − R` (§10.1)
 * while the pruner's own 5 % headroom only shows through the exclusion plan.
 */
export function composeNextRequestEstimate(
  params: ComposeEstimateParams,
): TContextNextRequestEstimate {
  const { status, incompleteReasons } = resolveStatus(params.usage, params.incompleteReasons);
  const budget = computeContextBudget({
    window: params.window,
    reserve: params.outputReserve,
    inputLimit: null,
  });
  const usage = params.usage;
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId: params.identity.conversationId,
    branchLeafId: params.identity.branchLeafId,
    revision: params.revision,
    fingerprint: params.fingerprint,
    status,
    ...(incompleteReasons.length > 0 ? { incompleteReasons } : {}),
    source: usage == null ? 'unavailable' : 'server_estimate',
    computedAt: params.computedAt,
    configuration: params.configuration,
    budget,
    occupied:
      usage == null ? emptyContextOccupied() : composeOccupied(usage, params.draftAttachmentTokens),
    cache: { read: null, write: null },
    excluded:
      usage == null
        ? null
        : composeExclusionPlan(
            usage,
            params.formattedMessages,
            params.sourceMessages,
            params.summarizationEnabled,
            params.maxExcludedPreviews,
          ),
  };
}

/** The §7 `error` entry for a failed dry run: identity and revision only, no numbers. */
export function composeEstimateError(params: {
  identity: { conversationId: string; branchLeafId: string };
  revision: number;
  computedAt: number;
  configuration: TContextConfiguration;
  errorCode: string;
}): TContextNextRequestEstimate {
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId: params.identity.conversationId,
    branchLeafId: params.identity.branchLeafId,
    revision: params.revision,
    fingerprint: '',
    status: 'error',
    source: 'unavailable',
    computedAt: params.computedAt,
    configuration: params.configuration,
    budget: computeContextBudget({ window: null }),
    occupied: emptyContextOccupied(),
    cache: { read: null, write: null },
    excluded: null,
    errorCode: params.errorCode,
  };
}
