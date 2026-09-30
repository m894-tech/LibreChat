import { EN_TOKEN_UNITS, RU_TOKEN_UNITS } from 'librechat-data-provider';
import { formatContextTokenPair, tokenUnitsForLanguage } from '../format';

describe('formatContextTokenPair — §2 header pair', () => {
  it('writes a shared unit once, after the pair (RU comma decimal)', () => {
    expect(formatContextTokenPair(90_142, 451_300, RU_TOKEN_UNITS)).toBe('90,1 / 451,3 тыс.');
    expect(formatContextTokenPair(1_600_000, 2_000_000, RU_TOKEN_UNITS)).toBe('1,6 / 2,0 млн');
  });

  it('keeps separate units when they differ', () => {
    expect(formatContextTokenPair(742, 451_300, RU_TOKEN_UNITS)).toBe('742 / 451,3 тыс.');
    expect(formatContextTokenPair(90_142, 1_000_000, EN_TOKEN_UNITS)).toBe('90.1K / 1.0M');
  });

  it('uses English units for non-Russian UI languages', () => {
    expect(formatContextTokenPair(72_000, 112_000, EN_TOKEN_UNITS)).toBe('72.0 / 112.0K');
    expect(tokenUnitsForLanguage('ru')).toBe(RU_TOKEN_UNITS);
    expect(tokenUnitsForLanguage('ru-RU')).toBe(RU_TOKEN_UNITS);
    expect(tokenUnitsForLanguage('en')).toBe(EN_TOKEN_UNITS);
    expect(tokenUnitsForLanguage(undefined)).toBe(EN_TOKEN_UNITS);
  });
});
