export type TRuPluralCategory = 'one' | 'few' | 'many' | 'other';

export type TRuPluralForms = {
  /** 1, 21, 101 — «сообщение» */
  one: string;
  /** 2–4, 22–24 — «сообщения» */
  few: string;
  /** 0, 5–20, 11–14, 25–30 — «сообщений» */
  many: string;
  /** Fractions — «сообщения»; defaults to `few`. */
  other?: string;
};

/**
 * CLDR plural category for Russian (§9: 1 / 2 / 5 / 11 / 21). Pure and
 * environment-free so the same rule runs on the server and in unit tests;
 * i18next resolves the same categories from `Intl.PluralRules` at render.
 */
export function pluralCategoryRu(count: number): TRuPluralCategory {
  if (!Number.isFinite(count)) {
    return 'many';
  }
  if (!Number.isInteger(count)) {
    return 'other';
  }
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return 'one';
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'few';
  }
  return 'many';
}

/** Picks the Russian word form for `count`; the number itself is not concatenated here (§9). */
export function pluralRu(count: number, forms: TRuPluralForms): string {
  const category = pluralCategoryRu(count);
  if (category === 'other') {
    return forms.other ?? forms.few;
  }
  return forms[category];
}

/** English two-form plural, for parity with `pluralRu` in shared code. */
export function pluralEn(count: number, forms: { one: string; other: string }): string {
  return count === 1 ? forms.one : forms.other;
}
