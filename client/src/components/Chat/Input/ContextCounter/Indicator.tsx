import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import * as Ariakit from '@ariakit/react';
import type { ContextCounterActions, ContextCounterViewModel } from './types';
import { miniIndicatorText, MiniIndicator } from './MiniIndicator';
import { useContextCounterFormatter } from './hooks';
import { contextCounterModeAtom } from './store';
import { ContextCounterMenu } from './Menu';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** Hover pacing shared with the previous indicator: intent delay + travel grace. */
const SHOW_DELAY_MS = 100;
const HIDE_DELAY_MS = 150;

export interface ContextCounterIndicatorProps {
  vm: ContextCounterViewModel;
  actions: ContextCounterActions;
}

/**
 * Composer control: the mini-indicator is the disclosure, the single menu is
 * its popover. Hover opens, click pins, Escape closes (the excluded-history
 * popover first, being the inner dialog), touch works without hover, focus
 * returns to the trigger. The toggle mode lives in a Jotai atom, so closing
 * the menu resets neither it nor the indicator (§3, §9).
 */
export function ContextCounterIndicator({ vm, actions }: ContextCounterIndicatorProps) {
  const localize = useLocalize();
  const format = useContextCounterFormatter();
  const [mode, setMode] = useAtom(contextCounterModeAtom);
  const popover = Ariakit.usePopoverStore({ placement: 'top' });
  const popoverOpen = Ariakit.useStoreState(popover, 'open');
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusOnShow, setFocusOnShow] = useState(true);
  const pinnedRef = useRef(false);
  const pinAtPointerDownRef = useRef(false);
  const conversationId = vm.conversationId ?? '';

  const cancelTimers = useCallback(() => {
    if (showTimerRef.current != null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);
  const openByPointer = useCallback(() => {
    if (pinnedRef.current) {
      return;
    }
    cancelTimers();
    if (popover.getState().open) {
      return;
    }
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = null;
      setFocusOnShow(false);
      popover.show();
    }, SHOW_DELAY_MS);
  }, [cancelTimers, popover]);
  const scheduleHide = useCallback(() => {
    if (pinnedRef.current) {
      return;
    }
    cancelTimers();
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      popover.hide();
    }, HIDE_DELAY_MS);
  }, [cancelTimers, popover]);

  useEffect(() => {
    if (!popoverOpen) {
      pinnedRef.current = false;
    }
  }, [popoverOpen]);
  useEffect(() => cancelTimers, [cancelTimers, conversationId]);

  const mini = miniIndicatorText(vm, format, localize);

  return (
    <>
      <Ariakit.PopoverDisclosure
        ref={disclosureRef}
        store={popover}
        type="button"
        data-testid="context-counter"
        aria-label={localize('com_ui_cc_mini_label', { 0: mini.text })}
        aria-haspopup="dialog"
        onPointerDown={() => {
          pinAtPointerDownRef.current = pinnedRef.current;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'touch') {
            openByPointer();
          }
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'touch') {
            scheduleHide();
          }
        }}
        onClick={(e) => {
          cancelTimers();
          e.preventDefault();
          const wasPinned = e.detail > 0 ? pinAtPointerDownRef.current : pinnedRef.current;
          if (wasPinned) {
            pinnedRef.current = false;
            popover.hide();
            return;
          }
          if (!popover.getState().open) {
            setFocusOnShow(true);
          }
          pinnedRef.current = true;
          popover.show();
        }}
        className={cn(
          'flex h-theme-control items-center justify-center rounded-theme-control-round px-2 transition-colors',
          'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary',
          'duration-300 animate-in fade-in zoom-in-95',
        )}
      >
        <MiniIndicator vm={vm} format={format} />
      </Ariakit.PopoverDisclosure>
      <Ariakit.Popover
        store={popover}
        gutter={8}
        portal
        unmountOnHide
        autoFocusOnShow={focusOnShow}
        finalFocus={disclosureRef}
        aria-label={localize('com_ui_cc_menu_label')}
        onPointerEnter={cancelTimers}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'touch') {
            scheduleHide();
          }
        }}
        className={cn(
          'z-[200] rounded-xl border border-border-medium bg-surface-secondary p-3 text-text-primary shadow-lg focus:outline-none',
          'origin-bottom translate-y-1 scale-95 opacity-0 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
          'data-[enter]:translate-y-0 data-[enter]:scale-100 data-[enter]:opacity-100',
          'data-[leave]:translate-y-1 data-[leave]:scale-95 data-[leave]:opacity-0',
        )}
      >
        <ContextCounterMenu vm={vm} mode={mode} onModeChange={setMode} actions={actions} />
      </Ariakit.Popover>
    </>
  );
}
