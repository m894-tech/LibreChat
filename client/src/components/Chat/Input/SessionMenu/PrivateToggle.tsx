import React, { useCallback } from 'react';
import { Switch } from '@librechat/client';
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

/** Temporary/private chat toggle for SessionSheet. Same atom as TemporaryChat. */
export default function PrivateToggle({ className, index = 0 }: PrivateToggleProps) {
  const localize = useLocalize();
  const [isTemporary, setIsTemporary] = useRecoilState(store.isTemporary);
  const conversation = useRecoilValue(store.conversationByIndex(index));
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(index));
  const hasAccess = useHasAccess({
    permissionType: PermissionTypes.TEMPORARY_CHAT,
    permission: Permissions.USE,
  });

  const locked =
    (Array.isArray(conversation?.messages) && conversation.messages.length >= 1) || isSubmitting;

  const onCheckedChange = useCallback(
    (next: boolean) => {
      if (locked) {
        return;
      }
      setIsTemporary(next);
    },
    [locked, setIsTemporary],
  );

  if (!hasAccess) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border border-border-light bg-surface-secondary px-2.5 py-2',
        locked && 'opacity-90',
        className,
      )}
      data-testid="session-private-toggle"
      title={locked ? localize('com_ui_session_private_locked') : undefined}
    >
      <span className="flex size-5 items-center justify-center rounded-md bg-surface-tertiary text-text-secondary">
        <MessageCircleDashed className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-text-primary">
          {localize('com_ui_session_private')}
        </div>
        <div className="text-[10px] text-text-secondary">
          {locked
            ? localize('com_ui_session_private_locked')
            : localize('com_ui_session_private_hint')}
        </div>
      </div>
      <Switch
        checked={isTemporary}
        onCheckedChange={onCheckedChange}
        disabled={locked}
        aria-label={localize('com_ui_session_private')}
        aria-describedby={locked ? 'session-private-locked-hint' : undefined}
      />
      {locked ? (
        <span id="session-private-locked-hint" className="sr-only">
          {localize('com_ui_session_private_locked')}
        </span>
      ) : null}
    </div>
  );
}
