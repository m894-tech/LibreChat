import type { TContextStaleReason } from 'librechat-data-provider';
import type { ConversationCounterState } from '../reducer';
import { CONVO, LEAF_A, LEAF_B, usageFixture, estimateFixture, lastCallFixture } from '../fixtures';
import { EMPTY_COUNTER_STATE, reduceContextCounter } from '../reducer';

function seeded(): ConversationCounterState {
  let state = reduceContextCounter(EMPTY_COUNTER_STATE, {
    type: 'call_completed',
    previousLeafId: 'root',
    leafId: LEAF_A,
    measurement: lastCallFixture(),
    usage: usageFixture(),
  });
  state = reduceContextCounter(state, {
    type: 'estimate_requested',
    leafId: LEAF_A,
    revision: 1,
    fingerprint: 'fp-1',
  });
  return reduceContextCounter(state, {
    type: 'estimate_resolved',
    leafId: LEAF_A,
    revision: 1,
    fingerprint: 'fp-1',
    estimate: estimateFixture(),
  });
}

describe('reduceContextCounter — §7 invalidation table', () => {
  it.each<TContextStaleReason>([
    'draft_changed',
    'attachments_changed',
    'model_changed',
    'limits_changed',
    'tools_changed',
    'instructions_changed',
    'compressed',
    'history_changed',
  ])('%s dirties the forecast and leaves lastCall / sessionUsage untouched', (reason) => {
    const before = seeded();
    const after = reduceContextCounter(before, { type: 'invalidate', leafId: LEAF_A, reason });

    const entry = after.estimate.get(LEAF_A);
    expect(entry?.status).toBe('stale');
    expect(entry?.staleReason).toBe(reason);
    /** The previous numbers stay for «≈… · устарело, пересчитываем…». */
    expect(entry?.estimate).toBe(before.estimate.get(LEAF_A)?.estimate);
    /** §10.27 / §10.3: the measurement and the spend are the same references. */
    expect(after.lastCall).toBe(before.lastCall);
    expect(after.sessionUsage).toBe(before.sessionUsage);
    expect(after.lastCall.get(LEAF_A)?.configuration.model).toBe('claude');
  });

  it('is a no-op when there is nothing to invalidate', () => {
    const state = EMPTY_COUNTER_STATE;
    expect(
      reduceContextCounter(state, { type: 'invalidate', leafId: LEAF_A, reason: 'draft_changed' }),
    ).toBe(state);
    const dirty = reduceContextCounter(seeded(), {
      type: 'invalidate',
      leafId: LEAF_A,
      reason: 'draft_changed',
    });
    expect(
      reduceContextCounter(dirty, { type: 'invalidate', leafId: LEAF_A, reason: 'draft_changed' }),
    ).toBe(dirty);
  });

  it('a completed call replaces lastCall, accumulates sessionUsage and keeps the forecast stale-able', () => {
    const before = seeded();
    const after = reduceContextCounter(before, {
      type: 'call_completed',
      previousLeafId: LEAF_A,
      leafId: LEAF_B,
      measurement: lastCallFixture({ callId: 'run-2', branchLeafId: LEAF_B, input: 80_000 }),
      usage: usageFixture({ eventId: 'run-2:0', inputUncached: 70_000, output: 1_000 }),
    });

    expect(after.lastCall.get(LEAF_B)?.callId).toBe('run-2');
    expect(after.lastCall.get(LEAF_A)?.callId).toBe('run-1');
    const session = after.sessionUsage.get(LEAF_B);
    expect(session).toMatchObject({
      input: 130_000,
      output: 5_000,
      cacheRead: 24_000,
      calls: 2,
      scope: 'branch',
      branchLeafId: LEAF_B,
      lastEventId: 'run-2:0',
    });
    /** §10.22: the «Вход» row never carries cache reads. */
    expect(session?.input).toBe(60_000 + 70_000);
  });

  it('§10.13: a replayed event id does not double the spend', () => {
    const before = seeded();
    const replay = reduceContextCounter(before, {
      type: 'call_completed',
      previousLeafId: 'root',
      leafId: LEAF_A,
      measurement: lastCallFixture(),
      usage: usageFixture(),
    });
    expect(replay).toBe(before);
    expect(replay.sessionUsage.get(LEAF_A)?.calls).toBe(1);
  });

  it('tool-loop calls on the same new leaf continue that leaf’s running total', () => {
    let state = seeded();
    state = reduceContextCounter(state, {
      type: 'call_completed',
      previousLeafId: LEAF_A,
      leafId: LEAF_B,
      measurement: lastCallFixture({ callId: 'run-2', branchLeafId: LEAF_B }),
      usage: usageFixture({ eventId: 'run-2:0', inputUncached: 10 }),
    });
    state = reduceContextCounter(state, {
      type: 'call_completed',
      previousLeafId: LEAF_A,
      leafId: LEAF_B,
      measurement: lastCallFixture({ callId: 'run-2', branchLeafId: LEAF_B, input: 99 }),
      usage: usageFixture({ eventId: 'run-2:1', inputUncached: 20 }),
    });
    expect(state.sessionUsage.get(LEAF_B)).toMatchObject({ input: 60_000 + 30, calls: 3 });
    expect(state.lastCall.get(LEAF_B)?.input).toBe(99);
  });

  it('auxiliary and compress calls are counted inside the totals and shown «в том числе»', () => {
    let state = reduceContextCounter(EMPTY_COUNTER_STATE, {
      type: 'call_completed',
      previousLeafId: 'root',
      leafId: LEAF_A,
      measurement: lastCallFixture(),
      usage: usageFixture({ eventId: 'e1', inputUncached: 100, kind: 'auxiliary' }),
    });
    state = reduceContextCounter(state, {
      type: 'call_completed',
      previousLeafId: 'root',
      leafId: LEAF_A,
      measurement: lastCallFixture(),
      usage: usageFixture({ eventId: 'e2', inputUncached: 50, kind: 'compress' }),
    });
    const session = state.sessionUsage.get(LEAF_A);
    expect(session?.input).toBe(150);
    expect(session?.auxiliary?.input).toBe(100);
    expect(session?.compress?.input).toBe(50);
  });

  it('one non-splittable provider hides the cache rows for the whole branch (§5)', () => {
    const state = reduceContextCounter(
      reduceContextCounter(EMPTY_COUNTER_STATE, {
        type: 'call_completed',
        previousLeafId: 'root',
        leafId: LEAF_A,
        measurement: lastCallFixture(),
        usage: usageFixture({ eventId: 'e1' }),
      }),
      {
        type: 'call_completed',
        previousLeafId: 'root',
        leafId: LEAF_A,
        measurement: lastCallFixture(),
        usage: usageFixture({ eventId: 'e2', cacheSplittable: false }),
      },
    );
    expect(state.sessionUsage.get(LEAF_A)?.cacheSplittable).toBe(false);
  });
});

describe('reduceContextCounter — estimate revisions (§10.15, §10.26)', () => {
  it('drops an answer whose revision is no longer pending', () => {
    let state = reduceContextCounter(EMPTY_COUNTER_STATE, {
      type: 'estimate_requested',
      leafId: LEAF_A,
      revision: 1,
      fingerprint: 'fp-1',
    });
    state = reduceContextCounter(state, {
      type: 'estimate_requested',
      leafId: LEAF_A,
      revision: 2,
      fingerprint: 'fp-2',
    });
    const late = reduceContextCounter(state, {
      type: 'estimate_resolved',
      leafId: LEAF_A,
      revision: 1,
      fingerprint: 'fp-1',
      estimate: estimateFixture({ revision: 1 }),
    });
    expect(late).toBe(state);
    expect(late.estimate.get(LEAF_A)?.status).toBe('calculating');

    const current = reduceContextCounter(late, {
      type: 'estimate_resolved',
      leafId: LEAF_A,
      revision: 2,
      fingerprint: 'fp-2',
      estimate: estimateFixture({ revision: 2 }),
    });
    expect(current.estimate.get(LEAF_A)).toMatchObject({
      status: 'fresh',
      fingerprint: 'fp-2',
      pendingRevision: null,
    });
  });

  it('Send retires the in-flight request: its answer never lands afterwards', () => {
    let state = seeded();
    state = reduceContextCounter(state, {
      type: 'estimate_requested',
      leafId: LEAF_A,
      revision: 2,
      fingerprint: 'fp-2',
    });
    state = reduceContextCounter(state, { type: 'invalidate', leafId: LEAF_A, reason: 'sent' });
    expect(state.estimate.get(LEAF_A)).toMatchObject({
      status: 'stale',
      staleReason: 'sent',
      pendingRevision: null,
    });
    const afterSend = reduceContextCounter(state, {
      type: 'estimate_resolved',
      leafId: LEAF_A,
      revision: 2,
      fingerprint: 'fp-2',
      estimate: estimateFixture({
        revision: 2,
        occupied: { ...estimateFixture().occupied, other: 1 },
      }),
    });
    expect(afterSend).toBe(state);
  });

  it('an answer for another branch is never stored under the current leaf (§10.11)', () => {
    const state = reduceContextCounter(EMPTY_COUNTER_STATE, {
      type: 'estimate_requested',
      leafId: LEAF_A,
      revision: 1,
      fingerprint: 'fp-1',
    });
    const foreign = reduceContextCounter(state, {
      type: 'estimate_resolved',
      leafId: LEAF_A,
      revision: 1,
      fingerprint: 'fp-1',
      estimate: estimateFixture({ branchLeafId: LEAF_B }),
    });
    expect(foreign).toBe(state);
  });

  it('a failure with the pending revision becomes `error` and keeps the previous numbers', () => {
    let state = seeded();
    state = reduceContextCounter(state, {
      type: 'estimate_requested',
      leafId: LEAF_A,
      revision: 2,
      fingerprint: 'fp-2',
    });
    state = reduceContextCounter(state, {
      type: 'estimate_failed',
      leafId: LEAF_A,
      revision: 2,
      errorCode: 'http_500',
    });
    expect(state.estimate.get(LEAF_A)).toMatchObject({ status: 'error', errorCode: 'http_500' });
    expect(state.estimate.get(LEAF_A)?.estimate).not.toBeNull();
  });

  it('derives partial / unavailable from the server answer', () => {
    const requested = reduceContextCounter(EMPTY_COUNTER_STATE, {
      type: 'estimate_requested',
      leafId: LEAF_A,
      revision: 1,
      fingerprint: 'fp',
    });
    const partial = reduceContextCounter(requested, {
      type: 'estimate_resolved',
      leafId: LEAF_A,
      revision: 1,
      fingerprint: 'fp',
      estimate: estimateFixture({ incompleteReasons: ['attachment_pending'] }),
    });
    expect(partial.estimate.get(LEAF_A)?.status).toBe('partial');
    const unavailable = reduceContextCounter(requested, {
      type: 'estimate_resolved',
      leafId: LEAF_A,
      revision: 1,
      fingerprint: 'fp',
      estimate: estimateFixture({ source: 'unavailable' }),
    });
    expect(unavailable.estimate.get(LEAF_A)?.status).toBe('unavailable');
  });
});

describe('reduceContextCounter — hydration (§7 «перезагрузка», §10.11, §10.12)', () => {
  it('fills a branch from its snapshot without touching a sibling branch', () => {
    const state = reduceContextCounter(seeded(), {
      type: 'hydrate',
      leafId: LEAF_B,
      lastCall: lastCallFixture({ callId: 'run-b', branchLeafId: LEAF_B, input: 10 }),
      sessionUsage: null,
      estimate: estimateFixture({ branchLeafId: LEAF_B }),
    });
    expect(state.lastCall.get(LEAF_A)?.callId).toBe('run-1');
    expect(state.lastCall.get(LEAF_B)?.callId).toBe('run-b');
    expect(state.sessionUsage.has(LEAF_B)).toBe(false);
    /** A persisted forecast cannot prove currency: it arrives stale. */
    expect(state.estimate.get(LEAF_B)).toMatchObject({ status: 'stale', staleReason: 'unknown' });
  });

  it('never overwrites a newer local measurement or a live forecast', () => {
    const before = seeded();
    const after = reduceContextCounter(before, {
      type: 'hydrate',
      leafId: LEAF_A,
      lastCall: lastCallFixture({ callId: 'older', measuredAt: 1 }),
      estimate: estimateFixture({ occupied: { ...estimateFixture().occupied, other: 5 } }),
    });
    expect(after).toBe(before);
  });

  it('re-deriving the same persisted data yields the same references', () => {
    const measurement = lastCallFixture({ callId: 'persisted', measuredAt: 5 });
    const once = reduceContextCounter(EMPTY_COUNTER_STATE, {
      type: 'hydrate',
      leafId: LEAF_A,
      lastCall: measurement,
      sessionUsage: {
        ...usageTotals(),
        version: 1,
        conversationId: CONVO,
        branchLeafId: LEAF_A,
        scope: 'branch',
        complete: true,
        cacheSplittable: true,
        updatedAt: 10,
      },
    });
    const twice = reduceContextCounter(once, {
      type: 'hydrate',
      leafId: LEAF_A,
      lastCall: { ...measurement, measuredAt: 6 },
      sessionUsage: {
        ...usageTotals(),
        version: 1,
        conversationId: CONVO,
        branchLeafId: LEAF_A,
        scope: 'branch',
        complete: true,
        cacheSplittable: true,
        updatedAt: 11,
      },
    });
    expect(twice).toBe(once);
  });
});

function usageTotals() {
  return { input: 1, output: 2, cacheRead: 3, cacheWrite: 0, calls: 1 };
}
