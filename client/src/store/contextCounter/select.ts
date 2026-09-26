import type {
  TContextBudget,
  TContextOccupied,
  TContextStaleReason,
  TContextCacheOverlay,
  TContextConfiguration,
  TContextExclusionPlan,
  TContextEstimateStatus,
  TContextMeasurementSource,
  TContextLastCallMeasurement,
  TContextNextRequestEstimate,
} from 'librechat-data-provider';
import type { EstimateEntry } from './reducer';

/** §5 `occupied` = sum of the `●` segments; cache is never a summand. */
export function sumOccupied(occupied: TContextOccupied): number {
  return (
    occupied.messages +
    occupied.toolCalls +
    occupied.systemPrompt +
    occupied.mcpTools +
    occupied.attachments +
    occupied.other
  );
}

/** Raw `used / B`; `null` when B is unknown or exhausted so no caller divides by zero (§5). */
export function fillRatio(used: number, budget: number | null): number | null {
  if (budget == null || budget <= 0) {
    return null;
  }
  return used / budget;
}

export type EstimateView = {
  status: TContextEstimateStatus;
  staleReason?: TContextStaleReason;
  errorCode?: string;
  /**
   * The forecast the UI may render. With `status: 'stale' | 'calculating'` it
   * is the previous answer and must be labelled as outdated; `null` means
   * «Нет данных».
   */
  estimate: TContextNextRequestEstimate | null;
  source: TContextMeasurementSource | null;
  occupied: number | null;
  budget: TContextBudget | null;
  /** `occupied / B`, unrounded; may exceed 1 (overflow text «108%»). */
  fillRatio: number | null;
  /** B is known but ≤ 0: «бюджет исчерпан резервом», no percent (§5). */
  budgetExhausted: boolean;
  /** Server exclusion plan; warning is driven by `count > 0`, not by fill (§4). */
  excluded: TContextExclusionPlan | null;
  /** True while a request for the current fingerprint is in flight. */
  isCalculating: boolean;
};

const EMPTY_ESTIMATE_VIEW: EstimateView = {
  status: 'unavailable',
  estimate: null,
  source: null,
  occupied: null,
  budget: null,
  fillRatio: null,
  budgetExhausted: false,
  excluded: null,
  isCalculating: false,
};

/**
 * Projects the stored entry for the CURRENT branch onto what the menu may
 * show. An entry for another leaf is never passed in — callers look the map
 * up by the current leaf (§10.11). A fresh answer for an older fingerprint is
 * reported `stale` even before the controller has marked it.
 */
export function selectEstimateView(
  entry: EstimateEntry | undefined,
  currentFingerprint: string | null,
): EstimateView {
  if (entry == null) {
    return EMPTY_ESTIMATE_VIEW;
  }
  const isCalculating = entry.pendingRevision != null;
  const estimate = entry.estimate;
  if (estimate == null) {
    if (isCalculating) {
      return { ...EMPTY_ESTIMATE_VIEW, status: 'calculating', isCalculating };
    }
    if (entry.status === 'error') {
      return { ...EMPTY_ESTIMATE_VIEW, status: 'error', errorCode: entry.errorCode };
    }
    return EMPTY_ESTIMATE_VIEW;
  }

  let status = entry.status;
  let staleReason = entry.staleReason;
  const fingerprintMatches =
    currentFingerprint == null ||
    entry.fingerprint == null ||
    entry.fingerprint === currentFingerprint;
  if ((status === 'fresh' || status === 'partial') && !fingerprintMatches) {
    status = 'stale';
    staleReason = staleReason ?? 'unknown';
  }
  if (isCalculating) {
    status = 'calculating';
  }

  const occupied = sumOccupied(estimate.occupied);
  const budget = estimate.budget;
  return {
    status,
    staleReason: status === 'stale' || status === 'calculating' ? staleReason : undefined,
    errorCode: status === 'error' ? entry.errorCode : undefined,
    estimate,
    source: estimate.source,
    occupied,
    budget,
    fillRatio: fillRatio(occupied, budget.budget),
    budgetExhausted: budget.budget != null && budget.budget <= 0,
    excluded: estimate.excluded,
    isCalculating,
  };
}

export type LastCallMismatchReason = Extract<
  TContextStaleReason,
  'model_changed' | 'limits_changed'
>;

export type LastCallView = {
  measurement: TContextLastCallMeasurement | null;
  /** `input / budget` of THIS measurement — never of the current configuration (§3, §10.31). */
  fillRatio: number | null;
  budgetExhausted: boolean;
  /** «измерено для {модель} · сейчас другая конфигурация» (§3, §10.3). */
  configMismatch: boolean;
  mismatchReason: LastCallMismatchReason | null;
  /** Only `source === 'provider'` may carry the label «данные провайдера» (§10.5). */
  providerData: boolean;
  /** Total confirmed, composition estimated → «Состав — оценка.» (§3, §10.6). */
  compositionEstimated: boolean;
};

const EMPTY_LAST_CALL_VIEW: LastCallView = {
  measurement: null,
  fillRatio: null,
  budgetExhausted: false,
  configMismatch: false,
  mismatchReason: null,
  providerData: false,
  compositionEstimated: false,
};

/** Current configuration terms the last call is compared against. */
export type CurrentConfiguration = {
  configuration: TContextConfiguration;
  window: number | null;
  reserve: number;
  inputLimit: number | null;
};

function sameConfiguration(a: TContextConfiguration, b: TContextConfiguration): boolean {
  return (
    (a.endpoint ?? null) === (b.endpoint ?? null) &&
    (a.model ?? null) === (b.model ?? null) &&
    (a.agentId ?? null) === (b.agentId ?? null) &&
    ((a.provider ?? null) === (b.provider ?? null) || a.provider == null || b.provider == null)
  );
}

function limitsMismatch(measured: TContextBudget, current: CurrentConfiguration): boolean {
  /** Unknown client-side limits are not a mismatch — only a provable change is. */
  if (current.window != null && measured.window != null && current.window !== measured.window) {
    return true;
  }
  if (current.inputLimit != null && measured.inputLimit != null) {
    return current.inputLimit !== measured.inputLimit;
  }
  return false;
}

export function selectLastCallView(
  measurement: TContextLastCallMeasurement | undefined,
  current: CurrentConfiguration | null,
): LastCallView {
  if (measurement == null) {
    return EMPTY_LAST_CALL_VIEW;
  }
  let mismatchReason: LastCallMismatchReason | null = null;
  if (current != null) {
    if (!sameConfiguration(measurement.configuration, current.configuration)) {
      mismatchReason = 'model_changed';
    } else if (limitsMismatch(measurement.budget, current)) {
      mismatchReason = 'limits_changed';
    }
  }
  const budget = measurement.budget.budget;
  return {
    measurement,
    fillRatio: fillRatio(measurement.input, budget),
    budgetExhausted: budget != null && budget <= 0,
    configMismatch: mismatchReason != null,
    mismatchReason,
    providerData: measurement.source === 'provider',
    compositionEstimated:
      measurement.composition != null && measurement.compositionSource !== 'provider',
  };
}

/** §3 table: exactly one primary bottom action at a time. */
export type BottomButton = 'none' | 'recalculate' | 'compress';

export type BottomButtonInput = {
  isSubmitting: boolean;
  estimate: EstimateView;
  /** Endpoint supports compaction and the server advertises it. */
  compressSupported: boolean;
  /** Fill ratio at which «Сжать» replaces «Пересчитать»; exclusion of history always counts. */
  compressThreshold: number;
};

export function compressThresholdReached(estimate: EstimateView, threshold: number): boolean {
  if ((estimate.excluded?.count ?? 0) > 0) {
    return true;
  }
  return estimate.fillRatio != null && estimate.fillRatio >= threshold;
}

export function selectBottomButton(input: BottomButtonInput): BottomButton {
  const { isSubmitting, estimate, compressSupported, compressThreshold } = input;
  if (isSubmitting) {
    return 'none';
  }
  if (compressSupported && compressThresholdReached(estimate, compressThreshold)) {
    return 'compress';
  }
  switch (estimate.status) {
    case 'stale':
    case 'unavailable':
    case 'error':
      return 'recalculate';
    case 'calculating':
      return 'none';
    case 'fresh':
    case 'partial':
      return compressSupported ? 'compress' : 'none';
    default: {
      const exhaustive: never = estimate.status;
      return exhaustive;
    }
  }
}

/**
 * §3 header data for the selected mode. `next` carries the forecast (with
 * its status and `≈`), `last` the immutable measurement with its OWN budget.
 * When «последний» is requested but no measurement exists the view falls back
 * to `next` and reports `fallback: true` so the toggle can stay honest.
 */
export type PrimaryView = {
  kind: 'next' | 'last';
  fallback: boolean;
  /** `occupied` for next, `input` for last. */
  total: number | null;
  budget: TContextBudget | null;
  fillRatio: number | null;
  budgetExhausted: boolean;
  source: TContextMeasurementSource | null;
  composition: TContextOccupied | null;
  cache: TContextCacheOverlay | null;
  /** Lifecycle for `next`; `last` is immutable and therefore always `fresh`. */
  status: TContextEstimateStatus;
  isEstimate: boolean;
};

export function selectPrimaryView(
  mode: 'next' | 'last',
  estimate: EstimateView,
  lastCall: LastCallView,
): PrimaryView {
  const measurement = lastCall.measurement;
  if (mode === 'last' && measurement != null) {
    return {
      kind: 'last',
      fallback: false,
      total: measurement.input,
      budget: measurement.budget,
      fillRatio: lastCall.fillRatio,
      budgetExhausted: lastCall.budgetExhausted,
      source: measurement.source,
      composition: measurement.composition,
      cache: { read: measurement.cacheRead, write: measurement.cacheWrite },
      status: 'fresh',
      isEstimate: measurement.source !== 'provider',
    };
  }
  return {
    kind: 'next',
    fallback: mode === 'last',
    total: estimate.occupied,
    budget: estimate.budget,
    fillRatio: estimate.fillRatio,
    budgetExhausted: estimate.budgetExhausted,
    source: estimate.source,
    composition: estimate.estimate?.occupied ?? null,
    cache: estimate.estimate?.cache ?? null,
    status: estimate.status,
    isEstimate: true,
  };
}

/** §9 mini-indicator: mirrors the next-request snapshot, never a third number. */
export type MiniIndicatorKind =
  | 'fresh'
  | 'no_limit'
  | 'calculating'
  | 'stale'
  | 'overflow'
  | 'unavailable';

export type MiniIndicator = {
  kind: MiniIndicatorKind;
  occupied: number | null;
  budget: number | null;
  fillRatio: number | null;
  /** Always an estimate: the indicator inherits `≈` (§9). */
  isEstimate: true;
};

export function selectMiniIndicator(estimate: EstimateView): MiniIndicator {
  const base = {
    occupied: estimate.occupied,
    budget: estimate.budget?.budget ?? null,
    fillRatio: estimate.fillRatio,
    isEstimate: true as const,
  };
  switch (estimate.status) {
    case 'calculating':
      return { ...base, kind: 'calculating' };
    case 'stale':
      return { ...base, kind: 'stale' };
    case 'unavailable':
    case 'error':
      return { ...base, kind: 'unavailable' };
    case 'fresh':
    case 'partial': {
      if (estimate.fillRatio == null) {
        return { ...base, kind: 'no_limit' };
      }
      return { ...base, kind: estimate.fillRatio > 1 ? 'overflow' : 'fresh' };
    }
    default: {
      const exhaustive: never = estimate.status;
      return exhaustive;
    }
  }
}
