import React, { useCallback, useState } from 'react';
import { useRecoilState } from 'recoil';
import { ChevronLeft, X } from 'lucide-react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogHeader,
  OGDialogTitle,
  useMediaQuery,
} from '@librechat/client';
import type { TConversation } from 'librechat-data-provider';
import type { NativeModelControls } from '~/hooks/Input/useNativeModelControls';
import SessionPanel, { type SessionPanelView } from './SessionPanel';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

type SessionSheetProps = {
  conversation?: TConversation | null;
  index?: number;
  isSubmitting?: boolean;
  showAgentPicker?: boolean;
  modelControls?: NativeModelControls | null;
};

/**
 * Dense Session chrome — same panel tree at every breakpoint.
 * Small screens: bottom sheet. Desktop: composer-anchored panel (no separate toolbar IA).
 */
export default function SessionSheet({
  conversation,
  index = 0,
  isSubmitting: _isSubmitting = false,
  showAgentPicker = true,
  modelControls = null,
}: SessionSheetProps) {
  const localize = useLocalize();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [open, setOpen] = useRecoilState(store.sessionSheetOpenByIndex(index));
  const [view, setView] = useState<SessionPanelView>('main');

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) {
        setView('main');
      }
    },
    [setOpen],
  );

  let title = localize('com_ui_session_sheet_title');
  if (view === 'mcp') {
    title = localize('com_ui_mcp_servers');
  } else if (view === 'skills') {
    title = localize('com_ui_skills');
  } else if (view === 'automations') {
    title = localize('com_ui_session_automations');
  } else if (view === 'context') {
    title = localize('com_ui_context_sources');
  }

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        showCloseButton={false}
        className={cn(
          'flex max-h-[50vh] flex-col gap-0 overflow-hidden border border-border-light bg-surface-primary p-0 shadow-lg',
          isMobile
            ? 'fixed inset-x-0 bottom-0 top-auto w-full max-w-full translate-x-0 translate-y-0 rounded-t-2xl'
            : 'fixed bottom-[5.5rem] left-1/2 top-auto w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 translate-y-0 rounded-2xl sm:bottom-28',
        )}
        data-testid="session-sheet"
        data-presentation={isMobile ? 'sheet' : 'panel'}
      >
        {isMobile ? (
          <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-border-medium" aria-hidden="true" />
        ) : null}
        <OGDialogHeader className="flex flex-row items-center gap-2 space-y-0 border-b border-border-light px-3 py-2 text-left">
          {view !== 'main' ? (
            <button
              type="button"
              aria-label={localize('com_ui_back')}
              onClick={() => setView('main')}
              className="rounded-md p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
          ) : (
            <span className="w-6" />
          )}
          <OGDialogTitle className="flex-1 text-center text-sm font-semibold">
            {title}
          </OGDialogTitle>
          <button
            type="button"
            aria-label={localize('com_ui_close')}
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </OGDialogHeader>

        <SessionPanel
          conversation={conversation}
          index={index}
          showAgentPicker={showAgentPicker}
          modelControls={modelControls}
          view={view}
          onViewChange={setView}
        />
      </OGDialogContent>
    </OGDialog>
  );
}
