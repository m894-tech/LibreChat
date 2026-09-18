import React, { useCallback } from 'react';
import { Plus } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import { TooltipAnchor } from '@librechat/client';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { saveSessionProfile, SESSION_PROFILE_NEW_CONVO } from '~/utils/sessionProfiles';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache, cn } from '~/utils';
import store from '~/store';

type NewConversationButtonProps = {
  className?: string;
  disabled?: boolean;
  index?: number;
};

/** Parallel new conversation — not a session setting. Far-right dashed control. */
export default function NewConversationButton({
  className,
  disabled = false,
  index = 0,
}: NewConversationButtonProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo(index);
  const conversation = useRecoilValue(store.conversationByIndex(index));

  const onClick = useCallback<React.MouseEventHandler<HTMLButtonElement>>(
    (e) => {
      if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
        window.open('/c/new', '_blank');
        return;
      }
      clearMessagesCache(queryClient, conversation?.conversationId);
      queryClient.invalidateQueries([QueryKeys.messages]);
      saveSessionProfile({ orchMode: 'off' }, SESSION_PROFILE_NEW_CONVO);
      newConversation();
    },
    [conversation?.conversationId, newConversation, queryClient],
  );

  return (
    <TooltipAnchor
      description={localize('com_ui_new_chat')}
      render={
        <button
          type="button"
          data-testid="session-new-conversation"
          aria-label={localize('com_ui_new_chat')}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'flex size-[30px] shrink-0 items-center justify-center rounded-[9px] border border-dashed border-border-medium bg-surface-secondary text-text-primary hover:bg-surface-hover disabled:opacity-50',
            className,
          )}
        >
          <Plus className="size-4" aria-hidden="true" strokeWidth={2.5} />
        </button>
      }
    />
  );
}
