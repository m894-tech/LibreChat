import { CONTEXT_COUNTER_CONTRACT_VERSION } from 'librechat-data-provider';
import type {
  TContextSessionUsage,
  TContextExclusionPlan,
  TContextLastCallMeasurement,
  TContextNextRequestEstimate,
} from 'librechat-data-provider';
import type { ContextCounterViewModel } from './types';
import { DEFAULT_CAPABILITIES, IDLE_ACTIVITY } from './types';

/**
 * One fixture per §4 state, shaped exactly like the contract stream D will
 * feed the components. Numbers follow the §2 mockup where it has them.
 */

const identity = {
  version: CONTEXT_COUNTER_CONTRACT_VERSION,
  conversationId: 'conv-1',
  branchLeafId: 'msg-leaf',
} as const;

const claude = { endpoint: 'anthropic', provider: 'anthropic', model: 'claude-sonnet-4' };

export const freshEstimate: TContextNextRequestEstimate = {
  ...identity,
  revision: 3,
  fingerprint: 'fp-3',
  status: 'fresh',
  source: 'server_estimate',
  computedAt: 1_700_000_000_000,
  configuration: claude,
  budget: { window: 500_000, reserve: 48_700, inputLimit: null, budget: 451_300 },
  occupied: {
    messages: 742,
    toolCalls: 9_900,
    systemPrompt: 21_100,
    mcpTools: 58_400,
    attachments: 0,
    other: 0,
  },
  cache: { read: 89_600, write: null },
  excluded: null,
};

export const lastCallProvider: TContextLastCallMeasurement = {
  ...identity,
  callId: 'run-7',
  responseMessageId: 'msg-leaf',
  measuredAt: 1_699_999_000_000,
  configuration: claude,
  source: 'provider',
  complete: true,
  budget: { window: 128_000, reserve: 16_000, inputLimit: null, budget: 112_000 },
  input: 72_000,
  output: 4_000,
  cacheRead: 60_000,
  cacheWrite: 0,
  composition: {
    messages: 30_000,
    toolCalls: 8_000,
    systemPrompt: 14_000,
    mcpTools: 20_000,
    attachments: 0,
    other: 0,
  },
  compositionSource: 'server_estimate',
};

export const sessionUsage: TContextSessionUsage = {
  ...identity,
  scope: 'branch',
  complete: true,
  cacheSplittable: true,
  input: 218_400,
  output: 16_700,
  cacheRead: 1_600_000,
  cacheWrite: 0,
  calls: 12,
  updatedAt: 1_700_000_000_000,
};

export const excludedPlan: TContextExclusionPlan = {
  count: 14,
  reason: 'over_budget',
  prePruneTokens: 487_404,
  messages: [
    { messageId: 'm1', role: 'user', preview: 'Собери таблицу по регионам', tokens: 1_200 },
    { messageId: 'm2', role: 'assistant', preview: 'Вот таблица…', tokens: 3_400 },
    { messageId: 'm3', role: 'tool', preview: 'read_file → 812 строк', tokens: 20_100 },
  ],
};

export const normalVm: ContextCounterViewModel = {
  conversationId: 'conv-1',
  configuration: claude,
  nextRequestEstimate: freshEstimate,
  lastCallMeasurement: lastCallProvider,
  sessionUsage,
  activity: IDLE_ACTIVITY,
  capabilities: DEFAULT_CAPABILITIES,
  isEmptyChat: false,
};

export const overflowVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: {
    ...freshEstimate,
    occupied: { ...freshEstimate.occupied, messages: 397_604 },
    excluded: excludedPlan,
  },
};

/** §10.9/23: the exclusion warning stays even when the trimmed fill is 70 %. */
export const trimmedVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: {
    ...freshEstimate,
    occupied: { ...freshEstimate.occupied, messages: 226_510 },
    excluded: { ...excludedPlan, prePruneTokens: undefined },
  },
};

export const modelChangedVm: ContextCounterViewModel = {
  ...normalVm,
  configuration: { endpoint: 'openai', provider: 'openai', model: 'gpt-5' },
  nextRequestEstimate: { ...freshEstimate, status: 'stale', staleReason: 'model_changed' },
};

export const toolsChangedVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: { ...freshEstimate, status: 'stale', staleReason: 'tools_changed' },
};

export const noLimitVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: {
    ...freshEstimate,
    budget: { window: null, reserve: 0, inputLimit: null, budget: null },
  },
};

export const exhaustedVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: {
    ...freshEstimate,
    budget: { window: 8_000, reserve: 8_000, inputLimit: null, budget: 0 },
  },
};

export const calculatingVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: { ...freshEstimate, status: 'calculating' },
};

export const calculatingEmptyVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: {
    ...freshEstimate,
    status: 'calculating',
    occupied: { messages: 0, toolCalls: 0, systemPrompt: 0, mcpTools: 0, attachments: 0, other: 0 },
  },
};

export const errorVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: {
    ...freshEstimate,
    status: 'error',
    errorCode: 'estimate_failed',
    occupied: { messages: 0, toolCalls: 0, systemPrompt: 0, mcpTools: 0, attachments: 0, other: 0 },
  },
};

export const partialVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: {
    ...freshEstimate,
    status: 'partial',
    incompleteReasons: ['attachment_pending'],
  },
};

export const unavailableVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: null,
  lastCallMeasurement: null,
  sessionUsage: null,
};

export const emptyChatVm: ContextCounterViewModel = {
  ...normalVm,
  isEmptyChat: true,
  lastCallMeasurement: null,
  sessionUsage: null,
  nextRequestEstimate: {
    ...freshEstimate,
    occupied: { ...freshEstimate.occupied, messages: 0, toolCalls: 0 },
    cache: { read: null, write: null },
  },
};

export const streamingVm: ContextCounterViewModel = {
  ...normalVm,
  activity: { ...IDLE_ACTIVITY, streaming: true },
};

export const compressingVm: ContextCounterViewModel = {
  ...overflowVm,
  activity: { ...IDLE_ACTIVITY, compressing: true },
};

export const staleVm: ContextCounterViewModel = {
  ...normalVm,
  nextRequestEstimate: { ...freshEstimate, status: 'stale', staleReason: 'draft_changed' },
};

/** Last call measured for another model than the one now selected (§10.31). */
export const lastCallMismatchVm: ContextCounterViewModel = {
  ...normalVm,
  configuration: { endpoint: 'openai', provider: 'openai', model: 'gpt-5' },
  nextRequestEstimate: {
    ...freshEstimate,
    configuration: { endpoint: 'openai', provider: 'openai', model: 'gpt-5' },
    budget: { window: 1_000_000, reserve: 100_000, inputLimit: null, budget: 900_000 },
  },
};

export const lastCallServerEstimateVm: ContextCounterViewModel = {
  ...normalVm,
  lastCallMeasurement: {
    ...lastCallProvider,
    source: 'server_estimate',
    composition: null,
    compositionSource: 'unavailable',
  },
};
