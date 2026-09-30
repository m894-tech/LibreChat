import { formatContextTokens, EN_TOKEN_UNITS, RU_TOKEN_UNITS } from 'librechat-data-provider';
import type { TContextTokenUnits } from 'librechat-data-provider';

/** Units follow the UI language, not the browser locale (§5.1: RU decimal comma, «тыс.»/«млн»). */
export function tokenUnitsForLanguage(language: string | undefined): TContextTokenUnits {
  return language != null && language.toLowerCase().startsWith('ru')
    ? RU_TOKEN_UNITS
    : EN_TOKEN_UNITS;
}

/**
 * `≈90,2 / 451,3 тыс.`: when both sides share a unit it is written once, after
 * the pair; otherwise each side keeps its own (`742 / 451,3 тыс.`).
 */
export function formatContextTokenPair(
  occupied: number,
  budget: number,
  units: TContextTokenUnits,
): string {
  const left = formatContextTokens(occupied, units);
  const right = formatContextTokens(budget, units);
  const sharedUnit = [units.thousand, units.million].find((unit) => {
    const suffix = `${units.unitSeparator}${unit}`;
    return left.endsWith(suffix) && right.endsWith(suffix);
  });
  if (sharedUnit == null) {
    return `${left} / ${right}`;
  }
  const suffix = `${units.unitSeparator}${sharedUnit}`;
  return `${left.slice(0, -suffix.length)} / ${right}`;
}
