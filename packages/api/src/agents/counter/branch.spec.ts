import { Constants } from 'librechat-data-provider';
import type { TContextLastCallMeasurement, TResponseUsage } from 'librechat-data-provider';
import type { BranchUsageMessage } from './branch';
import { readBranchContextUsage, branchChain } from './branch';

const rollup = (
  input: number,
  output: number,
  extra: Partial<TResponseUsage> = {},
): TResponseUsage => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  calls: 1,
  ...extra,
});

const lastCall = (responseMessageId: string, input: number): TContextLastCallMeasurement => ({
  version: 1,
  conversationId: 'convo',
  branchLeafId: responseMessageId,
  callId: `${responseMessageId}:1`,
  responseMessageId,
  measuredAt: 1,
  configuration: { provider: 'openAI', model: 'gpt-4.1' },
  source: 'provider',
  complete: true,
  budget: { window: 128_000, reserve: 16_000, inputLimit: null, budget: 112_000 },
  input,
  output: 10,
  cacheRead: 0,
  cacheWrite: 0,
  composition: null,
  compositionSource: 'unavailable',
});

const user = (messageId: string, parentMessageId: string): BranchUsageMessage => ({
  messageId,
  parentMessageId,
  isCreatedByUser: true,
});

const assistant = (
  messageId: string,
  parentMessageId: string,
  metadata: Record<string, unknown> | null = null,
): BranchUsageMessage => ({
  messageId,
  parentMessageId,
  isCreatedByUser: false,
  endpoint: 'agents',
  metadata,
});

/**
 *   u1 ─ a1 ─ u2 ─ a2   (branch A, leaf a2)
 *              └─ u2b ─ a2b   (branch B, leaf a2b — an edit of u2)
 */
const forked: BranchUsageMessage[] = [
  user('u1', Constants.NO_PARENT),
  assistant('a1', 'u1', { usage: rollup(100, 10), lastCall: lastCall('a1', 100) }),
  user('u2', 'a1'),
  assistant('a2', 'u2', {
    usage: rollup(200, 20, {
      auxiliary: { input: 50, output: 5, cacheRead: 0, cacheWrite: 0, calls: 1 },
      calls: 2,
    }),
    lastCall: lastCall('a2', 200),
  }),
  user('u2b', 'a1'),
  assistant('a2b', 'u2b', {
    usage: rollup(900, 90, {
      compress: { input: 400, output: 40, cacheRead: 0, cacheWrite: 0, calls: 1 },
      calls: 2,
    }),
    lastCall: lastCall('a2b', 900),
  }),
];

describe('branchChain', () => {
  it('follows parentMessageId root-ward and stops at the root', () => {
    expect(branchChain(forked, 'a2').map((m) => m.messageId)).toEqual(['a2', 'u2', 'a1', 'u1']);
  });

  it('survives a cycle and a missing parent', () => {
    const cyclic: BranchUsageMessage[] = [
      assistant('x', 'y'),
      assistant('y', 'x'),
      assistant('z', 'missing'),
    ];
    expect(branchChain(cyclic, 'x').map((m) => m.messageId)).toEqual(['x', 'y']);
    expect(branchChain(cyclic, 'z').map((m) => m.messageId)).toEqual(['z']);
  });
});

describe('readBranchContextUsage', () => {
  it('sums only the requested branch and takes the last call nearest its leaf (§10.11, §10.24)', () => {
    const branchA = readBranchContextUsage({
      conversationId: 'convo',
      leafId: 'a2',
      messages: forked,
      now: 42,
    });
    expect(branchA?.sessionUsage).toEqual({
      version: 1,
      conversationId: 'convo',
      branchLeafId: 'a2',
      scope: 'branch',
      complete: true,
      cacheSplittable: true,
      input: 300,
      output: 30,
      cacheRead: 0,
      cacheWrite: 0,
      calls: 3,
      auxiliary: { input: 50, output: 5, cacheRead: 0, cacheWrite: 0, calls: 1 },
      updatedAt: 42,
    });
    expect(branchA?.lastCall?.responseMessageId).toBe('a2');
    expect(branchA?.lastCall?.input).toBe(200);

    const branchB = readBranchContextUsage({
      conversationId: 'convo',
      leafId: 'a2b',
      messages: forked,
    });
    expect(branchB?.sessionUsage).toMatchObject({
      branchLeafId: 'a2b',
      input: 1000,
      output: 100,
      calls: 3,
      compress: { input: 400, output: 40, calls: 1 },
    });
    expect(branchB?.sessionUsage.auxiliary).toBeUndefined();
    expect(branchB?.lastCall?.responseMessageId).toBe('a2b');
  });

  it('reads the same values for the same branch every time (§10.12)', () => {
    const first = readBranchContextUsage({
      conversationId: 'convo',
      leafId: 'a2',
      messages: forked,
      now: 1,
    });
    const second = readBranchContextUsage({
      conversationId: 'convo',
      leafId: 'a2',
      messages: [...forked].reverse(),
      now: 1,
    });
    expect(second).toEqual(first);
  });

  it('a user-message leaf reads the branch up to it, without the sibling response', () => {
    const snapshot = readBranchContextUsage({
      conversationId: 'convo',
      leafId: 'u2b',
      messages: forked,
    });
    expect(snapshot?.sessionUsage).toMatchObject({ input: 100, output: 10, calls: 1 });
    expect(snapshot?.lastCall?.responseMessageId).toBe('a1');
  });

  it('keeps the previous measurement when the latest response reported nothing, and marks the session incomplete', () => {
    const messages = [...forked, user('u3', 'a2'), assistant('a3', 'u3', null)];
    const snapshot = readBranchContextUsage({ conversationId: 'convo', leafId: 'a3', messages });
    expect(snapshot?.sessionUsage.complete).toBe(false);
    expect(snapshot?.sessionUsage.input).toBe(300);
    expect(snapshot?.lastCall?.responseMessageId).toBe('a2');
  });

  it('ignores error responses without marking the session incomplete', () => {
    const messages = [...forked, user('u3', 'a2'), { ...assistant('a3', 'u3', null), error: true }];
    const snapshot = readBranchContextUsage({ conversationId: 'convo', leafId: 'a3', messages });
    expect(snapshot?.sessionUsage.complete).toBe(true);
    expect(snapshot?.sessionUsage.input).toBe(300);
  });

  it('hides the cache rows when one response could not split cache honestly (§5, §10.22)', () => {
    const messages: BranchUsageMessage[] = [
      user('u1', Constants.NO_PARENT),
      assistant('a1', 'u1', {
        usage: rollup(600, 100, { cacheRead: 400, cacheSplittable: false }),
      }),
      user('u2', 'a1'),
      assistant('a2', 'u2', { usage: rollup(70, 10, { cacheRead: 50, cacheWrite: 30 }) }),
    ];
    const snapshot = readBranchContextUsage({ conversationId: 'convo', leafId: 'a2', messages });
    expect(snapshot?.sessionUsage).toMatchObject({
      cacheSplittable: false,
      input: 600 + 400 + 70 + 50 + 30,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it('falls back to metadata.contextUsage for responses saved before metadata.lastCall', () => {
    const messages: BranchUsageMessage[] = [
      user('u1', Constants.NO_PARENT),
      {
        ...assistant('a1', 'u1', {
          usage: rollup(50, 5),
          contextUsage: {
            runId: 'run-old',
            provider: 'anthropic',
            model: 'claude',
            completedOutputTokens: 5,
            contextBudget: 100,
            breakdown: {
              maxContextTokens: 120,
              instructionTokens: 20,
              summaryTokens: 0,
              messageTokens: 30,
            },
          },
        }),
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const snapshot = readBranchContextUsage({ conversationId: 'convo', leafId: 'a1', messages });
    expect(snapshot?.lastCall).toMatchObject({
      callId: 'run-old:persisted',
      complete: false,
      input: 50,
      output: 5,
      budget: { window: 120, reserve: 20, budget: 100 },
      measuredAt: Date.parse('2026-01-01T00:00:00.000Z'),
    });
  });

  it('counts a legacy rollup without `calls` as at least one call', () => {
    const messages: BranchUsageMessage[] = [
      user('u1', Constants.NO_PARENT),
      assistant('a1', 'u1', { usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 } }),
    ];
    expect(
      readBranchContextUsage({ conversationId: 'convo', leafId: 'a1', messages })?.sessionUsage
        .calls,
    ).toBe(1);
  });

  it('returns null when the leaf is not part of the conversation', () => {
    expect(
      readBranchContextUsage({ conversationId: 'convo', leafId: 'nope', messages: forked }),
    ).toBeNull();
  });
});
