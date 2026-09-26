import type { TContextLastCallMeasurement, TContextSessionUsage } from './contextCounter';

/** Query for `GET /api/agents/context/usage`; the branch is root → `messageId`. */
export type TContextUsageParams = {
  conversationId: string;
  /** Leaf message of the branch to read (§5 «Дефолт scope = текущая ветка»). */
  messageId: string;
};

/**
 * Persisted usage state of one branch, read back on reload (§10.12). Both
 * stores are derived only from messages on the root → leaf chain (§10.11).
 */
export type TContextUsageSnapshot = {
  version: 1;
  conversationId: string;
  branchLeafId: string;
  /** `null` when no completed call on the branch carried provider usage. */
  lastCall: TContextLastCallMeasurement | null;
  sessionUsage: TContextSessionUsage;
};
