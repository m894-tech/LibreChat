import { Constants } from 'librechat-data-provider';
import type { TMessage, TContextUsageEvent } from 'librechat-data-provider';
import { deriveBranchSnapshot } from '../hydrate';
import { CONVO } from '../fixtures';

function message(overrides: Partial<TMessage>): TMessage {
  return {
    messageId: 'm',
    conversationId: CONVO,
    parentMessageId: Constants.NO_PARENT,
    isCreatedByUser: false,
    text: '',
    ...overrides,
  } as TMessage;
}

function snapshot(overrides: Partial<TContextUsageEvent> = {}): TContextUsageEvent {
  return {
    runId: 'run-1',
    breakdown: {
      maxContextTokens: 128_000,
      instructionTokens: 21_100,
      systemMessageTokens: 0,
      dynamicInstructionTokens: 0,
      toolSchemaTokens: 20_000,
      summaryTokens: 0,
      toolCount: 3,
      messageCount: 4,
      messageTokens: 50_900,
      availableForMessages: 0,
      toolTokenCounts: { web_search: 1_600, [`github${Constants.mcp_delimiter}search`]: 18_400 },
      toolMessageTokens: 9_900,
    },
    contextBudget: 112_000,
    ...overrides,
  };
}

/**
 *   root ── u1 ── a1 (snapshot, usage)
 *                 └─ u2 ── a2 (snapshot reconciled, usage)   ← branch A leaf
 *          └─ u3 ── a3 (snapshot, usage)                      ← branch B leaf
 */
const messages: TMessage[] = [
  message({ messageId: 'u1', isCreatedByUser: true }),
  message({
    messageId: 'a1',
    parentMessageId: 'u1',
    metadata: {
      contextUsage: snapshot({ runId: 'run-1' }),
      usage: { input: 10_000, output: 500, cacheRead: 2_000, cacheWrite: 0 },
    },
  }),
  message({ messageId: 'u2', parentMessageId: 'a1', isCreatedByUser: true }),
  message({
    messageId: 'a2',
    parentMessageId: 'u2',
    endpoint: 'anthropic',
    model: 'claude-3',
    updatedAt: '2026-09-26T10:00:00.000Z',
    metadata: {
      contextUsage: snapshot({
        runId: 'run-2',
        provider: 'anthropic',
        model: 'claude-3',
        remainingContextTokens: 112_000 - 72_000,
        completedOutputTokens: 4_000,
        cacheRead: 12_000,
        cacheWrite: 0,
      }),
      usage: { input: 60_000, output: 4_000, cacheRead: 12_000, cacheWrite: 0 },
    },
  }),
  message({ messageId: 'u3', parentMessageId: 'u1', isCreatedByUser: true }),
  message({
    messageId: 'a3',
    parentMessageId: 'u3',
    metadata: {
      contextUsage: snapshot({ runId: 'run-3' }),
      usage: { input: 999, output: 1, cacheRead: 0, cacheWrite: 0 },
    },
  }),
];

describe('deriveBranchSnapshot', () => {
  it('maps a provider-reconciled snapshot to lastCall (§10.1, §10.2, §10.5)', () => {
    const { lastCall } = deriveBranchSnapshot(CONVO, messages, 'a2', 123);
    expect(lastCall).toMatchObject({
      callId: 'run-2',
      responseMessageId: 'a2',
      branchLeafId: 'a2',
      source: 'provider',
      complete: true,
      input: 72_000,
      output: 4_000,
      cacheRead: 12_000,
      budget: { window: 128_000, reserve: 16_000, budget: 112_000, inputLimit: null },
      configuration: { endpoint: 'anthropic', provider: 'anthropic', model: 'claude-3' },
      compositionSource: 'server_estimate',
    });
    expect(lastCall?.measuredAt).toBe(Date.parse('2026-09-26T10:00:00.000Z'));
    /** Composition is split from the pre-invoke breakdown: MCP schemas out of the system prompt. */
    expect(lastCall?.composition).toMatchObject({
      mcpTools: 18_400,
      systemPrompt: 21_100 - 18_400,
      toolCalls: 9_900,
      messages: 50_900 - 9_900,
    });
  });

  it('marks an unreconciled snapshot as a server estimate, never provider data', () => {
    const { lastCall } = deriveBranchSnapshot(CONVO, messages, 'a1', 123);
    expect(lastCall).toMatchObject({
      callId: 'run-1',
      source: 'server_estimate',
      complete: false,
      input: 21_100 + 50_900,
    });
  });

  it('sums sessionUsage along the viewed branch only (§10.11, §10.24)', () => {
    const a = deriveBranchSnapshot(CONVO, messages, 'a2', 123).sessionUsage;
    expect(a).toMatchObject({
      scope: 'branch',
      branchLeafId: 'a2',
      input: 70_000,
      output: 4_500,
      cacheRead: 14_000,
      calls: 2,
      lastEventId: 'a2',
    });
    const b = deriveBranchSnapshot(CONVO, messages, 'a3', 123);
    expect(b.sessionUsage).toMatchObject({ input: 999, output: 1, calls: 1 });
    expect(b.lastCall?.callId).toBe('run-3');
  });

  it('a user leaf inherits the branch’s last response measurement', () => {
    const { lastCall, sessionUsage } = deriveBranchSnapshot(CONVO, messages, 'u2', 123);
    expect(lastCall?.callId).toBe('run-1');
    expect(sessionUsage?.calls).toBe(1);
  });

  it('is empty for an empty chat or unknown leaf', () => {
    expect(deriveBranchSnapshot(CONVO, [], Constants.NO_PARENT)).toEqual({
      lastCall: null,
      sessionUsage: null,
    });
    expect(deriveBranchSnapshot(CONVO, messages, 'missing')).toEqual({
      lastCall: null,
      sessionUsage: null,
    });
  });
});
