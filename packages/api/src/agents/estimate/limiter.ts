/**
 * §6.6 estimate rate limit: a token bucket per user + conversation. `burst`
 * requests may arrive at once; afterwards tokens refill at `perMinute / 60`
 * per second, so a sustained caller gets at most `perMinute` per minute. Kept
 * in process memory: the estimate is a read-only UI aid and a per-replica
 * bound is enough to stop an open menu with auto-retry from hammering one
 * backend (the goal of the rule), without a shared store dependency.
 */
export type TokenBucketOptions = {
  burst: number;
  perMinute: number;
  /** Injectable clock (ms) for tests. */
  now?: () => number;
  /** Idle buckets older than this are evicted on the next sweep. */
  idleTtlMs?: number;
  /** Sweep every N `take` calls. */
  sweepEvery?: number;
};

export type TokenBucketDecision = {
  allowed: boolean;
  /** Milliseconds until one token is available again; 0 when allowed. */
  retryAfterMs: number;
  /** Whole tokens left after this decision. */
  remaining: number;
};

export type TokenBucketLimiter = {
  take: (key: string) => TokenBucketDecision;
  /** Number of tracked keys (diagnostics/tests). */
  size: () => number;
  clear: () => void;
};

type Bucket = { tokens: number; updatedAt: number };

const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SWEEP_EVERY = 256;

export function createTokenBucketLimiter(options: TokenBucketOptions): TokenBucketLimiter {
  const burst = Math.max(1, Math.floor(options.burst));
  const perMinute = Math.max(1, Math.floor(options.perMinute));
  const refillPerMs = perMinute / 60_000;
  const now = options.now ?? Date.now;
  /** A bucket may only be forgotten once it would have refilled completely anyway. */
  const fullRefillMs = Math.ceil(burst / refillPerMs);
  const idleTtlMs = Math.max(options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS, fullRefillMs);
  const sweepEvery = Math.max(1, options.sweepEvery ?? DEFAULT_SWEEP_EVERY);
  const buckets = new Map<string, Bucket>();
  let takesSinceSweep = 0;

  const sweep = (at: number): void => {
    for (const [key, bucket] of buckets) {
      if (at - bucket.updatedAt > idleTtlMs) {
        buckets.delete(key);
      }
    }
  };

  const take = (key: string): TokenBucketDecision => {
    const at = now();
    takesSinceSweep += 1;
    if (takesSinceSweep >= sweepEvery) {
      takesSinceSweep = 0;
      sweep(at);
    }
    const existing = buckets.get(key);
    const refilled =
      existing == null
        ? burst
        : Math.min(burst, existing.tokens + Math.max(0, at - existing.updatedAt) * refillPerMs);
    if (refilled >= 1) {
      const tokens = refilled - 1;
      buckets.set(key, { tokens, updatedAt: at });
      return { allowed: true, retryAfterMs: 0, remaining: Math.floor(tokens) };
    }
    buckets.set(key, { tokens: refilled, updatedAt: at });
    const retryAfterMs = Math.ceil((1 - refilled) / refillPerMs);
    return { allowed: false, retryAfterMs, remaining: 0 };
  };

  return {
    take,
    size: () => buckets.size,
    clear: () => buckets.clear(),
  };
}
