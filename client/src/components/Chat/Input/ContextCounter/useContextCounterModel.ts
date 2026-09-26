import { useMemo } from 'react';
import { CONTEXT_COUNTER_CONTRACT_VERSION, toTokenInteger } from 'librechat-data-provider';
import type {
  TConversation,
  TContextOccupied,
  TContextSessionUsage,
  TContextLastCallMeasurement,
} from 'librechat-data-provider';
import type { ContextCounterActions, ContextCounterViewModel } from './types';
import type { TokenUsageView } from '~/hooks/Chat/useTokenUsage';
import useCompactConversation, { supportsCompaction } from '~/hooks/Chat/useCompactConversation';
import useTokenUsage from '~/hooks/Chat/useTokenUsage';
import { DEFAULT_CAPABILITIES } from './types';
import { groupToolTokens } from '~/utils';

interface Params {
  index: number;
  conversation: TConversation | null;
  isSubmitting: boolean;
  compactionEnabled: boolean;
}

interface Model {
  vm: ContextCounterViewModel;
  actions: ContextCounterActions;
}

/**
 * Maps the pre-invoke server snapshot of the branch's last generation to
 * `lastCallMeasurement`. The snapshot is the server's own count reconciled
 * after the call, not raw provider usage, so it is labelled `server_estimate`
 * (§10.5). Composition is closed with an `other` remainder so the segments
 * sum to `input` (§10.21); a negative remainder is surfaced as a mismatch.
 */
function lastCallFromSnapshot(
  view: TokenUsageView,
  conversation: TConversation | null,
): TContextLastCallMeasurement | null {
  const snapshot = view.snapshotActive ? view.snapshot : null;
  if (snapshot == null) {
    return null;
  }
  const breakdown = snapshot.breakdown;
  const window = toTokenInteger(breakdown.maxContextTokens);
  const budget = snapshot.contextBudget != null ? toTokenInteger(snapshot.contextBudget) : window;
  const remaining =
    snapshot.remainingContextTokens != null
      ? toTokenInteger(snapshot.remainingContextTokens)
      : null;
  const instructions = toTokenInteger(
    snapshot.effectiveInstructionTokens ?? breakdown.instructionTokens,
  );
  const input =
    remaining != null
      ? Math.max(0, budget - remaining)
      : instructions + toTokenInteger(breakdown.messageTokens);
  const groups = groupToolTokens(breakdown.toolTokenCounts, breakdown.deferredToolNames);
  const mcpTools = groups.mcp + groups.mcpDeferred;
  const toolCalls = Math.min(
    toTokenInteger(breakdown.toolMessageTokens),
    toTokenInteger(breakdown.messageTokens),
  );
  const messages = toTokenInteger(breakdown.messageTokens) - toolCalls;
  const systemPrompt = Math.max(0, instructions - mcpTools);
  const known = messages + toolCalls + systemPrompt + mcpTools;
  const composition: TContextOccupied = {
    messages,
    toolCalls,
    systemPrompt,
    mcpTools,
    attachments: 0,
    other: Math.max(0, input - known),
  };
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId: conversation?.conversationId ?? '',
    branchLeafId: view.branchTotals.tailId ?? '',
    callId: snapshot.runId ?? snapshot.anchorMessageId ?? '',
    responseMessageId: snapshot.anchorMessageId ?? undefined,
    measuredAt: 0,
    configuration: {
      endpoint: conversation?.endpoint ?? undefined,
      provider: snapshot.provider,
      model: snapshot.model ?? conversation?.model ?? undefined,
      agentId: snapshot.agentId ?? conversation?.agent_id ?? null,
    },
    source: 'server_estimate',
    complete: true,
    budget: {
      window: window > 0 ? window : null,
      reserve: Math.max(0, window - budget),
      inputLimit: null,
      budget: budget > 0 ? budget : null,
    },
    input,
    output: toTokenInteger(snapshot.completedOutputTokens),
    cacheRead: toTokenInteger(snapshot.cacheRead),
    cacheWrite: toTokenInteger(snapshot.cacheWrite),
    composition,
    compositionSource: 'server_estimate',
    compositionMismatch: known > input,
  };
}

function sessionUsageFromBranch(
  view: TokenUsageView,
  conversation: TConversation | null,
): TContextSessionUsage | null {
  if (!view.hasUsage) {
    return null;
  }
  const usage = view.branchUsage;
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId: conversation?.conversationId ?? '',
    branchLeafId: view.branchTotals.tailId ?? '',
    scope: 'branch',
    complete: true,
    cacheSplittable: true,
    input: toTokenInteger(usage.input),
    output: toTokenInteger(usage.output),
    cacheRead: toTokenInteger(usage.cacheRead),
    cacheWrite: toTokenInteger(usage.cacheWrite),
    calls: toTokenInteger(view.branchTotals.counted),
    updatedAt: 0,
  };
}

/**
 * Interim adapter over the existing `useTokenUsage` view. Stream D replaces
 * this hook with its conversation-level stores; the components above it do
 * not change. No dry-run estimate exists yet, so `nextRequestEstimate` stays
 * `null` («нет данных») instead of the forbidden `chars/4` guess (§6.5).
 */
export function useContextCounterModel({
  index,
  conversation,
  isSubmitting,
  compactionEnabled,
}: Params): Model {
  const view = useTokenUsage({ index, conversation, isSubmitting });
  const compaction = useCompactConversation();
  const compressionSupported = compactionEnabled && supportsCompaction(conversation?.endpoint);

  const vm = useMemo<ContextCounterViewModel>(
    () => ({
      conversationId: conversation?.conversationId ?? null,
      configuration: {
        endpoint: conversation?.endpoint ?? undefined,
        model: conversation?.model ?? undefined,
        agentId: conversation?.agent_id ?? null,
      },
      nextRequestEstimate: null,
      lastCallMeasurement: lastCallFromSnapshot(view, conversation),
      sessionUsage: sessionUsageFromBranch(view, conversation),
      activity: {
        streaming: isSubmitting && !compaction.isCompacting,
        sending: false,
        compressing: compaction.isCompacting,
        modelSwitching: false,
      },
      capabilities: {
        ...DEFAULT_CAPABILITIES,
        compressionSupported: compressionSupported && compaction.canCompact,
        estimateSupported: false,
      },
      isEmptyChat: view.branchTotals.total === 0,
    }),
    [
      conversation,
      view,
      isSubmitting,
      compaction.isCompacting,
      compaction.canCompact,
      compressionSupported,
    ],
  );

  const actions = useMemo<ContextCounterActions>(
    () => ({
      recalculate: () => undefined,
      compress: compaction.compact,
    }),
    [compaction.compact],
  );

  return { vm, actions };
}
