import { request } from 'librechat-data-provider';
import type {
  TContextEstimateRequest,
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
