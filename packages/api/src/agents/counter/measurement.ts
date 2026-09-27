import {
  Constants,
  toTokenInteger,
  computeContextBudget,
  normalizeProviderUsage,
  reconcileContextUsageFromEvent,
  CONTEXT_COUNTER_CONTRACT_VERSION,
} from 'librechat-data-provider';
import type {
  TContextBudget,
  TContextOccupied,
  TTokenUsageEvent,
  TContextUsageEvent,
  TTokenBudgetBreakdown,
  TContextLastCallMeasurement,
} from 'librechat-data-provider';
import { finalPrimaryCall, usageEventKey } from '../usage';

export interface LastCallMeasurementParams {
  conversationId: string;
  /** Response message the turn produced; it is the branch leaf at measurement time. */
  responseMessageId: string;
  /** Every `on_token_usage` payload the turn emitted, in emission order. */
  usageEvents: ReadonlyArray<TTokenUsageEvent>;
  /** Latest pre-invoke context snapshot — the one preceding the final primary call. */
  snapshot?: TContextUsageEvent | null;
  endpoint?: string;
  agentId?: string | null;
  measuredAt?: number;
}

const UNKNOWN_BUDGET: TContextBudget = { window: null, reserve: 0, inputLimit: null, budget: null };

/**
 * W/R/L/B of the call a snapshot precedes. The SDK reports the window
 * (`maxContextTokens`) and the usable budget (`contextBudget = W − R`); the
 * reserve is their difference. An older SDK without `contextBudget` reported
 * no reserve, so the budget equals the window — the same denominator the live
 * gauge has always used for those snapshots. `L` is not part of the model
 * config today and stays `null`.
 */
export function budgetFromSnapshot(snapshot: TContextUsageEvent): TContextBudget {
  const window = toTokenInteger(snapshot.breakdown?.maxContextTokens);
  if (window <= 0) {
    return UNKNOWN_BUDGET;
  }
  const contextBudget = toTokenInteger(snapshot.contextBudget);
  const reserve = contextBudget > 0 ? Math.max(0, window - contextBudget) : 0;
  return computeContextBudget({ window, reserve });
}

function sumMcpToolTokens(toolTokenCounts: Record<string, number> | undefined): number {
  if (toolTokenCounts == null) {
    return 0;
  }
  let total = 0;
  for (const [name, tokens] of Object.entries(toolTokenCounts)) {
    if (name.includes(Constants.mcp_delimiter)) {
      total += toTokenInteger(tokens);
    }
  }
  return total;
}

/**
 * Partitions the call's confirmed `input` into the §5 `●` segments so their
 * sum equals `input` exactly (§10.21). The snapshot's rows are the SDK's
 * calibrated estimate reconciled to the provider total, so the split is an
 * estimate over a confirmed whole — `compositionSource: 'server_estimate'`.
 * Instruction overhead is taken first (MCP schemas carved out of it), then
 * summary + kept messages, then tool traffic; anything the rows did not
 * explain lands in `other` rather than being dropped. Attachments are not
 * separable from messages in today's snapshot and stay at 0.
 */
export function compositionFromSnapshot(
  snapshot: TContextUsageEvent,
  input: number,
): TContextOccupied {
  const breakdown: Partial<TTokenBudgetBreakdown> = snapshot.breakdown ?? {};
  let rest = toTokenInteger(input);
  const take = (value: number): number => {
    const taken = Math.min(toTokenInteger(value), rest);
    rest -= taken;
    return taken;
  };
  const instructions = toTokenInteger(
    snapshot.effectiveInstructionTokens ?? breakdown.instructionTokens,
  );
  const mcp = Math.min(sumMcpToolTokens(breakdown.toolTokenCounts), instructions);
  const systemPrompt = take(instructions - mcp);
  const mcpTools = take(mcp);
  const toolMessageTokens = toTokenInteger(breakdown.toolMessageTokens);
  const messageTokens = toTokenInteger(breakdown.messageTokens);
  const messages = take(
    toTokenInteger(breakdown.summaryTokens) + Math.max(0, messageTokens - toolMessageTokens),
  );
  const toolCalls = take(Math.min(toolMessageTokens, messageTokens));
  return {
    messages,
    toolCalls,
    systemPrompt,
    mcpTools,
    attachments: 0,
    other: rest,
  };
}

function snapshotDescribesCall(snapshot: TContextUsageEvent, call: TTokenUsageEvent): boolean {
  return snapshot.runId == null || call.runId == null || snapshot.runId === call.runId;
}

/**
 * §7 `lastCallMeasurement` for a completed turn: the final primary model call's
 * provider usage, normalized once (§5 table; cache counted exactly once, output
 * kept apart from input — §10.2/§10.7), against the budget of the snapshot
 * that preceded that call. `undefined` when no primary call reported usage, so
 * an aborted or usage-less turn leaves the previous measurement standing.
 * Composition is attached only when the snapshot belongs to the same run;
 * otherwise only the confirmed total is kept (`complete: false`).
 */
export function buildLastCallMeasurement({
  conversationId,
  responseMessageId,
  usageEvents,
  snapshot,
  endpoint,
  agentId,
  measuredAt = Date.now(),
}: LastCallMeasurementParams): TContextLastCallMeasurement | undefined {
  /** Prefer the call the snapshot precedes; when the snapshot belongs to another
   *  run, the turn's final primary call is still the last call — measured
   *  without composition. */
  const finalCall = finalPrimaryCall(usageEvents, snapshot?.runId) ?? finalPrimaryCall(usageEvents);
  if (finalCall == null) {
    return undefined;
  }
  const normalized = normalizeProviderUsage(finalCall, finalCall.provider ?? null);
  if (normalized == null || normalized.input <= 0) {
    return undefined;
  }
  const described = snapshot != null && snapshotDescribesCall(snapshot, finalCall);
  const reconciled = described ? reconcileContextUsageFromEvent(snapshot, finalCall) : null;
  const composition = reconciled ? compositionFromSnapshot(reconciled, normalized.input) : null;
  const provider = finalCall.provider ?? normalized.provider ?? undefined;
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId,
    branchLeafId: responseMessageId,
    callId: usageEventKey(finalCall) ?? `${responseMessageId}:final`,
    responseMessageId,
    measuredAt,
    configuration: {
      ...(endpoint != null && { endpoint }),
      ...(provider != null && { provider }),
      ...(finalCall.model != null && { model: finalCall.model }),
      ...(agentId !== undefined && { agentId }),
    },
    source: 'provider',
    complete: composition != null,
    budget: reconciled ? budgetFromSnapshot(reconciled) : UNKNOWN_BUDGET,
    input: normalized.input,
    output: normalized.output,
    cacheRead: normalized.cacheRead,
    cacheWrite: normalized.cacheWrite,
    composition,
    compositionSource: composition != null ? 'server_estimate' : 'unavailable',
  };
}

/**
 * Reads a measurement out of a response saved before `metadata.lastCall`
 * existed, from the reconciled `metadata.contextUsage` blob those responses
 * already carry (§7 «старые снимки продолжают читаться»). Input is the
 * reconciled prompt (instructions + summary + kept messages); output is the
 * final call's completed output. Marked incomplete: the exact call identity
 * and the pre-reconciliation total are not recoverable.
 */
export function lastCallFromPersistedContextUsage({
  conversationId,
  responseMessageId,
  contextUsage,
  endpoint,
  agentId,
  measuredAt,
}: {
  conversationId: string;
  responseMessageId: string;
  contextUsage: TContextUsageEvent;
  endpoint?: string;
  agentId?: string | null;
  measuredAt: number;
}): TContextLastCallMeasurement | undefined {
  const breakdown: Partial<TTokenBudgetBreakdown> = contextUsage.breakdown ?? {};
  const input =
    toTokenInteger(contextUsage.effectiveInstructionTokens ?? breakdown.instructionTokens) +
    toTokenInteger(breakdown.summaryTokens) +
    toTokenInteger(breakdown.messageTokens);
  if (input <= 0 || contextUsage.provider == null) {
    return undefined;
  }
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId,
    branchLeafId: responseMessageId,
    callId: `${contextUsage.runId ?? responseMessageId}:persisted`,
    responseMessageId,
    measuredAt,
    configuration: {
      ...(endpoint != null && { endpoint }),
      provider: contextUsage.provider,
      ...(contextUsage.model != null && { model: contextUsage.model }),
      ...(agentId !== undefined && { agentId }),
    },
    source: 'provider',
    complete: false,
    budget: budgetFromSnapshot(contextUsage),
    input,
    output: toTokenInteger(contextUsage.completedOutputTokens),
    cacheRead: toTokenInteger(contextUsage.cacheRead),
    cacheWrite: toTokenInteger(contextUsage.cacheWrite),
    composition: compositionFromSnapshot(contextUsage, input),
    compositionSource: 'server_estimate',
  };
}
