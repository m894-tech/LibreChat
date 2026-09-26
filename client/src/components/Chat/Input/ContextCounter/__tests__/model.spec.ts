import { formatContextPercent } from 'librechat-data-provider';
import type { ContextCounterViewModel } from '../types';
import {
  errorVm,
  staleVm,
  normalVm,
  partialVm,
  overflowVm,
  streamingVm,
  compressingVm,
  calculatingVm,
  unavailableVm,
  lastCallMismatchVm,
} from '../fixtures';
import {
  deriveLastPanel,
  deriveNextPanel,
  staleReasonKind,
  resolveBottomAction,
  isConfigurationMismatch,
} from '../model';

describe('resolveBottomAction — §3 one bottom button', () => {
  it('shows a waiting status and no button while the model streams', () => {
    expect(resolveBottomAction(streamingVm)).toEqual({ kind: 'waiting' });
  });

  it('offers «Пересчитать» for a stale estimate below the compress threshold', () => {
    expect(resolveBottomAction(staleVm)).toEqual({
      kind: 'recalculate',
      retry: false,
      disabledReason: null,
    });
  });

  it('offers «Пересчитать» when there is no data', () => {
    expect(resolveBottomAction(unavailableVm)).toMatchObject({ kind: 'recalculate' });
  });

  it('offers «Сжать» once the threshold is reached, even with a stale estimate', () => {
    expect(resolveBottomAction(overflowVm)).toEqual({ kind: 'compress', disabledReason: null });
    const staleOverflow: ContextCounterViewModel = {
      ...overflowVm,
      nextRequestEstimate: { ...overflowVm.nextRequestEstimate!, status: 'stale' },
    };
    expect(resolveBottomAction(staleOverflow)).toEqual({ kind: 'compress', disabledReason: null });
  });

  it('turns the error state into a retry', () => {
    expect(resolveBottomAction(errorVm)).toMatchObject({ kind: 'recalculate', retry: true });
  });

  it('keeps the button disabled with a reason during a conflicting operation (§8)', () => {
    expect(resolveBottomAction(compressingVm)).toEqual({
      kind: 'compress',
      disabledReason: 'compressing',
    });
    expect(resolveBottomAction(calculatingVm)).toMatchObject({ disabledReason: 'calculating' });
    const sending: ContextCounterViewModel = {
      ...staleVm,
      activity: { ...staleVm.activity, sending: true },
    };
    expect(resolveBottomAction(sending)).toMatchObject({ disabledReason: 'sending' });
  });

  it('marks «Пересчитать» unavailable when no estimate endpoint is wired', () => {
    const noEstimate: ContextCounterViewModel = {
      ...unavailableVm,
      capabilities: { ...unavailableVm.capabilities, estimateSupported: false },
    };
    expect(resolveBottomAction(noEstimate)).toMatchObject({
      disabledReason: 'estimate_unavailable',
    });
  });

  it('hides the button entirely for a fresh estimate without compression support', () => {
    const noCompress: ContextCounterViewModel = {
      ...normalVm,
      capabilities: { ...normalVm.capabilities, compressionSupported: false },
    };
    expect(resolveBottomAction(noCompress)).toEqual({ kind: 'none' });
    expect(resolveBottomAction(partialVm)).toMatchObject({ kind: 'recalculate' });
  });
});

describe('derive panels — §5 and §3', () => {
  it('sums the ● segments into the header number and the fill percent of B', () => {
    const panel = deriveNextPanel(normalVm);
    expect(panel.occupied).toBe(90_142);
    expect(panel.segments.reduce((sum, segment) => sum + segment.value, 0)).toBe(panel.occupied);
    expect(formatContextPercent(panel.occupied, panel.budget)).toBe('20%');
    expect(panel.free).toBe(451_300 - 90_142);
    expect(panel.approximate).toBe(true);
  });

  it('reports a real percent above 100 for overflow (§10.18)', () => {
    const panel = deriveNextPanel(overflowVm);
    expect(panel.fillPercent).toBeGreaterThan(100);
    expect(formatContextPercent(panel.occupied, panel.budget)).toBe('108%');
  });

  it('measures the last call against its own budget, not the current one (§10.31)', () => {
    const panel = deriveLastPanel(lastCallMismatchVm);
    expect(panel.budget).toBe(112_000);
    expect(formatContextPercent(panel.occupied, panel.budget)).toBe('64%');
    expect(panel.configurationMismatch).toBe(true);
    expect(panel.approximate).toBe(false);
    expect(panel.compositionEstimated).toBe(true);
  });

  it('never adds the response to the last call input (§10.2)', () => {
    expect(deriveLastPanel(normalVm).occupied).toBe(normalVm.lastCallMeasurement!.input);
  });
});

describe('configuration comparisons', () => {
  it('detects a model change but ignores missing metadata', () => {
    expect(isConfigurationMismatch({ model: 'a' }, { model: 'b' })).toBe(true);
    expect(isConfigurationMismatch({ model: 'a' }, {})).toBe(false);
    expect(isConfigurationMismatch({ model: 'a', provider: 'x' }, { model: 'a' })).toBe(false);
  });

  it('names the concrete cause for the §4 warning', () => {
    expect(staleReasonKind('model_changed')).toBe('model');
    expect(staleReasonKind('limits_changed')).toBe('model');
    expect(staleReasonKind('tools_changed')).toBe('tools');
    expect(staleReasonKind('instructions_changed')).toBe('tools');
    expect(staleReasonKind('draft_changed')).toBeNull();
  });
});
