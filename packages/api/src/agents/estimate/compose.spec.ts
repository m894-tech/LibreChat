import { Constants, sumContextOccupied } from 'librechat-data-provider';
import type { ContextUsageEvent } from '@librechat/agents';
import type { EstimateFormattedMessage, EstimateSourceMessage } from './compose';
import {
  composeOccupied,
  composeEstimateError,
  composeExclusionPlan,
  composeNextRequestEstimate,
} from './compose';

const mcpTool = `search${Constants.mcp_delimiter}github`;

function usage(overrides: Partial<ContextUsageEvent> = {}): ContextUsageEvent {
  return {
    breakdown: {
      maxContextTokens: 100_000,
      instructionTokens: 2_200,
      systemMessageTokens: 1_000,
      dynamicInstructionTokens: 100,
      toolSchemaTokens: 900,
      summaryTokens: 200,
      toolCount: 2,
      messageCount: 4,
      messageTokens: 5_000,
      availableForMessages: 90_000,
      toolTokenCounts: { add: 300, [mcpTool]: 600 },
      toolMessageTokens: 1_200,
    },
    contextBudget: 95_000,
    effectiveInstructionTokens: 2_200,
    prePruneContextTokens: 7_000,
    remainingContextTokens: 95_000 - 2_200 - 5_000,
    calibrationRatio: 1,
    ...overrides,
  };
}

function formatted(ids: Array<string | undefined>): EstimateFormattedMessage[] {
  return ids.map((id) => ({ additional_kwargs: id == null ? {} : { sourceMessageId: id } }));
}

const sources: EstimateSourceMessage[] = [
  { messageId: 'm1', isCreatedByUser: true, text: 'first question', tokenCount: 10 },
  { messageId: 'm2', isCreatedByUser: false, text: 'first answer', tokenCount: 20 },
  { messageId: 'm3', isCreatedByUser: true, text: 'second question', tokenCount: 12 },
  { messageId: 'm4', isCreatedByUser: false, text: 'second answer', tokenCount: 22 },
];

const identity = { conversationId: 'c1', branchLeafId: 'm4' };
const configuration = { provider: 'openAI', model: 'gpt-4o', agentId: 'a1' };

describe('composeOccupied (§5)', () => {
  it('splits the SDK breakdown into ● segments that sum to the header', () => {
    const occupied = composeOccupied(usage(), 0);
    expect(occupied.mcpTools).toBe(600);
    expect(occupied.systemPrompt).toBe(1_000 + 300);
    expect(occupied.toolCalls).toBe(1_200);
    expect(occupied.messages).toBe(5_000 - 1_200 + 200);
    expect(occupied.attachments).toBe(0);
    expect(sumContextOccupied(occupied)).toBe(95_000 - (95_000 - 2_200 - 5_000));
  });

  it('separates the draft attachments from messages and scales them by calibration', () => {
    const occupied = composeOccupied(usage({ calibrationRatio: 1.5 }), 1_000);
    expect(occupied.attachments).toBe(1_500);
    expect(occupied.messages).toBe(5_000 - 1_200 - 1_500 + 200);
    expect(sumContextOccupied(occupied)).toBe(2_200 + 5_000);
  });

  it('absorbs a calibration shortfall in systemPrompt instead of going negative', () => {
    const occupied = composeOccupied(
      usage({ effectiveInstructionTokens: 1_500, remainingContextTokens: 95_000 - 1_500 - 5_000 }),
      0,
    );
    expect(Object.values(occupied).every((value) => value >= 0)).toBe(true);
    expect(sumContextOccupied(occupied)).toBe(1_500 + 5_000);
  });
});

describe('composeExclusionPlan (§4)', () => {
  it('returns null when everything fits', () => {
    expect(
      composeExclusionPlan(usage(), formatted(['m1', 'm2', 'm3', 'm4']), sources, false, 20),
    ).toBeNull();
  });

  it('counts only source messages with no surviving part, oldest first', () => {
    const plan = composeExclusionPlan(
      usage({ breakdown: { ...usage().breakdown, messageCount: 2 } }),
      formatted(['m1', 'm2', 'm2', 'm3', 'm4']),
      sources,
      false,
      20,
    );
    expect(plan).not.toBeNull();
    expect(plan?.count).toBe(2);
    expect(plan?.reason).toBe('over_budget');
    expect(plan?.messages.map((message) => message.messageId)).toEqual(['m1', 'm2']);
    expect(plan?.messages[0]).toMatchObject({
      role: 'user',
      preview: 'first question',
      tokens: 10,
    });
    expect(plan?.prePruneTokens).toBe(7_000 + 2_200);
  });

  it('reports summarized when Send would summarize instead of dropping', () => {
    const plan = composeExclusionPlan(
      usage({ breakdown: { ...usage().breakdown, messageCount: 3 } }),
      formatted(['m1', 'm2', 'm3', 'm4']),
      sources,
      true,
      1,
    );
    expect(plan?.reason).toBe('summarized');
    expect(plan?.count).toBe(1);
    expect(plan?.messages).toHaveLength(1);
  });

  it('keeps the count authoritative when previews are capped', () => {
    const plan = composeExclusionPlan(
      usage({ breakdown: { ...usage().breakdown, messageCount: 1 } }),
      formatted(['m1', 'm2', 'm3', 'm4']),
      sources,
      false,
      1,
    );
    expect(plan?.count).toBe(3);
    expect(plan?.messages).toHaveLength(1);
  });
});

describe('composeNextRequestEstimate (§7)', () => {
  const baseParams = {
    identity,
    revision: 7,
    fingerprint: 'abc',
    computedAt: 1_700_000_000_000,
    configuration,
    window: 128_000,
    outputReserve: 16_000,
    usage: usage(),
    formattedMessages: formatted(['m1', 'm2', 'm3', 'm4']),
    sourceMessages: sources,
    draftAttachmentTokens: 0,
    summarizationEnabled: false,
    incompleteReasons: [],
    maxExcludedPreviews: 20,
  };

  it('is a fresh server estimate with B = W − R and no cache guess', () => {
    const estimate = composeNextRequestEstimate(baseParams);
    expect(estimate).toMatchObject({
      version: 1,
      conversationId: 'c1',
      branchLeafId: 'm4',
      revision: 7,
      fingerprint: 'abc',
      status: 'fresh',
      source: 'server_estimate',
      budget: { window: 128_000, reserve: 16_000, inputLimit: null, budget: 112_000 },
      cache: { read: null, write: null },
      excluded: null,
    });
    expect(estimate.incompleteReasons).toBeUndefined();
  });

  it('keeps B ≤ 0 as a real state without NaN when the reserve eats the window', () => {
    const estimate = composeNextRequestEstimate({
      ...baseParams,
      window: 8_000,
      outputReserve: 8_000,
    });
    expect(estimate.budget.budget).toBe(0);
    expect(Number.isNaN(estimate.budget.budget)).toBe(false);
    expect(sumContextOccupied(estimate.occupied)).toBeGreaterThan(0);
  });

  it('reports a null budget when the window is unknown', () => {
    const estimate = composeNextRequestEstimate({ ...baseParams, window: null });
    expect(estimate.budget).toEqual({
      window: null,
      reserve: 16_000,
      inputLimit: null,
      budget: null,
    });
  });

  it('is partial with its reasons when processing is still pending', () => {
    const estimate = composeNextRequestEstimate({
      ...baseParams,
      incompleteReasons: ['attachment_pending', 'attachment_pending', 'tool_schemas_pending'],
    });
    expect(estimate.status).toBe('partial');
    expect(estimate.incompleteReasons).toEqual(['attachment_pending', 'tool_schemas_pending']);
  });

  it('is unavailable without a tokenizer projection — never a chars/4 guess', () => {
    const estimate = composeNextRequestEstimate({ ...baseParams, usage: null });
    expect(estimate.status).toBe('unavailable');
    expect(estimate.source).toBe('unavailable');
    expect(estimate.incompleteReasons).toEqual(['tokenizer_unavailable']);
    expect(sumContextOccupied(estimate.occupied)).toBe(0);
    expect(estimate.excluded).toBeNull();
  });

  it('builds an error entry that still carries identity and revision', () => {
    const estimate = composeEstimateError({
      identity,
      revision: 9,
      computedAt: 1,
      configuration,
      errorCode: 'ESTIMATE_FAILED',
    });
    expect(estimate).toMatchObject({
      status: 'error',
      revision: 9,
      errorCode: 'ESTIMATE_FAILED',
      budget: { budget: null },
    });
  });
});
