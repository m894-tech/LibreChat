import {
  sumContextOccupied,
  computeContextFree,
  computeContextBudget,
  emptyContextOccupied,
  computeContextFillView,
  normalizeContextOccupied,
  isContextBudgetExhausted,
  computeContextFillPercent,
  resolveContextCacheOverlay,
} from './budget';

describe('computeContextBudget (§5 B = min(W − R, L))', () => {
  it('§10.1: window 128 000 and reserve 16 000 give budget 112 000', () => {
    expect(computeContextBudget({ window: 128_000, reserve: 16_000 })).toEqual({
      window: 128_000,
      reserve: 16_000,
      inputLimit: null,
      budget: 112_000,
    });
  });

  it('applies the separate input limit when it is smaller', () => {
    expect(computeContextBudget({ window: 200_000, reserve: 8_000, inputLimit: 100_000 })).toEqual({
      window: 200_000,
      reserve: 8_000,
      inputLimit: 100_000,
      budget: 100_000,
    });
  });

  it('ignores an input limit that is larger than W − R', () => {
    expect(
      computeContextBudget({ window: 128_000, reserve: 16_000, inputLimit: 150_000 }).budget,
    ).toBe(112_000);
  });

  it('returns a null budget when the window is unknown', () => {
    expect(computeContextBudget({ window: null, reserve: 4_000 })).toEqual({
      window: null,
      reserve: 4_000,
      inputLimit: null,
      budget: null,
    });
    expect(computeContextBudget({ window: 0 }).budget).toBeNull();
    expect(computeContextBudget({ window: Number.NaN }).budget).toBeNull();
  });

  it('keeps B ≤ 0 as a real value («бюджет исчерпан резервом»)', () => {
    const budget = computeContextBudget({ window: 8_000, reserve: 8_000 });
    expect(budget.budget).toBe(0);
    expect(isContextBudgetExhausted(budget)).toBe(true);
    expect(computeContextBudget({ window: 8_000, reserve: 9_000 }).budget).toBe(-1_000);
    expect(isContextBudgetExhausted(-1_000)).toBe(true);
    expect(isContextBudgetExhausted(null)).toBe(false);
    expect(isContextBudgetExhausted(112_000)).toBe(false);
  });

  it('treats a missing or negative reserve as 0 and floors fractions', () => {
    expect(computeContextBudget({ window: 100_000.9 }).budget).toBe(100_000);
    expect(computeContextBudget({ window: 100_000, reserve: -5 }).budget).toBe(100_000);
  });
});

describe('occupied and free (§5, §10.21)', () => {
  const occupied = {
    messages: 742,
    toolCalls: 9_900,
    systemPrompt: 21_100,
    mcpTools: 58_400,
    attachments: 0,
    other: 0,
  };

  it('sums only the ● segments — cache and free are never summands', () => {
    expect(sumContextOccupied(occupied)).toBe(90_142);
    expect(sumContextOccupied({ ...occupied, cacheRead: 89_600, free: 361_100 } as never)).toBe(
      90_142,
    );
  });

  it('normalizes malformed segment values to integers and drops unknown keys', () => {
    expect(
      normalizeContextOccupied({
        messages: 10.7,
        toolCalls: -3,
        systemPrompt: Number.NaN,
        mcpTools: '5' as never,
        extra: 99,
      } as never),
    ).toEqual({
      messages: 10,
      toolCalls: 0,
      systemPrompt: 0,
      mcpTools: 0,
      attachments: 0,
      other: 0,
    });
    expect(sumContextOccupied(null)).toBe(0);
    expect(emptyContextOccupied()).toEqual({
      messages: 0,
      toolCalls: 0,
      systemPrompt: 0,
      mcpTools: 0,
      attachments: 0,
      other: 0,
    });
  });

  it('free = max(B − occupied, 0) and null without a budget', () => {
    expect(computeContextFree(451_300, 90_142)).toBe(361_158);
    expect(computeContextFree(100, 250)).toBe(0);
    expect(computeContextFree(null, 250)).toBeNull();
  });
});

describe('computeContextFillPercent (§5, §10.25)', () => {
  it('§10.1: 72 000 of 112 000 is 64.28…%', () => {
    expect(computeContextFillPercent(72_000, 112_000)).toBeCloseTo(64.2857, 3);
  });

  it('may exceed 100 (overflow is text, not a clamp)', () => {
    expect(computeContextFillPercent(108_000, 100_000)).toBe(108);
  });

  it('returns null — never NaN or Infinity — for an unknown or exhausted budget', () => {
    expect(computeContextFillPercent(5_000, null)).toBeNull();
    expect(computeContextFillPercent(5_000, 0)).toBeNull();
    expect(computeContextFillPercent(5_000, -100)).toBeNull();
  });
});

describe('resolveContextCacheOverlay (§5 cache rules, §10.7)', () => {
  it('reports cache as an overlay without changing the occupied total', () => {
    expect(resolveContextCacheOverlay(90_142, { read: 89_600, write: 0 })).toEqual({
      read: 89_600,
      write: 0,
      mismatch: false,
    });
  });

  it('keeps unknown cache as null («—»), not as a guess', () => {
    expect(resolveContextCacheOverlay(90_142, { read: null, write: null })).toEqual({
      read: null,
      write: null,
      mismatch: false,
    });
    expect(resolveContextCacheOverlay(90_142, undefined).read).toBeNull();
  });

  it('flags cache > occupied as a mismatch instead of clamping', () => {
    const overlay = resolveContextCacheOverlay(50_000, { read: 60_000, write: 0 });
    expect(overlay.read).toBe(60_000);
    expect(overlay.mismatch).toBe(true);
  });
});

describe('computeContextFillView (one pass over §5)', () => {
  it('derives the header number from the ● sum and the percent from B', () => {
    const view = computeContextFillView(
      { window: 128_000, reserve: 16_000 },
      { messages: 60_000, toolCalls: 10_000, systemPrompt: 2_000 },
      { read: 50_000, write: 1_000 },
    );
    expect(view.budget.budget).toBe(112_000);
    expect(view.occupiedTotal).toBe(72_000);
    expect(view.free).toBe(40_000);
    expect(view.fillPercent).toBeCloseTo(64.2857, 3);
    expect(view.barPercent).toBeCloseTo(64.2857, 3);
    expect(view.exhausted).toBe(false);
    expect(view.cache).toEqual({ read: 50_000, write: 1_000, mismatch: false });
  });

  it('accepts an already resolved budget and clamps the bar on overflow', () => {
    const view = computeContextFillView(
      { window: 100_000, reserve: 0, inputLimit: null, budget: 100_000 },
      { messages: 108_000 },
    );
    expect(view.fillPercent).toBe(108);
    expect(view.barPercent).toBe(100);
    expect(view.free).toBe(0);
  });

  it('B ≤ 0: no percent, no NaN, exhausted flag set', () => {
    const view = computeContextFillView({ window: 8_000, reserve: 8_000 }, { messages: 100 });
    expect(view.fillPercent).toBeNull();
    expect(view.barPercent).toBe(0);
    expect(view.exhausted).toBe(true);
    expect(view.free).toBe(0);
  });

  it('unknown window: volume without percent', () => {
    const view = computeContextFillView({ window: null }, { messages: 742 });
    expect(view.occupiedTotal).toBe(742);
    expect(view.fillPercent).toBeNull();
    expect(view.free).toBeNull();
    expect(view.exhausted).toBe(false);
  });
});
