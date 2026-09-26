import {
  roundHalfUp,
  EN_TOKEN_UNITS,
  RU_TOKEN_UNITS,
  roundRatioHalfUp,
  formatContextTokens,
  roundContextPercent,
  formatContextPercent,
  clampContextBarPercent,
  formatContextTokensExact,
} from './format';

describe('half-up rounding (§5.1)', () => {
  it('rounds 0.5 up with exact integer arithmetic', () => {
    expect(roundRatioHalfUp(285, 10)).toBe(29);
    expect(roundRatioHalfUp(284, 10)).toBe(28);
    expect(roundRatioHalfUp(5, 10)).toBe(1);
    expect(roundRatioHalfUp(4, 10)).toBe(0);
    expect(roundRatioHalfUp(1, 0)).toBe(0);
  });

  it('roundHalfUp handles plain values and rejects non-finite input', () => {
    expect(roundHalfUp(64.5)).toBe(65);
    expect(roundHalfUp(64.4999)).toBe(64);
    expect(roundHalfUp(Number.NaN)).toBe(0);
    expect(roundHalfUp(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('formatContextPercent (§5.1, §10.25, §10.18)', () => {
  it('§10.25: 72 000 / 112 000 → 64%', () => {
    expect(formatContextPercent(72_000, 112_000)).toBe('64%');
  });

  it('rounds half up: 64.5% → 65%, 28.5% → 29%', () => {
    expect(formatContextPercent(645, 1_000)).toBe('65%');
    expect(formatContextPercent(285, 1_000)).toBe('29%');
    expect(formatContextPercent(284, 1_000)).toBe('28%');
  });

  it('shows <1% for a positive fill below one percent and 0% for nothing', () => {
    expect(formatContextPercent(742, 451_300)).toBe('<1%');
    expect(formatContextPercent(1, 1_000_000)).toBe('<1%');
    expect(formatContextPercent(0, 451_300)).toBe('0%');
  });

  it('exactly one percent is 1%, not <1%', () => {
    expect(formatContextPercent(1_000, 100_000)).toBe('1%');
  });

  it('overflow keeps the real text value', () => {
    expect(formatContextPercent(108_000, 100_000)).toBe('108%');
  });

  it('B ≤ 0 or unknown: null, never NaN', () => {
    expect(formatContextPercent(5_000, null)).toBeNull();
    expect(formatContextPercent(5_000, 0)).toBeNull();
    expect(formatContextPercent(5_000, -1)).toBeNull();
  });

  it('roundContextPercent and clampContextBarPercent split text from bar', () => {
    expect(roundContextPercent(64.2857)).toBe(64);
    expect(roundContextPercent(107.5)).toBe(108);
    expect(roundContextPercent(null)).toBeNull();
    expect(clampContextBarPercent(108)).toBe(100);
    expect(clampContextBarPercent(64.28)).toBe(64.28);
    expect(clampContextBarPercent(null)).toBe(0);
    expect(clampContextBarPercent(-3)).toBe(0);
  });
});

describe('formatContextTokens (§5.1 тыс./млн)', () => {
  it('prints integers below 1000 as they are', () => {
    expect(formatContextTokens(742)).toBe('742');
    expect(formatContextTokens(0)).toBe('0');
    expect(formatContextTokens(999)).toBe('999');
  });

  it('prints one decimal with «тыс.» and keeps the ,0', () => {
    expect(formatContextTokens(9_900)).toBe('9,9 тыс.');
    expect(formatContextTokens(72_000)).toBe('72,0 тыс.');
    expect(formatContextTokens(90_142)).toBe('90,1 тыс.');
    expect(formatContextTokens(21_100)).toBe('21,1 тыс.');
    expect(formatContextTokens(1_000)).toBe('1,0 тыс.');
  });

  it('rounds the tenth half up from the raw integer', () => {
    expect(formatContextTokens(9_950)).toBe('10,0 тыс.');
    expect(formatContextTokens(9_949)).toBe('9,9 тыс.');
    expect(formatContextTokens(1_650_000)).toBe('1,7 млн');
    expect(formatContextTokens(1_649_999)).toBe('1,6 млн');
  });

  it('prints «млн» from one million and moves up when thousands round to 1000,0', () => {
    expect(formatContextTokens(1_600_000)).toBe('1,6 млн');
    expect(formatContextTokens(1_000_000)).toBe('1,0 млн');
    expect(formatContextTokens(999_950)).toBe('1,0 млн');
    expect(formatContextTokens(999_949)).toBe('999,9 тыс.');
  });

  it('supports English units', () => {
    expect(formatContextTokens(72_000, EN_TOKEN_UNITS)).toBe('72.0K');
    expect(formatContextTokens(1_600_000, EN_TOKEN_UNITS)).toBe('1.6M');
    expect(formatContextTokens(742, EN_TOKEN_UNITS)).toBe('742');
    expect(RU_TOKEN_UNITS.decimalSeparator).toBe(',');
  });

  it('never prints NaN for malformed input', () => {
    expect(formatContextTokens(Number.NaN)).toBe('0');
    expect(formatContextTokens(-5)).toBe('0');
  });

  it('exact values group thousands for detail views', () => {
    expect(formatContextTokensExact(90_142, ' ')).toBe('90 142');
    expect(formatContextTokensExact(1_600_000, ' ')).toBe('1 600 000');
    expect(formatContextTokensExact(742)).toBe('742');
  });
});
