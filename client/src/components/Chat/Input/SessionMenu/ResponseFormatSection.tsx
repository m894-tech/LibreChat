import React, { useMemo } from 'react';
import { useRecoilState } from 'recoil';
import type { TConversation } from 'librechat-data-provider';
import {
  endpointSupportsNativeJsonMode,
  normalizeResponseFormat,
  type ResponseFormat,
} from '~/utils/responseFormat';
import ChipScroller from './ChipScroller';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

type ResponseFormatSectionProps = React.HTMLAttributes<HTMLDivElement> & {
  conversation?: TConversation | null;
  index?: number;
  /** Dense sheet: ChipScroller, hide section title. */
  compact?: boolean;
};

const OPTIONS: Array<{ value: ResponseFormat; labelKey: string; disabledReasonKey?: string }> = [
  { value: 'default', labelKey: 'com_ui_response_format_default' },
  { value: 'concise', labelKey: 'com_ui_response_format_concise' },
  { value: 'detailed', labelKey: 'com_ui_response_format_detailed' },
  {
    value: 'json',
    labelKey: 'com_ui_response_format_json',
    disabledReasonKey: 'com_ui_response_format_json_unavailable',
  },
];

const ResponseFormatSection = React.forwardRef<HTMLDivElement, ResponseFormatSectionProps>(
  ({ conversation, index = 0, compact = false, className, ...props }, ref) => {
    const localize = useLocalize();
    const uiKey = store.conversationUiStateKey(conversation?.conversationId, index);
    const [format, setFormat] = useRecoilState(store.responseFormatByIndex(uiKey));
    const jsonSupported = useMemo(
      () =>
        endpointSupportsNativeJsonMode({
          endpoint: conversation?.endpoint,
          endpointType: conversation?.endpointType,
          model: conversation?.model,
        }),
      [conversation?.endpoint, conversation?.endpointType, conversation?.model],
    );

    return (
      <div
        ref={ref}
        {...props}
        className={cn(compact ? 'w-full' : 'w-full rounded-lg p-2', className)}
        data-testid="response-format-section"
      >
        {compact ? null : (
          <div className="mb-1.5 text-xs text-text-secondary">
            {localize('com_ui_response_format')}
          </div>
        )}
        {compact ? (
          <ChipScroller aria-label={localize('com_ui_response_format')}>
            {OPTIONS.map((option) => {
              const disabled = option.value === 'json' && !jsonSupported;
              const active = normalizeResponseFormat(format) === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  title={
                    disabled && option.disabledReasonKey
                      ? localize(
                          option.disabledReasonKey as 'com_ui_response_format_json_unavailable',
                        )
                      : undefined
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (disabled) {
                      return;
                    }
                    setFormat(option.value);
                  }}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    active
                      ? 'border-border-heavy bg-surface-hover text-text-primary'
                      : 'border-border-light text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                    disabled &&
                      'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-text-secondary',
                  )}
                >
                  {localize(option.labelKey as 'com_ui_response_format_default')}
                </button>
              );
            })}
          </ChipScroller>
        ) : (
          <div
            className="flex flex-wrap gap-1"
            role="radiogroup"
            aria-label={localize('com_ui_response_format')}
          >
            {OPTIONS.map((option) => {
              const disabled = option.value === 'json' && !jsonSupported;
              const active = normalizeResponseFormat(format) === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  title={
                    disabled && option.disabledReasonKey
                      ? localize(
                          option.disabledReasonKey as 'com_ui_response_format_json_unavailable',
                        )
                      : undefined
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (disabled) {
                      return;
                    }
                    setFormat(option.value);
                  }}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    active
                      ? 'border-border-heavy bg-surface-hover text-text-primary'
                      : 'border-border-light text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                    disabled &&
                      'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-text-secondary',
                  )}
                >
                  {localize(option.labelKey as 'com_ui_response_format_default')}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  },
);

ResponseFormatSection.displayName = 'ResponseFormatSection';
export default ResponseFormatSection;
