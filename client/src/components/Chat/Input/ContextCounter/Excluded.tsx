import { useRef } from 'react';
import * as Ariakit from '@ariakit/react';
import { Button } from '@librechat/client';
import { TriangleAlert, X } from 'lucide-react';
import { formatContextTokensExact } from 'librechat-data-provider';
import type {
  TContextExclusionPlan,
  TContextExclusionReason,
  TContextExcludedMessage,
} from 'librechat-data-provider';
import type { ContextCounterFormatter } from './hooks';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const REASON_KEYS: Record<TContextExclusionReason, TranslationKeys> = {
  over_budget: 'com_ui_cc_excluded_reason_over_budget',
  summarized: 'com_ui_cc_excluded_reason_summarized',
  tool_pair_dropped: 'com_ui_cc_excluded_reason_tool_pair_dropped',
  unsupported_content: 'com_ui_cc_excluded_reason_unsupported_content',
  other: 'com_ui_cc_excluded_reason_other',
};

const ROLE_KEYS: Record<TContextExcludedMessage['role'], TranslationKeys> = {
  user: 'com_ui_cc_role_user',
  assistant: 'com_ui_cc_role_assistant',
  tool: 'com_ui_cc_role_tool',
  system: 'com_ui_cc_role_system',
};

/**
 * Plural families resolved by i18next from `count` (`_one/_few/_many`); the
 * suffixed keys are listed so the unused-key scan sees them referenced.
 */
export const EXCLUDED_PLURAL_KEYS = [
  'com_ui_cc_excluded_count',
  'com_ui_cc_excluded_count_one',
  'com_ui_cc_summarized_count',
  'com_ui_cc_summarized_count_one',
  'com_ui_cc_excluded_more',
  'com_ui_cc_excluded_more_one',
] as const satisfies readonly TranslationKeys[];

const PREVIEW_LIMIT = 5;

interface ExcludedNoticeProps {
  excluded: TContextExclusionPlan;
  budget: number | null;
  format: ContextCounterFormatter;
}

/**
 * §4 «История не помещается»: one warning line between the bar and the
 * breakdown, driven by the server plan's `count`, not by fill%. The link opens
 * a popover inside the same menu — no route, no page; Esc / outside click /
 * a second press close it and focus returns to the link.
 */
export function ExcludedNotice({ excluded, budget, format }: ExcludedNoticeProps) {
  const localize = useLocalize();
  if (excluded.count <= 0) {
    return null;
  }
  const countKey: TranslationKeys =
    excluded.reason === 'summarized' ? 'com_ui_cc_summarized_count' : 'com_ui_cc_excluded_count';
  const countText = localize(countKey, { count: excluded.count });
  const prePrunePercent =
    excluded.prePruneTokens != null ? format.percent(excluded.prePruneTokens, budget) : null;
  const line =
    prePrunePercent != null
      ? localize('com_ui_cc_excluded_line', { 0: countText, 1: prePrunePercent })
      : countText;
  const previews = excluded.messages.slice(0, PREVIEW_LIMIT);
  const remaining = excluded.count - previews.length;

  return (
    <ExcludedPopover
      line={line}
      countText={countText}
      reason={localize(REASON_KEYS[excluded.reason])}
      previews={previews}
      remaining={remaining}
      format={format}
    />
  );
}

interface ExcludedPopoverProps {
  line: string;
  countText: string;
  reason: string;
  previews: TContextExcludedMessage[];
  remaining: number;
  format: ContextCounterFormatter;
}

function ExcludedPopover({
  line,
  countText,
  reason,
  previews,
  remaining,
  format,
}: ExcludedPopoverProps) {
  const localize = useLocalize();
  const popover = Ariakit.usePopoverStore({ placement: 'bottom-start' });
  /** Explicit final focus: with `unmountOnHide` the content is gone by the
   *  time Ariakit would look for the disclosure, so name the trigger. */
  const linkRef = useRef<HTMLButtonElement>(null);

  return (
    <Ariakit.PopoverProvider store={popover}>
      <div
        className="flex items-start justify-between gap-2 text-xs text-text-warning"
        data-testid="cc-excluded-notice"
      >
        <span className="flex min-w-0 items-start gap-1.5">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{line}</span>
        </span>
        <Ariakit.PopoverDisclosure
          ref={linkRef}
          className={cn(
            'shrink-0 whitespace-nowrap text-xs text-text-secondary underline-offset-2 hover:text-text-primary hover:underline',
            'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
          )}
          data-testid="cc-excluded-link"
        >
          {localize('com_ui_cc_excluded_link')}
        </Ariakit.PopoverDisclosure>
      </div>
      <Ariakit.Popover
        gutter={6}
        unmountOnHide
        finalFocus={linkRef}
        aria-label={localize('com_ui_cc_excluded_title')}
        data-testid="cc-excluded-popover"
        className={cn(
          'z-[210] w-72 rounded-xl border border-border-medium bg-surface-secondary p-3 text-text-primary shadow-lg focus:outline-none',
          'origin-top scale-95 opacity-0 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
          'data-[enter]:scale-100 data-[enter]:opacity-100',
        )}
      >
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <Ariakit.PopoverHeading className="text-sm font-medium text-text-primary">
              {countText}
            </Ariakit.PopoverHeading>
            <Ariakit.PopoverDismiss
              render={<Button type="button" variant="ghost" size="icon" className="size-6" />}
              aria-label={localize('com_ui_cc_close')}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Ariakit.PopoverDismiss>
          </div>
          <Ariakit.PopoverDescription className="text-xs text-text-secondary">
            {reason}
          </Ariakit.PopoverDescription>
          {previews.length > 0 && (
            <ul className="space-y-1" data-testid="cc-excluded-list">
              {previews.map((message) => (
                <li
                  key={message.messageId}
                  className="flex items-baseline justify-between gap-3 text-xs"
                >
                  <span className="min-w-0 truncate text-text-secondary">
                    <span className="font-medium text-text-primary">
                      {localize(ROLE_KEYS[message.role])}
                    </span>
                    {message.preview != null && message.preview !== '' && (
                      <span> · {message.preview}</span>
                    )}
                  </span>
                  {message.tokens != null && (
                    <span
                      className="shrink-0 tabular-nums text-text-tertiary"
                      title={formatContextTokensExact(message.tokens)}
                    >
                      {format.tokens(message.tokens)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {remaining > 0 && (
            <p className="text-xs text-text-tertiary">
              {localize('com_ui_cc_excluded_more', { count: remaining })}
            </p>
          )}
          <p className="text-xs text-text-tertiary">{localize('com_ui_cc_excluded_not_deleted')}</p>
        </div>
      </Ariakit.Popover>
    </Ariakit.PopoverProvider>
  );
}
