import { ChevronDown } from 'lucide-react';
import { formatContextTokensExact } from 'librechat-data-provider';
import type { TContextMeasurementSource } from 'librechat-data-provider';
import type { ContextCounterFormatter } from './hooks';
import type { ContextCounterMode } from './types';
import type { TranslationKeys } from '~/hooks';
import type { PanelView } from './model';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const SOURCE_KEYS: Record<TContextMeasurementSource, TranslationKeys> = {
  provider: 'com_ui_cc_source_provider',
  server_estimate: 'com_ui_cc_source_server_estimate',
  tokenizer_estimate: 'com_ui_cc_source_tokenizer_estimate',
  unavailable: 'com_ui_cc_source_unavailable',
};

const MODE_KEYS: Record<ContextCounterMode, TranslationKeys> = {
  next: 'com_ui_cc_mode_next',
  last: 'com_ui_cc_mode_last',
};

interface HeaderProps {
  panel: PanelView;
  format: ContextCounterFormatter;
}

/**
 * Title + main number + percent (§3 item 1). `≈` marks every estimate; a
 * confirmed provider input has none. Without a budget the volume stands alone;
 * with `B ≤ 0` the percent is replaced by the exhausted label (§5).
 */
export function Header({ panel, format }: HeaderProps) {
  const localize = useLocalize();
  const withApprox = (text: string) =>
    panel.approximate ? localize('com_ui_cc_approx', { 0: text }) : text;

  let value: string;
  let percent: string | null = null;
  if (!panel.available) {
    value = localize('com_ui_cc_mini_unavailable');
  } else if (panel.budget == null || panel.budgetExhausted) {
    value = withApprox(format.tokens(panel.occupied));
  } else {
    value = withApprox(format.pair(panel.occupied, panel.budget));
    percent = format.percent(panel.occupied, panel.budget);
  }
  const overflow = panel.fillPercent != null && panel.fillPercent > 100;

  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="whitespace-nowrap text-sm font-medium text-text-primary">
        {localize('com_ui_cc_title')}
      </span>
      <span
        className="flex items-baseline gap-1 whitespace-nowrap text-xs font-medium tabular-nums text-text-secondary"
        data-testid="cc-header-value"
        title={panel.available ? formatContextTokensExact(panel.occupied) : undefined}
      >
        <span>{value}</span>
        {percent != null && (
          <span
            className={cn('text-text-primary', overflow && 'text-text-warning')}
            data-testid="cc-header-percent"
          >
            {percent}
          </span>
        )}
      </span>
    </div>
  );
}

interface ModeToggleProps {
  mode: ContextCounterMode;
  source: TContextMeasurementSource;
  onToggle: () => void;
}

/**
 * §3 «режим + источник» as a real button: `aria-pressed` reflects the «last»
 * mode, Enter/Space toggle natively, the chevron is the affordance. Its
 * accessible name is the visible line plus the sr-only hint.
 */
export function ModeToggle({ mode, source, onToggle }: ModeToggleProps) {
  const localize = useLocalize();
  return (
    <button
      type="button"
      aria-pressed={mode === 'last'}
      onClick={onToggle}
      data-testid="cc-mode-toggle"
      className={cn(
        'group flex w-full items-center justify-between gap-2 rounded-sm text-left text-xs text-text-secondary',
        'hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
      )}
    >
      <span>
        {localize('com_ui_cc_status_line', {
          0: localize(MODE_KEYS[mode]),
          1: localize(SOURCE_KEYS[source]),
        })}
        <span className="sr-only"> {localize('com_ui_cc_toggle_label')}</span>
      </span>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0 text-text-tertiary transition-transform duration-300 ease-out motion-reduce:transition-none',
          mode === 'last' && 'rotate-180',
        )}
      />
    </button>
  );
}
