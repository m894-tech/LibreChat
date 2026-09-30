import type { TContextNextRequestEstimate } from 'librechat-data-provider';
import type { ContextCounterFormatter } from './hooks';
import type { ContextCounterViewModel } from './types';
import { deriveNextPanel } from './model';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export interface MiniIndicatorText {
  text: string;
  /** Stale or unavailable: rendered muted, never as a fresh number. */
  dimmed: boolean;
  overflow: boolean;
}

type Localize = ReturnType<typeof useLocalize>;

/**
 * §9 mini-indicator: the next-request snapshot only, same estimate/provider
 * rules as the menu, no third number. Exported so the menu and the indicator
 * can be checked against each other (§10.33).
 */
export function miniIndicatorText(
  vm: ContextCounterViewModel,
  format: ContextCounterFormatter,
  localize: Localize,
): MiniIndicatorText {
  const estimate: TContextNextRequestEstimate | null = vm.nextRequestEstimate;
  const panel = deriveNextPanel(vm);
  if (estimate == null || !panel.available || estimate.status === 'error') {
    return { text: localize('com_ui_cc_mini_unavailable'), dimmed: true, overflow: false };
  }
  if (estimate.status === 'calculating') {
    return { text: localize('com_ui_cc_mini_calculating'), dimmed: true, overflow: false };
  }
  const overflow = panel.fillPercent != null && panel.fillPercent > 100;
  const number =
    panel.budget == null || panel.budgetExhausted
      ? format.tokens(panel.occupied)
      : `${format.pair(panel.occupied, panel.budget)} ${format.percent(panel.occupied, panel.budget) ?? ''}`.trimEnd();
  const value = localize('com_ui_cc_approx', { 0: number });
  if (estimate.status === 'stale') {
    return {
      text: localize('com_ui_cc_status_line', { 0: value, 1: localize('com_ui_cc_mini_stale') }),
      dimmed: true,
      overflow,
    };
  }
  return { text: value, dimmed: false, overflow };
}

interface MiniIndicatorProps {
  vm: ContextCounterViewModel;
  format: ContextCounterFormatter;
}

export function MiniIndicator({ vm, format }: MiniIndicatorProps) {
  const localize = useLocalize();
  const mini = miniIndicatorText(vm, format, localize);
  return (
    <span
      className={cn(
        'whitespace-nowrap text-[11px] font-medium tabular-nums',
        mini.dimmed ? 'text-text-tertiary' : 'text-text-secondary',
        mini.overflow && 'text-text-warning',
      )}
      data-testid="cc-mini"
      data-dimmed={mini.dimmed ? 'true' : undefined}
    >
      {mini.text}
    </span>
  );
}
