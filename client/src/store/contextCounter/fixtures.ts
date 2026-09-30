import { CONTEXT_COUNTER_CONTRACT_VERSION } from 'librechat-data-provider';
import type {
  TContextFingerprintInput,
  TContextLastCallMeasurement,
  TContextNextRequestEstimate,
} from 'librechat-data-provider';
import type { CompletedCallUsage } from './reducer';

/** Contract-shaped fixtures shared by the store and hook specs; not part of the public index. */
export const CONVO = 'convo-1';
export const LEAF_A = 'leaf-a';
export const LEAF_B = 'leaf-b';

export function estimateFixture(
  overrides: Partial<TContextNextRequestEstimate> = {},
): TContextNextRequestEstimate {
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId: CONVO,
    branchLeafId: LEAF_A,
    revision: 1,
    fingerprint: 'server-fp',
    status: 'fresh',
    source: 'server_estimate',
    computedAt: 1_000,
    configuration: { endpoint: 'anthropic', model: 'claude', agentId: null },
    budget: { window: 128_000, reserve: 16_000, inputLimit: null, budget: 112_000 },
    occupied: {
      messages: 742,
      toolCalls: 9_900,
      systemPrompt: 21_100,
      mcpTools: 58_400,
      attachments: 0,
      other: 0,
    },
    cache: { read: null, write: null },
    excluded: null,
    ...overrides,
  };
}

export function lastCallFixture(
  overrides: Partial<TContextLastCallMeasurement> = {},
): TContextLastCallMeasurement {
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId: CONVO,
    branchLeafId: LEAF_A,
    callId: 'run-1',
    responseMessageId: LEAF_A,
    measuredAt: 2_000,
    configuration: { endpoint: 'anthropic', model: 'claude', agentId: null },
    source: 'provider',
    complete: true,
    budget: { window: 128_000, reserve: 16_000, inputLimit: null, budget: 112_000 },
    input: 72_000,
    output: 4_000,
    cacheRead: 0,
    cacheWrite: 0,
    composition: null,
    compositionSource: 'unavailable',
    ...overrides,
  };
}

export function usageFixture(overrides: Partial<CompletedCallUsage> = {}): CompletedCallUsage {
  return {
    eventId: 'run-1:0',
    input: 72_000,
    inputUncached: 60_000,
    output: 4_000,
    cacheRead: 12_000,
    cacheWrite: 0,
    cacheSplittable: true,
    provider: 'anthropic',
    ...overrides,
  };
}

export function fingerprintFixture(
  overrides: Partial<TContextFingerprintInput> = {},
): TContextFingerprintInput {
  return {
    configuration: { endpoint: 'anthropic', model: 'claude', agentId: null },
    window: 128_000,
    reserve: 16_000,
    inputLimit: null,
    instructionsHash: 'instr',
    toolIds: ['web_search', 'mcp:github'],
    branchLeafId: LEAF_A,
    historyRevision: `${LEAF_A}:t1`,
    draftHash: 'draft',
    attachmentIds: [],
    ...overrides,
  };
}
