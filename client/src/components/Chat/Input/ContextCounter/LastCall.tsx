import { TriangleAlert } from 'lucide-react';
import type { ContextCounterFormatter } from './hooks';
import type { ContextCounterMode } from './types';
import type { TranslationKeys } from '~/hooks';
import type { PanelView } from './model';
import { useLocalize } from '~/hooks';
import { TokenValue } from './Rows';
import { cn } from '~/utils';

const SOURCE_KEYS: Record<PanelView['source'], TranslationKeys> = {
  provider: 'com_ui_cc_source_provider',
  server_estimate: 'com_ui_cc_source_server_estimate',
  tokenizer_estimate: 'com_ui_cc_source_tokenizer_estimate',
  unavailable: 'com_ui_cc_source_unavailable',
};

interface LastCallProps {
  mode: ContextCounterMode;
  last: PanelView;
  next: PanelView;
  /** Output of the last call, shown as «не входит во вход» when known (§3). */
  lastOutput: number | null;
  format: ContextCounterFormatter;
}

/**
 * §3 item 5. In «next» mode: the last call's row with its model/source line
 * and, on a configuration mismatch, the «измерено для …» badge — the old
 * percent stays against its own budget. In «last» mode the row is highlighted
 * and the next request appears as the secondary line.
 */
export function LastCall({ mode, last, next, lastOutput, format }: LastCallProps) {
  const localize = useLocalize();
  const viewingLast = mode === 'last';

  if (!last.available) {
    return (
      <div className="space-y-1" data-testid="cc-last-call">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="shrink-0 text-text-secondary">{localize('com_ui_cc_mode_last')}</span>
          <span className="text-right text-xs text-text-tertiary">
            {localize('com_ui_cc_no_last_call')}
          </span>
        </div>
        {viewingLast && <NextLine next={next} format={format} />}
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="cc-last-call">
      <div
        className={cn(
          'flex items-center justify-between gap-4 text-sm',
          viewingLast && '-mx-1.5 rounded-md bg-surface-tertiary px-1.5 py-0.5',
        )}
        aria-current={viewingLast ? 'true' : undefined}
        data-testid="cc-last-call-row"
      >
        <span className={cn('text-text-secondary', viewingLast && 'text-text-primary')}>
          {localize('com_ui_cc_mode_last')}
        </span>
        <TokenValue
          value={last.occupied}
          budget={last.budgetExhausted ? null : last.budget}
          approximate={last.approximate}
          format={format}
        />
      </div>
      <p className="text-xs text-text-secondary" data-testid="cc-last-call-model">
        {localize('com_ui_cc_model_line', {
          0: last.measuredModel ?? localize('com_ui_cc_unknown_model'),
          1: localize(SOURCE_KEYS[last.source]),
        })}
      </p>
      {last.configurationMismatch && (
        <p
          className="flex items-start gap-1.5 text-xs text-text-warning"
          data-testid="cc-last-call-mismatch"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {localize('com_ui_cc_measured_for', {
              0: last.measuredModel ?? localize('com_ui_cc_unknown_model'),
            })}
          </span>
        </p>
      )}
      {viewingLast && lastOutput != null && lastOutput > 0 && (
        <p className="text-xs text-text-tertiary">
          {localize('com_ui_cc_output_not_included', { 0: format.tokens(lastOutput) })}
        </p>
      )}
      {viewingLast && <NextLine next={next} format={format} />}
    </div>
  );
}

function NextLine({ next, format }: { next: PanelView; format: ContextCounterFormatter }) {
  const localize = useLocalize();
  return (
    <div className="flex items-center justify-between gap-4 text-sm" data-testid="cc-next-line">
      <span className="text-text-secondary">{localize('com_ui_cc_mode_next')}</span>
      {next.available ? (
        <TokenValue
          value={next.occupied}
          budget={next.budgetExhausted ? null : next.budget}
          approximate
          format={format}
        />
      ) : (
        <span className="text-xs text-text-tertiary">{localize('com_ui_cc_mini_unavailable')}</span>
      )}
    </div>
  );
}
