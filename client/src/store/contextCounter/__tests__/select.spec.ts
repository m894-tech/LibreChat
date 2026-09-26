import type { EstimateEntry } from '../reducer';
import {
  selectMiniIndicator,
  selectPrimaryView,
  selectBottomButton,
  selectEstimateView,
  selectLastCallView,
} from '../select';
import { estimateFixture, lastCallFixture } from '../fixtures';

function entry(overrides: Partial<EstimateEntry> = {}): EstimateEntry {
  return {
    estimate: estimateFixture(),
    fingerprint: 'fp-1',
    status: 'fresh',
    pendingRevision: null,
    pendingFingerprint: null,
    ...overrides,
  };
}

describe('selectEstimateView', () => {
  it('is «Нет данных» without an entry and never invents a number', () => {
    const view = selectEstimateView(undefined, 'fp-1');
    expect(view).toMatchObject({ status: 'unavailable', occupied: null, fillRatio: null });
  });

  it('sums the ● segments into occupied and divides by B (§5, §10.21)', () => {
    const view = selectEstimateView(entry(), 'fp-1');
    expect(view.occupied).toBe(742 + 9_900 + 21_100 + 58_400);
    expect(view.fillRatio).toBeCloseTo(90_142 / 112_000, 6);
    expect(view.status).toBe('fresh');
  });

  it('reports a fresh answer for another fingerprint as stale (§10.3, §10.4)', () => {
    const view = selectEstimateView(entry(), 'fp-2');
    expect(view.status).toBe('stale');
    expect(view.staleReason).toBe('unknown');
    expect(view.estimate).not.toBeNull();
  });

  it('shows «Считаем» over the previous numbers while a request is pending', () => {
    const view = selectEstimateView(
      entry({ status: 'stale', staleReason: 'draft_changed', pendingRevision: 3 }),
      'fp-2',
    );
    expect(view.status).toBe('calculating');
    expect(view.isCalculating).toBe(true);
    expect(view.occupied).not.toBeNull();
  });

  it('B ≤ 0 yields no ratio and the exhausted flag (§5, §10.25)', () => {
    const view = selectEstimateView(
      entry({
        estimate: estimateFixture({
          budget: { window: 10_000, reserve: 16_000, inputLimit: null, budget: -6_000 },
        }),
      }),
      'fp-1',
    );
    expect(view.fillRatio).toBeNull();
    expect(view.budgetExhausted).toBe(true);
  });

  it('keeps the exclusion plan regardless of fill (§10.9)', () => {
    const excluded = { count: 14, reason: 'over_budget' as const, messages: [] };
    const view = selectEstimateView(entry({ estimate: estimateFixture({ excluded }) }), 'fp-1');
    expect(view.excluded?.count).toBe(14);
  });
});

describe('selectLastCallView', () => {
  const current = {
    configuration: { endpoint: 'anthropic', model: 'claude', agentId: null },
    window: 128_000,
    reserve: 16_000,
    inputLimit: null,
  };

  it('§10.1: 72 000 / (128 000 − 16 000) is measured against its own budget', () => {
    const view = selectLastCallView(lastCallFixture(), current);
    expect(view.fillRatio).toBeCloseTo(72_000 / 112_000, 6);
    expect(view.configMismatch).toBe(false);
    expect(view.providerData).toBe(true);
  });

  it('§10.3 / §10.31: a model change flags the badge and keeps the old ratio', () => {
    const view = selectLastCallView(lastCallFixture(), {
      ...current,
      configuration: { ...current.configuration, model: 'gpt-4o' },
      window: 400_000,
    });
    expect(view.configMismatch).toBe(true);
    expect(view.mismatchReason).toBe('model_changed');
    expect(view.fillRatio).toBeCloseTo(72_000 / 112_000, 6);
  });

  it('a window change alone is reported as limits_changed', () => {
    const view = selectLastCallView(lastCallFixture(), { ...current, window: 200_000 });
    expect(view.mismatchReason).toBe('limits_changed');
  });

  it('an agent run measured under endpoint `agents` matches the same resolved provider', () => {
    const measured = lastCallFixture({
      configuration: {
        endpoint: 'agents',
        provider: 'anthropic',
        model: 'claude',
        agentId: 'agent_1',
      },
    });
    const view = selectLastCallView(measured, {
      ...current,
      configuration: {
        endpoint: 'anthropic',
        provider: 'anthropic',
        model: 'claude',
        agentId: 'agent_1',
      },
    });
    expect(view.configMismatch).toBe(false);
  });

  it('a different agent with the same model is still a mismatch', () => {
    const measured = lastCallFixture({
      configuration: { endpoint: 'agents', provider: 'anthropic', model: 'claude', agentId: 'a' },
    });
    const view = selectLastCallView(measured, {
      ...current,
      configuration: {
        endpoint: 'anthropic',
        provider: 'anthropic',
        model: 'claude',
        agentId: 'b',
      },
    });
    expect(view.mismatchReason).toBe('model_changed');
  });

  it('an unknown client window is not a mismatch', () => {
    const view = selectLastCallView(lastCallFixture(), { ...current, window: null });
    expect(view.configMismatch).toBe(false);
  });

  it('§10.5: without provider usage the label «данные провайдера» is off', () => {
    const view = selectLastCallView(lastCallFixture({ source: 'server_estimate' }), current);
    expect(view.providerData).toBe(false);
  });

  it('§10.6: a confirmed total with an estimated composition is flagged', () => {
    const view = selectLastCallView(
      lastCallFixture({
        composition: {
          messages: 1,
          toolCalls: 0,
          systemPrompt: 0,
          mcpTools: 0,
          attachments: 0,
          other: 0,
        },
        compositionSource: 'server_estimate',
      }),
      current,
    );
    expect(view.compositionEstimated).toBe(true);
  });
});

describe('selectBottomButton — §3 table (§10.20)', () => {
  const fresh = selectEstimateView(entry(), 'fp-1');
  const stale = selectEstimateView(entry(), 'fp-2');
  const none = selectEstimateView(undefined, 'fp-1');
  const over = selectEstimateView(
    entry({
      estimate: estimateFixture({
        excluded: { count: 3, reason: 'over_budget', messages: [] },
      }),
    }),
    'fp-2',
  );

  it.each([
    [
      'streaming → no action',
      { isSubmitting: true, estimate: over, compressSupported: true },
      'none',
    ],
    [
      'stale, under threshold → recalculate',
      { isSubmitting: false, estimate: stale, compressSupported: true },
      'recalculate',
    ],
    [
      'no data → recalculate',
      { isSubmitting: false, estimate: none, compressSupported: true },
      'recalculate',
    ],
    [
      'threshold reached → compress',
      { isSubmitting: false, estimate: over, compressSupported: true },
      'compress',
    ],
    [
      'both stale and over threshold → compress',
      { isSubmitting: false, estimate: over, compressSupported: true },
      'compress',
    ],
    [
      'over threshold, compaction unsupported → recalculate',
      { isSubmitting: false, estimate: over, compressSupported: false },
      'recalculate',
    ],
    [
      'fresh, under threshold → compress as the single action',
      { isSubmitting: false, estimate: fresh, compressSupported: true },
      'compress',
    ],
    [
      'fresh, no compaction → none',
      { isSubmitting: false, estimate: fresh, compressSupported: false },
      'none',
    ],
  ] as const)('%s', (_label, input, expected) => {
    expect(selectBottomButton({ ...input, compressThreshold: 0.9 })).toBe(expected);
  });

  it('fill ratio at the threshold counts as reached', () => {
    expect(
      selectBottomButton({
        isSubmitting: false,
        estimate: fresh,
        compressSupported: true,
        compressThreshold: 0.8,
      }),
    ).toBe('compress');
  });
});

describe('selectPrimaryView / selectMiniIndicator', () => {
  const estimate = selectEstimateView(entry(), 'fp-1');
  const lastCall = selectLastCallView(lastCallFixture(), null);

  it('next mode shows the forecast with ≈', () => {
    const view = selectPrimaryView('next', estimate, lastCall);
    expect(view).toMatchObject({ kind: 'next', total: 90_142, isEstimate: true, fallback: false });
  });

  it('last mode shows the measurement against its own budget, response excluded (§10.2)', () => {
    const view = selectPrimaryView('last', estimate, lastCall);
    expect(view).toMatchObject({ kind: 'last', total: 72_000, isEstimate: false });
    expect(view.budget?.budget).toBe(112_000);
  });

  it('last mode without a measurement falls back to next and says so', () => {
    const view = selectPrimaryView('last', estimate, selectLastCallView(undefined, null));
    expect(view).toMatchObject({ kind: 'next', fallback: true });
  });

  it.each([
    ['fresh', entry(), 'fp-1', 'fresh'],
    ['stale', entry(), 'fp-2', 'stale'],
    ['calculating', entry({ pendingRevision: 2 }), 'fp-1', 'calculating'],
    [
      'no limit',
      entry({
        estimate: estimateFixture({
          budget: { window: null, reserve: 0, inputLimit: null, budget: null },
        }),
      }),
      'fp-1',
      'no_limit',
    ],
    [
      'overflow',
      entry({
        estimate: estimateFixture({
          budget: { window: 100_000, reserve: 20_000, inputLimit: null, budget: 80_000 },
        }),
      }),
      'fp-1',
      'overflow',
    ],
  ] as const)('mini indicator: %s', (_label, storeEntry, fingerprint, kind) => {
    expect(selectMiniIndicator(selectEstimateView(storeEntry, fingerprint)).kind).toBe(kind);
  });

  it('mini indicator: no entry → unavailable, and it mirrors the menu numbers (§10.33)', () => {
    expect(selectMiniIndicator(selectEstimateView(undefined, 'fp')).kind).toBe('unavailable');
    const mini = selectMiniIndicator(estimate);
    expect(mini.occupied).toBe(estimate.occupied);
    expect(mini.fillRatio).toBe(estimate.fillRatio);
  });
});
