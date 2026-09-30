import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatContextTokens, formatContextPercent } from 'librechat-data-provider';
import type { TContextTokenUnits } from 'librechat-data-provider';
import { formatContextTokenPair, tokenUnitsForLanguage } from './format';

export interface ContextCounterFormatter {
  units: TContextTokenUnits;
  /** `742` · `9,9 тыс.` · `1,6 млн` */
  tokens: (count: number) => string;
  /** `90,2 / 451,3 тыс.` */
  pair: (occupied: number, budget: number) => string;
  /** `64%` · `<1%` · `108%`; `null` without a usable budget */
  percent: (value: number, budget: number | null) => string | null;
}

/** Formatting bound to the UI language (§5.1); memoized so rows share one instance. */
export function useContextCounterFormatter(): ContextCounterFormatter {
  const { i18n } = useTranslation();
  const language = i18n.language;
  return useMemo(() => {
    const units = tokenUnitsForLanguage(language);
    return {
      units,
      tokens: (count) => formatContextTokens(count, units),
      pair: (occupied, budget) => formatContextTokenPair(occupied, budget, units),
      percent: (value, budget) => formatContextPercent(value, budget),
    };
  }, [language]);
}
