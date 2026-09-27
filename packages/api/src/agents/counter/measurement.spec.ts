import { computeContextFillPercent, formatContextPercent } from 'librechat-data-provider';
import type { TTokenUsageEvent, TContextUsageEvent } from 'librechat-data-provider';
import {
  buildLastCallMeasurement,
  compositionFromSnapshot,
  budgetFromSnapshot,
  lastCallFromPersistedContextUsage,
} from './measurement';

/** W = 128 000, B = 112 000 → R = 16 000 (§10.1). */
const snapshot: TContextUsageEvent = {
  runId: 'run-1',
  breakdown: {
    maxContextTokens: 128_000,
    instructionTokens: 20_000,
    systemMessageTokens: 500,
    dynamicInstructionTokens: 100,
    toolSchemaTokens: 6_000,
    summaryTokens: 2_000,
    toolCount: 3,
    messageCount: 12,
    messageTokens: 40_000,
    availableForMessages: 90_000,
    toolTokenCounts: { web_search: 1_000, read_file_mcp_github: 4_000, list_mcp_github: 1_000 },
    toolMessageTokens: 9_000,
  },
  contextBudget: 112_000,
};

const base = { conversationId: 'convo-1', responseMessageId: 'resp-1', measuredAt: 1_000 };

describe('buildLastCallMeasurement — §5 normalization by payload shape', () => {
  it('Anthropic (SDK folds cache into input_tokens): input counted once, cache rows split', () => {
    const events: TTokenUsageEvent[] = [
      {
        input_tokens: 72_000,
        output_tokens: 4_000,
        total_tokens: 76_000,
        input_token_details: { cache_read: 50_000, cache_creation: 10_000 },
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        runId: 'run-1',
        seq: 1,
      },
    ];
    const measurement = buildLastCallMeasurement({ ...base, usageEvents: events, snapshot });
    expect(measurement).toMatchObject({
      version: 1,
      conversationId: 'convo-1',
      branchLeafId: 'resp-1',
      callId: 'run-1:1',
      source: 'provider',
      complete: true,
      input: 72_000,
      output: 4_000,
      cacheRead: 50_000,
      cacheWrite: 10_000,
      configuration: { provider: 'anthropic', model: 'claude-sonnet-4' },
      budget: { window: 128_000, reserve: 16_000, inputLimit: null, budget: 112_000 },
      compositionSource: 'server_estimate',
    });
    /** §10.1: 72 000 / 112 000 → 64% of THIS call's budget. */
    expect(computeContextFillPercent(72_000, measurement!.budget.budget)).toBeCloseTo(64.2857, 3);
    expect(formatContextPercent(72_000, measurement!.budget.budget)).toBe('64%');
  });

  it('Anthropic raw API shape (cache outside input_tokens) is added exactly once', () => {
    const events = [
      {
        input_tokens: 12_000,
        output_tokens: 300,
        cache_read_input_tokens: 50_000,
        cache_creation_input_tokens: 10_000,
        model: 'claude-sonnet-4',
        provider: 'anthropic',
        runId: 'run-1',
        seq: 1,
      } as TTokenUsageEvent,
    ];
    const measurement = buildLastCallMeasurement({ ...base, usageEvents: events, snapshot });
    expect(measurement).toMatchObject({
      input: 72_000,
      cacheRead: 50_000,
      cacheWrite: 10_000,
      output: 300,
    });
  });

  it('OpenAI: cached_tokens is a subset of prompt_tokens, never added twice (§10.22)', () => {
    const events = [
      {
        prompt_tokens: 30_000,
        completion_tokens: 1_200,
        prompt_tokens_details: { cached_tokens: 20_000 },
        model: 'gpt-4.1',
        provider: 'openAI',
        runId: 'run-1',
        seq: 1,
      } as unknown as TTokenUsageEvent,
    ];
    const measurement = buildLastCallMeasurement({ ...base, usageEvents: events, snapshot });
    expect(measurement).toMatchObject({
      input: 30_000,
      output: 1_200,
      cacheRead: 20_000,
      cacheWrite: 0,
    });
  });

  it('OpenAI via the SDK (input_tokens + input_token_details): subset provider keeps input as is', () => {
    const events: TTokenUsageEvent[] = [
      {
        input_tokens: 30_000,
        output_tokens: 1_200,
        total_tokens: 31_200,
        input_token_details: { cache_read: 20_000 },
        model: 'gpt-4.1',
        provider: 'openAI',
        runId: 'run-1',
        seq: 1,
      },
    ];
    expect(buildLastCallMeasurement({ ...base, usageEvents: events, snapshot })).toMatchObject({
      input: 30_000,
      cacheRead: 20_000,
      cacheWrite: 0,
    });
  });

  it('Gemini: promptTokenCount already includes cachedContentTokenCount', () => {
    const events = [
      {
        promptTokenCount: 18_000,
        candidatesTokenCount: 900,
        cachedContentTokenCount: 15_000,
        thoughtsTokenCount: 100,
        totalTokenCount: 19_000,
        model: 'gemini-2.5-pro',
        provider: 'google',
        runId: 'run-1',
        seq: 1,
      } as unknown as TTokenUsageEvent,
    ];
    expect(buildLastCallMeasurement({ ...base, usageEvents: events, snapshot })).toMatchObject({
      input: 18_000,
      output: 1_000,
      cacheRead: 15_000,
      cacheWrite: 0,
    });
  });

  it('Bedrock (additive): cache reported outside input_tokens is added back once', () => {
    const events: TTokenUsageEvent[] = [
      {
        input_tokens: 10_000,
        output_tokens: 500,
        input_token_details: { cache_read: 60_000, cache_creation: 2_000 },
        provider: 'bedrock',
        model: 'anthropic.claude-sonnet',
        runId: 'run-1',
        seq: 1,
      },
    ];
    expect(buildLastCallMeasurement({ ...base, usageEvents: events, snapshot })).toMatchObject({
      input: 72_000,
      cacheRead: 60_000,
      cacheWrite: 2_000,
    });
  });

  it('unknown provider: only the confirmed total is kept, cache split withheld', () => {
    const events: TTokenUsageEvent[] = [
      {
        input_tokens: 1_000,
        output_tokens: 100,
        input_token_details: { cache_read: 400 },
        runId: 'run-1',
        seq: 1,
      },
    ];
    const measurement = buildLastCallMeasurement({ ...base, usageEvents: events, snapshot });
    expect(measurement).toMatchObject({ input: 1_000, output: 100, cacheRead: 0, cacheWrite: 0 });
    expect(measurement?.configuration.provider).toBeUndefined();
  });

  it('completed output is never added to the call input (§10.2)', () => {
    const events: TTokenUsageEvent[] = [
      {
        input_tokens: 72_000,
        output_tokens: 4_000,
        total_tokens: 76_000,
        provider: 'openAI',
        runId: 'run-1',
        seq: 1,
      },
    ];
    const measurement = buildLastCallMeasurement({ ...base, usageEvents: events, snapshot });
    expect(measurement?.input).toBe(72_000);
    expect(measurement?.output).toBe(4_000);
  });

  it('measures the FINAL primary call of a tool loop, skipping auxiliary and summary calls', () => {
    const events: TTokenUsageEvent[] = [
      { input_tokens: 10_000, output_tokens: 50, provider: 'openAI', runId: 'run-1', seq: 1 },
      {
        input_tokens: 500,
        output_tokens: 20,
        provider: 'openAI',
        usage_type: 'summarization',
        runId: 'run-1',
        seq: 2,
      },
      { input_tokens: 20_000, output_tokens: 700, provider: 'openAI', runId: 'run-1', seq: 3 },
      {
        input_tokens: 90,
        output_tokens: 9,
        provider: 'openAI',
        usage_type: 'activity-label',
        runId: 'resp-1:1',
        seq: -1,
      },
    ];
    const measurement = buildLastCallMeasurement({ ...base, usageEvents: events, snapshot });
    expect(measurement?.callId).toBe('run-1:3');
    expect(measurement?.input).toBe(20_000);
    expect(measurement?.output).toBe(700);
  });

  it('returns nothing when no primary call reported usage (aborted / usage-less turn)', () => {
    expect(buildLastCallMeasurement({ ...base, usageEvents: [], snapshot })).toBeUndefined();
    expect(
      buildLastCallMeasurement({
        ...base,
        usageEvents: [
          { input_tokens: 5, output_tokens: 1, usage_type: 'subagent', provider: 'openAI' },
        ],
        snapshot,
      }),
    ).toBeUndefined();
  });

  it('keeps only the confirmed total when the snapshot belongs to another run', () => {
    const events: TTokenUsageEvent[] = [
      { input_tokens: 9_000, output_tokens: 100, provider: 'openAI', runId: 'run-2', seq: 1 },
    ];
    const measurement = buildLastCallMeasurement({ ...base, usageEvents: events, snapshot });
    expect(measurement).toMatchObject({
      input: 9_000,
      complete: false,
      composition: null,
      compositionSource: 'unavailable',
      budget: { window: null, reserve: 0, inputLimit: null, budget: null },
    });
  });

  it('records the configuration the measurement was taken for', () => {
    const events: TTokenUsageEvent[] = [
      { input_tokens: 9_000, output_tokens: 100, provider: 'openAI', model: 'gpt-4.1' },
    ];
    const measurement = buildLastCallMeasurement({
      ...base,
      usageEvents: events,
      snapshot,
      endpoint: 'agents',
      agentId: 'agent_1',
    });
    expect(measurement?.configuration).toEqual({
      endpoint: 'agents',
      provider: 'openAI',
      model: 'gpt-4.1',
      agentId: 'agent_1',
    });
    expect(measurement?.callId).toBe('resp-1:final');
  });
});

describe('budgetFromSnapshot', () => {
  it('derives R from W − contextBudget and B = W − R', () => {
    expect(budgetFromSnapshot(snapshot)).toEqual({
      window: 128_000,
      reserve: 16_000,
      inputLimit: null,
      budget: 112_000,
    });
  });

  it('treats a snapshot without contextBudget as reserve 0 (B = W), like the live gauge', () => {
    const { contextBudget: _omit, ...withoutBudget } = snapshot;
    expect(budgetFromSnapshot(withoutBudget)).toEqual({
      window: 128_000,
      reserve: 0,
      inputLimit: null,
      budget: 128_000,
    });
  });

  it('is unknown without a window', () => {
    expect(
      budgetFromSnapshot({ breakdown: { ...snapshot.breakdown, maxContextTokens: 0 } }),
    ).toEqual({ window: null, reserve: 0, inputLimit: null, budget: null });
  });
});

describe('compositionFromSnapshot', () => {
  it('partitions the confirmed input so the ● segments sum to it exactly (§10.21)', () => {
    const composition = compositionFromSnapshot(snapshot, 72_000);
    const sum = Object.values(composition).reduce((total, value) => total + value, 0);
    expect(sum).toBe(72_000);
    expect(composition).toEqual({
      systemPrompt: 15_000,
      mcpTools: 5_000,
      messages: 33_000,
      toolCalls: 9_000,
      attachments: 0,
      other: 10_000,
    });
  });

  it('never exceeds the confirmed input when the rows over-explain it', () => {
    const composition = compositionFromSnapshot(snapshot, 18_000);
    expect(Object.values(composition).reduce((total, value) => total + value, 0)).toBe(18_000);
    expect(composition.systemPrompt).toBe(15_000);
    expect(composition.mcpTools).toBe(3_000);
    expect(composition.messages).toBe(0);
  });
});

describe('lastCallFromPersistedContextUsage (pre-`metadata.lastCall` responses)', () => {
  it('maps a reconciled contextUsage blob into an incomplete provider measurement', () => {
    const persisted: TContextUsageEvent = {
      ...snapshot,
      model: 'gpt-4.1',
      provider: 'openAI',
      cacheRead: 1_000,
      cacheWrite: 0,
      completedOutputTokens: 800,
    };
    const measurement = lastCallFromPersistedContextUsage({
      conversationId: 'convo-1',
      responseMessageId: 'resp-0',
      contextUsage: persisted,
      measuredAt: 5,
    });
    expect(measurement).toMatchObject({
      callId: 'run-1:persisted',
      complete: false,
      source: 'provider',
      input: 62_000,
      output: 800,
      cacheRead: 1_000,
      budget: { budget: 112_000 },
      configuration: { provider: 'openAI', model: 'gpt-4.1' },
    });
  });

  it('refuses a blob without a provider — that would not be provider data (§10.5)', () => {
    expect(
      lastCallFromPersistedContextUsage({
        conversationId: 'convo-1',
        responseMessageId: 'resp-0',
        contextUsage: snapshot,
        measuredAt: 5,
      }),
    ).toBeUndefined();
  });
});
