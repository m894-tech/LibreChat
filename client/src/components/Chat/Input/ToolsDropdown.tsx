import React, { useLayoutEffect } from 'react';
import { Settings2 } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { useRecoilState, useSetRecoilState } from 'recoil';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import { useNativeModelControls } from '~/hooks/Input/useNativeModelControls';
import SessionSheet from '~/components/Chat/Input/SessionMenu/SessionSheet';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize, useHasAccess } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

interface ToolsDropdownProps {
  disabled?: boolean;
  conversation?: TConversation | null;
  /** Kept for BadgeRow compatibility. Modes live in SessionSheet. */
  modelControlsOnly?: boolean;
  index?: number;
  isSubmitting?: boolean;
}

const ToolsDropdown = ({
  disabled,
  conversation,
  modelControlsOnly: _modelControlsOnly = false,
  index = 0,
  isSubmitting = false,
}: ToolsDropdownProps) => {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const sessionMenuEnabled = startupConfig?.interface?.sessionMenu !== false;
  const modelControls = useNativeModelControls(conversation);
  const uiKey = store.conversationUiStateKey(conversation?.conversationId, index);
  const setNativeKnobs = useSetRecoilState(store.nativeKnobsByIndex(uiKey));

  useLayoutEffect(() => {
    setNativeKnobs(modelControls.payload ?? null);
  }, [modelControls.payload, setNativeKnobs]);

  const canUseAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.USE,
  });

  const [sheetOpen, setSheetOpen] = useRecoilState(store.sessionSheetOpenByIndex(index));
  const isDisabled = disabled ?? false;

  if (!sessionMenuEnabled) {
    return null;
  }

  return (
    <>
      <TooltipAnchor
        description={localize('com_ui_session_menu')}
        disabled={isDisabled}
        render={
          <button
            type="button"
            disabled={isDisabled}
            id="tools-dropdown-button"
            data-testid="session-sheet-trigger"
            aria-label={localize('com_ui_session_menu')}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className={cn(
              'focus-visible:ring-primary flex size-9 items-center justify-center rounded-full p-1 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-opacity-50',
            )}
            onClick={() => setSheetOpen(true)}
          >
            <Settings2 className="size-5" aria-hidden="true" />
          </button>
        }
      />
      <SessionSheet
        conversation={conversation}
        index={index}
        isSubmitting={isSubmitting}
        showAgentPicker={canUseAgents}
        modelControls={modelControls}
      />
    </>
  );
};

export default React.memo(ToolsDropdown);
