import { Constants, CONTEXT_COUNTER_CONTRACT_VERSION } from 'librechat-data-provider';
import type {
  TResponseUsage,
  TContextUsageEvent,
  TContextUsageTotals,
  TResponseUsageBucket,
  TContextUsageSnapshot,
  TContextSessionUsage,
  TContextLastCallMeasurement,
} from 'librechat-data-provider';
import { lastCallFromPersistedContextUsage } from './measurement';

/** The message fields the branch read needs; a plain projection, not a Mongoose document. */
export interface BranchUsageMessage {
  messageId: string;
  parentMessageId?: string | null;
  isCreatedByUser?: boolean;
  error?: boolean;
  endpoint?: string;
  agent_id?: string | null;
  createdAt?: Date | string;
  metadata?: Record<string, unknown> | null;
}

/** Mongo projection for {@link BranchUsageMessage}; never client-facing on its own. */
export const BRANCH_USAGE_MESSAGE_SELECT =
  'messageId parentMessageId isCreatedByUser error endpoint agent_id createdAt metadata';

export interface BranchContextUsageParams {
  conversationId: string;
  /** Leaf of the branch to read; the chain is followed root-ward from here. */
  leafId: string;
  /** Every message of the conversation the caller is allowed to see. */
  messages: ReadonlyArray<BranchUsageMessage>;
  now?: number;
}

interface MutableTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
}

const emptyTotals = (): MutableTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  calls: 0,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

const finiteNonNegative = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

function readRollup(metadata: Record<string, unknown> | null | undefined): TResponseUsage | null {
  const usage = metadata?.usage;
  if (!isRecord(usage) || typeof usage.input !== 'number' || typeof usage.output !== 'number') {
    return null;
  }
  return usage as unknown as TResponseUsage;
}

function readLastCall(
  metadata: Record<string, unknown> | null | undefined,
): TContextLastCallMeasurement | null {
  const lastCall = metadata?.lastCall;
  if (
    !isRecord(lastCall) ||
    lastCall.version !== CONTEXT_COUNTER_CONTRACT_VERSION ||
    typeof lastCall.input !== 'number'
  ) {
    return null;
  }
  return lastCall as unknown as TContextLastCallMeasurement;
}

function readContextUsage(
  metadata: Record<string, unknown> | null | undefined,
): TContextUsageEvent | null {
  const contextUsage = metadata?.contextUsage;
  if (!isRecord(contextUsage) || !isRecord(contextUsage.breakdown)) {
    return null;
  }
  return contextUsage as unknown as TContextUsageEvent;
}

function addBucket(
  target: MutableTotals,
  bucket: Pick<TResponseUsageBucket, 'input' | 'output' | 'cacheRead' | 'cacheWrite'> & {
    calls?: number;
  },
  fallbackCalls: number,
): void {
  target.input += finiteNonNegative(bucket.input);
  target.output += finiteNonNegative(bucket.output);
  target.cacheRead += finiteNonNegative(bucket.cacheRead);
  target.cacheWrite += finiteNonNegative(bucket.cacheWrite);
  target.calls += bucket.calls == null ? fallbackCalls : finiteNonNegative(bucket.calls);
}

/**
 * §5: when the cache split is a heuristic, the whole confirmed input goes to
 * «Вход» and the cache rows are hidden — never a guessed split (§10.22).
 */
function toTotals(totals: MutableTotals, cacheSplittable: boolean): TContextUsageTotals {
  if (cacheSplittable) {
    return { ...totals };
  }
  return {
    input: totals.input + totals.cacheRead + totals.cacheWrite,
    output: totals.output,
    cacheRead: 0,
    cacheWrite: 0,
    calls: totals.calls,
  };
}

/** Root-ward chain from `leafId`; stops at the root, a missing parent or a cycle. */
export function branchChain(
  messages: ReadonlyArray<BranchUsageMessage>,
  leafId: string,
): BranchUsageMessage[] {
  const byId = new Map<string, BranchUsageMessage>();
  for (const message of messages) {
    byId.set(message.messageId, message);
  }
  const chain: BranchUsageMessage[] = [];
  const seen = new Set<string>();
  let currentId: string | null | undefined = leafId;
  while (currentId != null && currentId !== Constants.NO_PARENT && !seen.has(currentId)) {
    const message = byId.get(currentId);
    if (message == null) {
      break;
    }
    seen.add(currentId);
    chain.push(message);
    currentId = message.parentMessageId;
  }
  return chain;
}

function toTimestamp(value: Date | string | undefined, fallback: number): number {
  if (value == null) {
    return fallback;
  }
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : fallback;
}

/**
 * Reads both §7 stores for one branch from the messages already persisted on
 * it (§10.12): `sessionUsage` folds every response's `metadata.usage` rollup
 * along root → leaf, `lastCall` is the measurement nearest the leaf. Only the
 * parent chain is walked, so another branch's responses never contribute
 * (§10.11). A response that reported nothing leaves the session «неполно»
 * rather than silently under-counting. `null` when `leafId` is not in
 * `messages`.
 */
export function readBranchContextUsage({
  conversationId,
  leafId,
  messages,
  now = Date.now(),
}: BranchContextUsageParams): TContextUsageSnapshot | null {
  const chain = branchChain(messages, leafId);
  if (chain.length === 0 || chain[0].messageId !== leafId) {
    return null;
  }
  const totals = emptyTotals();
  const auxiliary = emptyTotals();
  const compress = emptyTotals();
  let complete = true;
  let cacheSplittable = true;
  let lastCall: TContextLastCallMeasurement | null = null;
  for (const message of chain) {
    if (message.isCreatedByUser === true || message.error === true) {
      continue;
    }
    const rollup = readRollup(message.metadata);
    if (rollup == null) {
      complete = false;
    } else {
      addBucket(totals, rollup, 1);
      if (rollup.auxiliary != null) {
        addBucket(auxiliary, rollup.auxiliary, 0);
      }
      if (rollup.compress != null) {
        addBucket(compress, rollup.compress, 0);
      }
      if (rollup.cacheSplittable === false) {
        cacheSplittable = false;
      }
    }
    if (lastCall != null) {
      continue;
    }
    lastCall = readLastCall(message.metadata);
    if (lastCall != null) {
      continue;
    }
    const contextUsage = readContextUsage(message.metadata);
    if (contextUsage != null) {
      lastCall =
        lastCallFromPersistedContextUsage({
          conversationId,
          responseMessageId: message.messageId,
          contextUsage,
          endpoint: message.endpoint,
          agentId: message.agent_id,
          measuredAt: toTimestamp(message.createdAt, now),
        }) ?? null;
    }
  }
  const sessionUsage: TContextSessionUsage = {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId,
    branchLeafId: leafId,
    scope: 'branch',
    complete,
    cacheSplittable,
    ...toTotals(totals, cacheSplittable),
    ...(auxiliary.calls > 0 && { auxiliary: toTotals(auxiliary, cacheSplittable) }),
    ...(compress.calls > 0 && { compress: toTotals(compress, cacheSplittable) }),
    updatedAt: now,
  };
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId,
    branchLeafId: leafId,
    lastCall,
    sessionUsage,
  };
}
