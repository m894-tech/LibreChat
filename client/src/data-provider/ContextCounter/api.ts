import { request } from 'librechat-data-provider';
import type {
  TEphemeralAgent,
  TContextSessionUsage,
  TContextLastCallMeasurement,
  TContextNextRequestEstimate,
} from 'librechat-data-provider';

/**
 * Thin, repointable seam to the server endpoints built in parallel:
 * stream B (dry-run estimate) and stream C (last call + session usage read).
 * Paths and request shapes follow spec §5–§7 field names; once those streams
 * publish `dataService` functions, only this file changes.
 */
const CONTEXT_BASE = '/api/agents/context';

export const contextCounterEndpoints = {
  estimate: (): string => `${CONTEXT_BASE}/estimate`,
  usage: (conversationId: string, leafId: string): string =>
    `${CONTEXT_BASE}/usage?conversationId=${encodeURIComponent(conversationId)}&leafId=${encodeURIComponent(leafId)}`,
};

/** Body of the dry-run estimate (§6): the same inputs Send would assemble from. */
export type TContextEstimateRequest = {
  conversationId: string;
  /** Leaf of the branch the next request continues; `Constants.NO_PARENT` for an empty chat. */
  parentMessageId: string;
  endpoint?: string;
  endpointType?: string;
  model?: string;
  agent_id?: string | null;
  spec?: string | null;
  promptPrefix?: string | null;
  maxContextTokens?: number | null;
  maxOutputTokens?: number | null;
  /** Current composer draft — the «новый ввод» term of the plan. */
  text: string;
  /** Prepared attachment ids; unprocessed ones make the estimate `partial`. */
  files: string[];
  ephemeralAgent?: TEphemeralAgent | null;
  /** Client revision echoed back so late answers can be dropped (§6.3). */
  revision: number;
  /** Client fingerprint; the server may use it as a cache key (§7). */
  fingerprint: string;
};

/** Stream C read model for one branch (root → leaf). */
export type TContextUsageSnapshot = {
  lastCall: TContextLastCallMeasurement | null;
  sessionUsage: TContextSessionUsage | null;
  /** Persisted forecast, when the server keeps one; hydrated as `stale`. */
  estimate?: TContextNextRequestEstimate | null;
};

export function estimateContext(
  body: TContextEstimateRequest,
): Promise<TContextNextRequestEstimate> {
  return request.post(contextCounterEndpoints.estimate(), body);
}

export function getContextUsage(
  conversationId: string,
  leafId: string,
): Promise<TContextUsageSnapshot> {
  return request.get(contextCounterEndpoints.usage(conversationId, leafId));
}
