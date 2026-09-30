import { createTokenBucketLimiter } from './limiter';

describe('createTokenBucketLimiter (§6.6)', () => {
  const setup = () => {
    let clock = 0;
    const limiter = createTokenBucketLimiter({
      burst: 5,
      perMinute: 30,
      now: () => clock,
      idleTtlMs: 1000,
      sweepEvery: 1,
    });
    return { limiter, advance: (ms: number) => (clock += ms) };
  };

  it('allows a burst of 5 then rejects with a retry hint', () => {
    const { limiter } = setup();
    for (let i = 0; i < 5; i++) {
      expect(limiter.take('u1:c1').allowed).toBe(true);
    }
    const denied = limiter.take('u1:c1');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(2000);
    expect(denied.remaining).toBe(0);
  });

  it('refills at 30 per minute (one token every 2 s)', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 5; i++) {
      limiter.take('u1:c1');
    }
    advance(1999);
    expect(limiter.take('u1:c1').allowed).toBe(false);
    advance(1);
    expect(limiter.take('u1:c1').allowed).toBe(true);
    expect(limiter.take('u1:c1').allowed).toBe(false);
  });

  it('admits at most perMinute sustained requests in a minute', () => {
    const { limiter, advance } = setup();
    let allowed = 0;
    for (let ms = 0; ms < 60_000; ms += 100) {
      if (limiter.take('u1:c1').allowed) {
        allowed += 1;
      }
      advance(100);
    }
    expect(allowed).toBeLessThanOrEqual(30 + 5);
    expect(allowed).toBeGreaterThanOrEqual(30);
  });

  it('isolates buckets per user + conversation and never exceeds the burst', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 5; i++) {
      limiter.take('u1:c1');
    }
    expect(limiter.take('u1:c2').allowed).toBe(true);
    expect(limiter.take('u2:c1').allowed).toBe(true);
    advance(60_000);
    for (let i = 0; i < 5; i++) {
      expect(limiter.take('u1:c1').allowed).toBe(true);
    }
    expect(limiter.take('u1:c1').allowed).toBe(false);
  });

  it('evicts idle buckets only after they would have refilled completely', () => {
    const { limiter, advance } = setup();
    limiter.take('u1:c1');
    expect(limiter.size()).toBe(1);
    advance(1001);
    limiter.take('u9:c9');
    expect(limiter.size()).toBe(2);
    advance(10_000);
    limiter.take('u9:c9');
    expect(limiter.size()).toBe(1);
  });
});
