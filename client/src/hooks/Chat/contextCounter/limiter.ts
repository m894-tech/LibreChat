/** §6.6 client guard: burst of 5, then ≤30 estimate requests per minute per conversation. */
export const ESTIMATE_BURST = 5;
export const ESTIMATE_PER_MINUTE = 30;

export type TokenBucket = {
  tokens: number;
  updatedAt: number;
};

export function createBucket(now: number, burst: number = ESTIMATE_BURST): TokenBucket {
  return { tokens: burst, updatedAt: now };
}

/**
 * Takes one token, refilling by elapsed time first. Returns `0` when the
 * request may go now, otherwise the milliseconds to wait for the next token.
 */
export function takeToken(
  bucket: TokenBucket,
  now: number,
  burst: number = ESTIMATE_BURST,
  perMinute: number = ESTIMATE_PER_MINUTE,
): number {
  const ratePerMs = perMinute / 60_000;
  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(burst, bucket.tokens + elapsed * ratePerMs);
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return 0;
  }
  return Math.ceil((1 - bucket.tokens) / ratePerMs);
}
