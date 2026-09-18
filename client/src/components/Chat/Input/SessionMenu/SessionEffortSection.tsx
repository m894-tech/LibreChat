import React, { useCallback } from 'react';
import { AnthropicEffort } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

type SessionEffortLevel = 'low' | 'mid' | 'high';

type EffortOption = {
  id: SessionEffortLevel;
  labelKey:
    | 'com_ui_session_effort_low'
    | 'com_ui_session_effort_mid'
    | 'com_ui_session_effort_high';
  value: AnthropicEffort;
};

const EFFORT_OPTIONS: EffortOption[] = [
  { id: 'low', labelKey: 'com_ui_session_effort_low', value: AnthropicEffort.low },
  { id: 'mid', labelKey: 'com_ui_session_effort_mid', value: AnthropicEffort.medium },
  { id: 'high', labelKey: 'com_ui_session_effort_high', value: AnthropicEffort.high },
];

type SessionEffortSectionProps = {
  conversation?: TConversation | null;
  index?: number;
  className?: string;
};

function normalizeEffort(value: unknown): SessionEffortLevel {
  if (value === AnthropicEffort.low || value === 'low') {
    return 'low';
  }
  if (value === AnthropicEffort.high || value === 'high' || value === 'xhigh' || value === 'max') {
    return 'high';
  }
  return 'mid';
}

/**
 * Dense v5.1: EFFORT Low/Mid/High lives only in sheet «Сейчас» under the model
 * chip — not as a full-width composer segment, and not via native-knobs effort
 * groups. Single SoT: conversation.effort.
 */
export default function SessionEffortSection({
  conversation,
  index = 0,
  className,
}: SessionEffortSectionProps) {
  const localize = useLocalize();
  const { setConversation } = store.useSetConversationAtom(index);
  const active = normalizeEffort(conversation?.effort);

  const apply = useCallback(
    (level: SessionEffortLevel) => {
      const option = EFFORT_OPTIONS.find((item) => item.id === level);
      if (!option || !conversation) {
        return;
      }
      setConversation({
        ...conversation,
        effort: option.value,
      });
    },
    [conversation, setConversation],
  );

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5 px-0.5', className)}
      data-testid="session-effort"
    >
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] text-text-secondary">
        {localize('com_ui_session_effort')}
      </span>
      <div
        className="flex flex-wrap gap-1"
        role="radiogroup"
        aria-label={localize('com_ui_session_effort')}
      >
        {EFFORT_OPTIONS.map((option) => {
          const selected = active === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`session-effort-${option.id}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                apply(option.id);
              }}
              className={cn(
                'rounded-md border px-2 py-0.5 text-[11px] leading-snug',
                selected
                  ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                  : 'border-border-light bg-surface-tertiary text-text-secondary hover:border-border-medium hover:text-text-primary',
              )}
            >
              {localize(option.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
