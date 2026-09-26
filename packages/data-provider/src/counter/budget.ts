import type {
  TContextBudget,
  TContextOccupied,
  TContextCacheOverlay,
  TContextOccupiedKey,
} from '../types/contextCounter';
import { contextOccupiedKeys } from '../types/contextCounter';

/** Integer token count; anything malformed or negative reads as 0. */
export function toTokenInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER);
}

export type TContextBudgetInput = {
  /** W — full model window; `null`/non-positive means unknown. */
  window: number | null | undefined;
  /** R — output reserve; defaults to 0. */
  reserve?: number | null;
  /** L — separate input limit, when the model has one. */
  inputLimit?: number | null;
};

/**
 * §5: `B = min(W − R, L)` when `L` is set, else `B = W − R`. The budget is
 * `null` only when the window is unknown; `B ≤ 0` is a real state («бюджет
 * исчерпан резервом») and is returned as is so callers can label it instead
 * of dividing by it.
 */
export function computeContextBudget({
  window,
  reserve,
  inputLimit,
}: TContextBudgetInput): TContextBudget {
  const safeReserve = toTokenInteger(reserve);
  const safeWindow = toTokenInteger(window);
  const safeLimit = toTokenInteger(inputLimit);
  const knownWindow = safeWindow > 0 ? safeWindow : null;
  const knownLimit = safeLimit > 0 ? safeLimit : null;
  if (knownWindow == null) {
    return { window: null, reserve: safeReserve, inputLimit: knownLimit, budget: null };
  }
  const afterReserve = knownWindow - safeReserve;
  const budget = knownLimit == null ? afterReserve : Math.min(afterReserve, knownLimit);
  return { window: knownWindow, reserve: safeReserve, inputLimit: knownLimit, budget };
}

export function isContextBudgetExhausted(budget: TContextBudget | number | null): boolean {
  const value = typeof budget === 'number' || budget == null ? budget : budget.budget;
  return value != null && value <= 0;
}

/** An all-zero composition, for callers that fill keys incrementally. */
export function emptyContextOccupied(): TContextOccupied {
  const occupied = {} as TContextOccupied;
  for (const key of contextOccupiedKeys) {
    occupied[key] = 0;
  }
  return occupied;
}

/** Sanitizes each `●` segment to an integer; unknown keys are dropped. */
export function normalizeContextOccupied(
  occupied: Partial<Record<TContextOccupiedKey, unknown>> | null | undefined,
): TContextOccupied {
  const result = emptyContextOccupied();
  if (occupied == null) {
    return result;
  }
  for (const key of contextOccupiedKeys) {
    result[key] = toTokenInteger(occupied[key]);
  }
  return result;
}

/**
 * §5 `occupied` — the sum of the `●` segments only. Cache is an overlay and
 * free space a remainder; neither is a summand here (§10.21).
 */
export function sumContextOccupied(occupied: Partial<TContextOccupied> | null | undefined): number {
  if (occupied == null) {
    return 0;
  }
  let total = 0;
  for (const key of contextOccupiedKeys) {
    total += toTokenInteger(occupied[key]);
  }
  return total;
}

/** §5 `free = max(B − occupied, 0)`; `null` when the budget is unknown. */
export function computeContextFree(budget: number | null, occupied: number): number | null {
  if (budget == null) {
    return null;
  }
  return Math.max(budget - toTokenInteger(occupied), 0);
}

/**
 * §5 `fill% = occupied / B` as a raw (unrounded) percentage that may exceed
 * 100. `null` when the budget is unknown or `B ≤ 0` — never `NaN`/`Infinity`
 * (§10.25). Display rounding is `formatContextPercent`.
 */
export function computeContextFillPercent(occupied: number, budget: number | null): number | null {
  if (budget == null || budget <= 0) {
    return null;
  }
  return (toTokenInteger(occupied) / budget) * 100;
}

/** Share of the budget one segment row takes (§5: «все проценты строк — доля от B»). */
export function computeContextRowPercent(value: number, budget: number | null): number | null {
  return computeContextFillPercent(value, budget);
}

export type TContextCacheOverlayView = TContextCacheOverlay & {
  /** True when `read > occupied` after normalization — show, label «не сходится», never clamp (§5). */
  mismatch: boolean;
};

/**
 * §5 cache rules: cache is an intersection of `occupied`. It is reported next
 * to the composition, never added to it; a read larger than the occupied total
 * is surfaced as a mismatch instead of being silently clamped.
 */
export function resolveContextCacheOverlay(
  occupied: number,
  cache: Partial<TContextCacheOverlay> | null | undefined,
): TContextCacheOverlayView {
  const read = cache?.read == null ? null : toTokenInteger(cache.read);
  const write = cache?.write == null ? null : toTokenInteger(cache.write);
  const mismatch = read != null && read > toTokenInteger(occupied);
  return { read, write, mismatch };
}

export type TContextFillView = {
  budget: TContextBudget;
  occupied: TContextOccupied;
  /** Sum of the `●` segments — the header number. */
  occupiedTotal: number;
  free: number | null;
  /** Raw percent, may exceed 100; `null` when unknown or exhausted. */
  fillPercent: number | null;
  /** Bar length, clamped to `[0, 100]`; 0 when the percent is unknown. */
  barPercent: number;
  exhausted: boolean;
  cache: TContextCacheOverlayView;
};

function isResolvedBudget(budget: TContextBudgetInput | TContextBudget): budget is TContextBudget {
  return 'budget' in budget;
}

/** One pass over §5 for a store entry: budget, occupied, free, fill and the cache overlay. */
export function computeContextFillView(
  budget: TContextBudgetInput | TContextBudget,
  occupied: Partial<Record<TContextOccupiedKey, unknown>> | null | undefined,
  cache?: Partial<TContextCacheOverlay> | null,
): TContextFillView {
  const resolvedBudget = isResolvedBudget(budget) ? budget : computeContextBudget(budget);
  const normalizedOccupied = normalizeContextOccupied(occupied);
  const occupiedTotal = sumContextOccupied(normalizedOccupied);
  const fillPercent = computeContextFillPercent(occupiedTotal, resolvedBudget.budget);
  return {
    budget: resolvedBudget,
    occupied: normalizedOccupied,
    occupiedTotal,
    free: computeContextFree(resolvedBudget.budget, occupiedTotal),
    fillPercent,
    barPercent: fillPercent == null ? 0 : Math.min(100, Math.max(0, fillPercent)),
    exhausted: isContextBudgetExhausted(resolvedBudget),
    cache: resolveContextCacheOverlay(occupiedTotal, cache),
  };
}
