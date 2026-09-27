import {
  toTokenInteger,
  contextOccupiedKeys,
  computeContextFree,
  computeContextBudget,
  sumContextOccupied,
  computeContextFillPercent,
} from 'librechat-data-provider';
import type {
  TContextBudget,
  TContextOccupied,
  TContextOccupiedKey,
  TContextStaleReason,
  TContextConfiguration,
  TContextExclusionPlan,
  TContextEstimateStatus,
  TContextMeasurementSource,
} from 'librechat-data-provider';
import type { ContextCounterMode, ContextCounterViewModel } from './types';

/**
 * Series slot per `●` segment: the existing menu's palette — messages blue,
 * tool calls orange, system prompt teal, MCP tools pink (§2/§9).
 */
export const SEGMENT_SLOTS: Record<TContextOccupiedKey, number> = {
  messages: 1,
  toolCalls: 2,
  systemPrompt: 3,
  mcpTools: 5,
  attachments: 6,
  other: 7,
};

export interface PanelSegment {
  key: TContextOccupiedKey;
  value: number;
  slot: number;
}

/** One rendering of header + bar + breakdown for a mode (§3 items 1–4). */
export interface PanelView {
  mode: ContextCounterMode;
  available: boolean;
  /** `≈` in front of the number: anything that is not confirmed provider input. */
  approximate: boolean;
  source: TContextMeasurementSource;
  occupied: number;
  budget: number | null;
  /** `B ≤ 0`: «бюджет исчерпан резервом», no percent, no division. */
  budgetExhausted: boolean;
  /** Real fill; may exceed 100. `null` when there is no budget or it is exhausted. */
  fillPercent: number | null;
  segments: PanelSegment[];
  cacheRead: number | null;
  cacheWrite: number | null;
  free: number | null;
  /** Composition rows are shown only when the source reported one. */
  compositionKnown: boolean;
  /** «Общий объём получен от провайдера. Состав — оценка.» */
  compositionEstimated: boolean;
  compositionMismatch: boolean;
  estimateStatus: TContextEstimateStatus | null;
  staleReason: TContextStaleReason | null;
  partial: boolean;
  errorCode: string | null;
  excluded: TContextExclusionPlan | null;
  /** The measurement was taken for another model/provider (§3 badge). */
  configurationMismatch: boolean;
  measuredModel: string | null;
}

/** The record's own `B` when it carries one, else §5 `min(W − R, L)` from its terms. */
export function resolveBudget(budget: TContextBudget): number | null {
  if (budget.budget != null && Number.isFinite(budget.budget)) {
    return Math.trunc(budget.budget);
  }
  return computeContextBudget(budget).budget;
}

export function toSegments(occupied: TContextOccupied): PanelSegment[] {
  return contextOccupiedKeys.map((key) => ({
    key,
    value: toTokenInteger(occupied[key]),
    slot: SEGMENT_SLOTS[key],
  }));
}

const EMPTY_PANEL: Omit<PanelView, 'mode'> = {
  available: false,
  approximate: true,
  source: 'unavailable',
  occupied: 0,
  budget: null,
  budgetExhausted: false,
  fillPercent: null,
  segments: [],
  cacheRead: null,
  cacheWrite: null,
  free: null,
  compositionKnown: false,
  compositionEstimated: false,
  compositionMismatch: false,
  estimateStatus: null,
  staleReason: null,
  partial: false,
  errorCode: null,
  excluded: null,
  configurationMismatch: false,
  measuredModel: null,
};

/**
 * The model/provider a measurement was taken for differs from what the user
 * is about to send with. Only fields present on both sides are compared, so a
 * measurement without provider metadata never reads as a mismatch by itself.
 */
export function isConfigurationMismatch(
  current: TContextConfiguration,
  measured: TContextConfiguration,
): boolean {
  const differs = (a?: string | null, b?: string | null) =>
    a != null && b != null && a !== '' && b !== '' && a !== b;
  return (
    differs(current.model, measured.model) ||
    differs(current.provider, measured.provider) ||
    differs(current.endpoint, measured.endpoint) ||
    differs(current.agentId, measured.agentId)
  );
}

export type ConfigChangeKind = 'model' | 'tools' | null;

/** §4: the warning names the concrete cause — «Модель изменена» or «Инструменты изменены». */
export function staleReasonKind(reason: TContextStaleReason | null | undefined): ConfigChangeKind {
  switch (reason) {
    case 'model_changed':
    case 'limits_changed':
      return 'model';
    case 'tools_changed':
    case 'instructions_changed':
      return 'tools';
    default:
      return null;
  }
}

export function deriveNextPanel(vm: ContextCounterViewModel): PanelView {
  const estimate = vm.nextRequestEstimate;
  if (estimate == null || estimate.status === 'unavailable') {
    return {
      ...EMPTY_PANEL,
      mode: 'next',
      estimateStatus: estimate?.status ?? null,
      staleReason: estimate?.staleReason ?? null,
      errorCode: estimate?.errorCode ?? null,
    };
  }
  const budget = resolveBudget(estimate.budget);
  const occupied = sumContextOccupied(estimate.occupied);
  /** A status without an answer yet (calculating / error before any reply) has nothing to show. */
  const hasAnswer =
    occupied > 0 ||
    estimate.status === 'fresh' ||
    estimate.status === 'partial' ||
    estimate.status === 'stale';
  return {
    mode: 'next',
    available: hasAnswer,
    approximate: true,
    source: estimate.source,
    occupied,
    budget,
    budgetExhausted: budget != null && budget <= 0,
    fillPercent: computeContextFillPercent(occupied, budget),
    segments: toSegments(estimate.occupied),
    cacheRead: estimate.cache.read,
    cacheWrite: estimate.cache.write,
    free: computeContextFree(budget, occupied),
    compositionKnown: true,
    compositionEstimated: false,
    compositionMismatch: false,
    estimateStatus: estimate.status,
    staleReason: estimate.staleReason ?? null,
    partial: estimate.status === 'partial' || (estimate.incompleteReasons?.length ?? 0) > 0,
    errorCode: estimate.errorCode ?? null,
    excluded: estimate.excluded,
    configurationMismatch: isConfigurationMismatch(vm.configuration, estimate.configuration),
    measuredModel: estimate.configuration.model ?? null,
  };
}

export function deriveLastPanel(vm: ContextCounterViewModel): PanelView {
  const measurement = vm.lastCallMeasurement;
  if (measurement == null) {
    return { ...EMPTY_PANEL, mode: 'last' };
  }
  /** Percent is always against THIS record's budget, never the current one (§3). */
  const budget = resolveBudget(measurement.budget);
  const occupied = toTokenInteger(measurement.input);
  const composition = measurement.composition;
  const compositionKnown = composition != null && measurement.compositionSource !== 'unavailable';
  return {
    mode: 'last',
    available: true,
    approximate: measurement.source !== 'provider',
    source: measurement.source,
    occupied,
    budget,
    budgetExhausted: budget != null && budget <= 0,
    fillPercent: computeContextFillPercent(occupied, budget),
    segments: compositionKnown && composition != null ? toSegments(composition) : [],
    cacheRead: toTokenInteger(measurement.cacheRead) > 0 ? measurement.cacheRead : null,
    cacheWrite: toTokenInteger(measurement.cacheWrite) > 0 ? measurement.cacheWrite : null,
    free: computeContextFree(budget, occupied),
    compositionKnown,
    compositionEstimated: compositionKnown && measurement.compositionSource !== 'provider',
    compositionMismatch: measurement.compositionMismatch === true,
    estimateStatus: null,
    staleReason: null,
    partial: !measurement.complete,
    errorCode: null,
    excluded: null,
    configurationMismatch:
      vm.lastCallMismatch ?? isConfigurationMismatch(vm.configuration, measurement.configuration),
    measuredModel: measurement.configuration.model ?? null,
  };
}

export function derivePanel(vm: ContextCounterViewModel, mode: ContextCounterMode): PanelView {
  switch (mode) {
    case 'next':
      return deriveNextPanel(vm);
    case 'last':
      return deriveLastPanel(vm);
    default: {
      const exhaustive: never = mode;
      return exhaustive;
    }
  }
}

export type DisabledReason =
  | 'sending'
  | 'compressing'
  | 'model_switching'
  | 'calculating'
  | 'estimate_unavailable';

/**
 * §3 table, one bottom control at a time. `waiting` is the streaming status
 * with no button; `none` is a fresh estimate on an endpoint that cannot
 * compress, where nothing is left to do.
 */
export type BottomAction =
  | { kind: 'waiting' }
  | { kind: 'none' }
  | { kind: 'recalculate'; retry: boolean; disabledReason: DisabledReason | null }
  | { kind: 'compress'; disabledReason: DisabledReason | null };

/** §8: conflicting operations disable the button with a reason, never queue silently. */
function conflictingOperation(vm: ContextCounterViewModel): DisabledReason | null {
  const { activity } = vm;
  if (activity.compressing) {
    return 'compressing';
  }
  if (activity.modelSwitching) {
    return 'model_switching';
  }
  if (activity.sending) {
    return 'sending';
  }
  return null;
}

export function resolveBottomAction(vm: ContextCounterViewModel): BottomAction {
  if (vm.activity.streaming) {
    return { kind: 'waiting' };
  }
  const status = vm.nextRequestEstimate?.status ?? 'unavailable';
  const conflict = conflictingOperation(vm);
  const next = deriveNextPanel(vm);
  /** History already being dropped counts as the threshold being reached (§4 warning → §3 «Сжать»). */
  const thresholdReached =
    (next.fillPercent != null && next.fillPercent >= vm.capabilities.compressThresholdPercent) ||
    (next.excluded != null && next.excluded.count > 0);
  const canCompress = vm.capabilities.compressionSupported;

  if (canCompress && thresholdReached) {
    return { kind: 'compress', disabledReason: conflict };
  }
  const recalcConflict =
    conflict ?? (vm.capabilities.estimateSupported ? null : 'estimate_unavailable');
  switch (status) {
    case 'calculating':
      return { kind: 'recalculate', retry: false, disabledReason: recalcConflict ?? 'calculating' };
    case 'error':
      return { kind: 'recalculate', retry: true, disabledReason: recalcConflict };
    case 'stale':
    case 'unavailable':
    case 'partial':
      return { kind: 'recalculate', retry: false, disabledReason: recalcConflict };
    case 'fresh':
      return canCompress ? { kind: 'compress', disabledReason: conflict } : { kind: 'none' };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
