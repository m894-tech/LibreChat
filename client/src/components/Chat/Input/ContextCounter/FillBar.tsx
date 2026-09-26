import { SegmentedMeter } from '@librechat/client';
import { clampContextBarPercent } from 'librechat-data-provider';
import type { MeterSegment } from '@librechat/client';
import type { ContextCounterFormatter } from './hooks';
import type { PanelView } from './model';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface FillBarProps {
  panel: PanelView;
  format: ContextCounterFormatter;
  highlightId: string | null;
}

/** A confirmed total without a known composition draws as one outlined fill (§10.6). */
function meterSegments(panel: PanelView): MeterSegment[] {
  if (!panel.compositionKnown) {
    return [{ id: 'occupied', value: panel.occupied, slot: 1, outlined: true }];
  }
  return panel.segments.map((segment) => ({
    id: segment.key,
    value: segment.value,
    slot: segment.slot,
    outlined: panel.compositionEstimated,
  }));
}

/**
 * §3 item 3. Only `●` segments are drawn; their widths sum to `occupied / B`.
 * Overflow fills the track to the edge while the a11y value stays within
 * `0–100` and the real percent travels in `aria-valuetext` (§9). No budget or
 * `B ≤ 0` renders an indeterminate dashed track.
 */
export function FillBar({ panel, format, highlightId }: FillBarProps) {
  const localize = useLocalize();
  const indeterminate = !panel.available || panel.budget == null || panel.budgetExhausted;
  const max = indeterminate ? 1 : (panel.budget as number);
  const segments = indeterminate ? [] : meterSegments(panel);
  const percentText = indeterminate ? null : format.percent(panel.occupied, panel.budget);

  return (
    <SegmentedMeter
      className={cn(
        'mt-3',
        indeterminate && 'border border-dashed border-border-medium bg-transparent',
      )}
      segments={segments}
      max={max}
      highlightId={highlightId}
      role="progressbar"
      aria-label={localize('com_ui_cc_title')}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clampContextBarPercent(panel.fillPercent)}
      aria-valuetext={
        percentText ??
        (panel.budgetExhausted
          ? localize('com_ui_cc_budget_exhausted')
          : localize('com_ui_cc_no_limit'))
      }
      data-testid="cc-fill-bar"
      data-overflow={panel.fillPercent != null && panel.fillPercent > 100 ? 'true' : undefined}
    />
  );
}
