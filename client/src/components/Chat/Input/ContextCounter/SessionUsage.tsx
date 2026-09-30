import { toTokenInteger } from 'librechat-data-provider';
import type { TContextSessionUsage } from 'librechat-data-provider';
import type { ContextCounterFormatter } from './hooks';
import { useLocalize } from '~/hooks';
import { PlainRow } from './Rows';

interface SessionUsageProps {
  usage: TContextSessionUsage | null;
  format: ContextCounterFormatter;
}

/**
 * §3 item 6 «Расход за сессию · эта ветка»: four independent counters, never a
 * share of the window. Cache rows appear only when the provider let input be
 * split from cache and the value is above zero; `complete === false` is
 * labelled «неполно» rather than presented as the full cost.
 */
export function SessionUsage({ usage, format }: SessionUsageProps) {
  const localize = useLocalize();
  const auxiliaryTotal =
    usage?.auxiliary != null
      ? toTokenInteger(usage.auxiliary.input) +
        toTokenInteger(usage.auxiliary.output) +
        toTokenInteger(usage.auxiliary.cacheRead) +
        toTokenInteger(usage.auxiliary.cacheWrite)
      : 0;
  const compressTotal =
    usage?.compress != null
      ? toTokenInteger(usage.compress.input) + toTokenInteger(usage.compress.output)
      : 0;

  return (
    <div className="space-y-1.5" data-testid="cc-session-usage">
      <h3 className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wider text-text-tertiary">
        <span>{localize('com_ui_cc_session_title')}</span>
        {usage != null && !usage.complete && (
          <span
            className="font-normal normal-case text-text-warning"
            data-testid="cc-session-incomplete"
          >
            {localize('com_ui_cc_session_incomplete')}
          </span>
        )}
      </h3>
      {usage == null ? (
        <p className="text-xs text-text-tertiary">{localize('com_ui_cc_session_empty')}</p>
      ) : (
        <>
          <PlainRow
            label={localize('com_ui_cc_session_input')}
            value={usage.input}
            format={format}
            testId="cc-session-input"
          />
          <PlainRow
            label={localize('com_ui_cc_session_output')}
            value={usage.output}
            format={format}
            testId="cc-session-output"
          />
          {usage.cacheSplittable && toTokenInteger(usage.cacheRead) > 0 && (
            <PlainRow
              label={localize('com_ui_cc_session_cache_read')}
              value={usage.cacheRead}
              format={format}
              testId="cc-session-cache-read"
            />
          )}
          {usage.cacheSplittable && toTokenInteger(usage.cacheWrite) > 0 && (
            <PlainRow
              label={localize('com_ui_cc_session_cache_write')}
              value={usage.cacheWrite}
              format={format}
              testId="cc-session-cache-write"
            />
          )}
          {compressTotal > 0 && (
            <PlainRow
              label={localize('com_ui_cc_session_compress')}
              value={compressTotal}
              format={format}
              indent
            />
          )}
          {auxiliaryTotal > 0 && (
            <p className="text-xs text-text-tertiary">
              {localize('com_ui_cc_session_including_auxiliary', {
                0: format.tokens(auxiliaryTotal),
              })}
            </p>
          )}
        </>
      )}
      <p className="text-xs text-text-tertiary">{localize('com_ui_cc_session_note')}</p>
    </div>
  );
}
