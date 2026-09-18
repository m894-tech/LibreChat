import React, { useCallback, useId } from 'react';
import { TooltipAnchor } from '@librechat/client';
import { MessageCircleDashed } from 'lucide-react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

type PrivateToggleProps = {
  className?: string;
  index?: number;
};

/**
 * Dense v5.1: Private is a composer icon beside TokenUsage — not a Session-sheet
 * section and not a second chip next to SessionSummaryPill. Same SoT as
 * TemporaryChat: store.isTemporary.
 */
export default function PrivateToggle({ className, index = 0 }: PrivateToggleProps) {
  const localize = useLocalize();
  const hintId = useId();
  const [isTemporary, setIsTemporary] = useRecoilState(store.isTemporary);
  const conversation = useRecoilValue(store.conversationByIndex(index));
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(index));
  const hasAccess = useHasAccess({
    permissionType: PermissionTypes.TEMPORARY_CHAT,
    permission: Permissions.USE,
  });

  const locked =
    (Array.isArray(conversation?.messages) && conversation.messages.length >= 1) || isSubmitting;

  const onToggle = useCallback(() => {
    if (locked) {
      return;
    }
    setIsTemporary((previous) => !previous);
  }, [locked, setIsTemporary]);

  if (!hasAccess) {
    return null;
  }

  const tooltip = locked
    ? localize('com_ui_session_private_locked')
    : isTemporary
      ? localize('com_ui_session_private_hint')
      : localize('com_ui_session_private');

  return (
    <TooltipAnchor
      description={tooltip}
      render={
        <button
          type="button"
          data-testid="session-private-toggle"
          aria-label={localize('com_ui_session_private')}
          aria-pressed={isTemporary}
          aria-disabled={locked || undefined}
          aria-describedby={locked ? hintId : undefined}
          onClick={onToggle}
          className={cn(
            'focus-visible:ring-primary flex size-theme-control items-center justify-center rounded-[9px] border p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-opacity-50',
            locked && 'cursor-not-allowed opacity-60',
            isTemporary
              ? 'border-violet-400/60 bg-violet-500/15 text-violet-200'
              : 'border-border-light bg-surface-secondary text-text-secondary hover:border-border-medium hover:text-text-primary',
            className,
          )}
        >
          <MessageCircleDashed className="size-4" aria-hidden="true" />
          {locked ? (
            <span id={hintId} className="sr-only">
              {localize('com_ui_session_private_locked')}
            </span>
          ) : null}
        </button>
      }
    />
  );
}
