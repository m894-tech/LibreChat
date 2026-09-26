import { toTokenInteger } from './budget';

/**
 * Half-up rounding of `numerator / denominator` to an integer using integer
 * arithmetic only, so `0.285 × 100` cannot land on `28.499999…`.
 */
export function roundRatioHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Half-up rounding of an already computed value (§5.1: 0.5 → up). */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.floor(value + 0.5);
}

/**
 * §5.1 percent text. `occupied`/`budget` are integers so the half-up rounding
 * is exact: `72 000 / 112 000 → 64%`. Returns `null` when the budget is
 * unknown or `≤ 0` (the caller shows the volume without a percent), `<1%` for
 * `0 < fill% < 1`, and may exceed `100%` — the bar clamps, the text does not
 * (§10.18).
 */
export function formatContextPercent(occupied: number, budget: number | null): string | null {
  if (budget == null || budget <= 0) {
    return null;
  }
  const safeOccupied = toTokenInteger(occupied);
  if (safeOccupied === 0) {
    return '0%';
  }
  if (safeOccupied * 100 < budget) {
    return '<1%';
  }
  return `${roundRatioHalfUp(safeOccupied * 100, budget)}%`;
}

/** Integer percent from a raw percentage (e.g. a stored `fillPercent`), half up. */
export function roundContextPercent(rawPercent: number | null): number | null {
  if (rawPercent == null || !Number.isFinite(rawPercent)) {
    return null;
  }
  return roundHalfUp(rawPercent);
}

/** §5.1 overflow: the bar fills to the edge, the text keeps the real value. */
export function clampContextBarPercent(rawPercent: number | null): number {
  if (rawPercent == null || !Number.isFinite(rawPercent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, rawPercent));
}

/** Locale-specific pieces of the compact token format (§5.1). */
export type TContextTokenUnits = {
  decimalSeparator: string;
  thousand: string;
  million: string;
  /** Separator between number and unit; `' '` for «9,9 тыс.», `''` for «9.9K». */
  unitSeparator: string;
};

export const RU_TOKEN_UNITS: TContextTokenUnits = {
  decimalSeparator: ',',
  thousand: 'тыс.',
  million: 'млн',
  unitSeparator: ' ',
};

export const EN_TOKEN_UNITS: TContextTokenUnits = {
  decimalSeparator: '.',
  thousand: 'K',
  million: 'M',
  unitSeparator: '',
};

const THOUSAND = 1_000;
const MILLION = 1_000_000;

/** `value / unit` with exactly one decimal, rounded half up, split into integer and tenth. */
function toOneDecimal(value: number, unit: number): { whole: number; tenth: number } {
  const tenths = roundRatioHalfUp(value * 10, unit);
  return { whole: Math.floor(tenths / 10), tenth: tenths % 10 };
}

/**
 * §5.1 compact token count: `< 1000` → integer (`742`); `1 000 … < 1 000 000`
 * → one decimal + thousand unit (`9,9 тыс.`, `72,0 тыс.` — the `,0` is kept);
 * `≥ 1 000 000` → one decimal + million unit (`1,6 млн`). Rounds from the raw
 * integer; a thousands value that rounds to `1000,0` moves up to the million
 * unit instead of printing `1000,0 тыс.`.
 */
export function formatContextTokens(
  count: number,
  units: TContextTokenUnits = RU_TOKEN_UNITS,
): string {
  const value = toTokenInteger(count);
  if (value < THOUSAND) {
    return String(value);
  }
  const join = (whole: number, tenth: number, unit: string) =>
    `${whole}${units.decimalSeparator}${tenth}${units.unitSeparator}${unit}`;
  if (value < MILLION) {
    const thousands = toOneDecimal(value, THOUSAND);
    if (thousands.whole < THOUSAND) {
      return join(thousands.whole, thousands.tenth, units.thousand);
    }
  }
  const millions = toOneDecimal(value, MILLION);
  return join(millions.whole, millions.tenth, units.million);
}

/** Exact integer with a locale-neutral thin-space grouping for detail views (§9 «точные значения»). */
export function formatContextTokensExact(count: number, groupSeparator = '\u202f'): string {
  const value = toTokenInteger(count);
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
}
