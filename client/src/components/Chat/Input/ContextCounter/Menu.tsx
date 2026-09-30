import { useState } from 'react';
import type { ContextCounterActions, ContextCounterMode, ContextCounterViewModel } from './types';
import type { TranslationKeys } from '~/hooks';
import type { PanelView } from './model';
import { deriveNextPanel, deriveLastPanel, resolveBottomAction, staleReasonKind } from './model';
import { useContextCounterFormatter } from './hooks';
import { Header, ModeToggle } from './Header';
import { SessionUsage } from './SessionUsage';
import { SegmentRow, InfoRow } from './Rows';
import { ExcludedNotice } from './Excluded';
import { LastCall } from './LastCall';
import { useLocalize } from '~/hooks';
import { FillBar } from './FillBar';
import { Action } from './Action';
import { cn } from '~/utils';

const ROW_KEYS: Record<PanelView['segments'][number]['key'], TranslationKeys> = {
  messages: 'com_ui_cc_row_messages',
  toolCalls: 'com_ui_cc_row_toolCalls',
  systemPrompt: 'com_ui_cc_row_systemPrompt',
  mcpTools: 'com_ui_cc_row_mcpTools',
  attachments: 'com_ui_cc_row_attachments',
  other: 'com_ui_cc_row_other',
};

export interface ContextCounterMenuProps {
  vm: ContextCounterViewModel;
  mode: ContextCounterMode;
  onModeChange: (mode: ContextCounterMode) => void;
  actions: ContextCounterActions;
}

type Localize = (key: TranslationKeys, options?: Record<string, string | number>) => string;

/** §4 status line for the panel on screen; `null` when there is nothing to say. */
function statusMessage(panel: PanelView, localize: Localize): string | null {
  if (panel.mode === 'next') {
    switch (panel.estimateStatus) {
      case 'calculating':
        return panel.available
          ? localize('com_ui_cc_status_line', {
              0: localize('com_ui_cc_status_calculating'),
              1: localize('com_ui_cc_status_stale_recalculating'),
            })
          : localize('com_ui_cc_status_calculating');
      case 'error':
        return localize('com_ui_cc_status_error');
      case 'stale': {
        const kind = staleReasonKind(panel.staleReason);
        if (kind === 'model') {
          return localize('com_ui_cc_model_changed');
        }
        if (kind === 'tools') {
          return localize('com_ui_cc_tools_changed');
        }
        return localize('com_ui_cc_status_stale');
      }
      case 'partial':
        return localize('com_ui_cc_status_line', {
          0: localize('com_ui_cc_status_partial'),
          1: localize('com_ui_cc_status_partial_hint'),
        });
      case 'fresh':
      case 'unavailable':
      case null:
        break;
      default: {
        const exhaustive: never = panel.estimateStatus;
        return exhaustive;
      }
    }
    if (panel.partial) {
      return localize('com_ui_cc_status_line', {
        0: localize('com_ui_cc_status_partial'),
        1: localize('com_ui_cc_status_partial_hint'),
      });
    }
  } else {
    if (panel.compositionMismatch) {
      return localize('com_ui_cc_composition_mismatch');
    }
    if (panel.compositionEstimated) {
      return localize('com_ui_cc_composition_estimated');
    }
    if (panel.available && panel.partial) {
      return localize('com_ui_cc_status_partial');
    }
  }
  if (panel.budgetExhausted) {
    return localize('com_ui_cc_budget_exhausted');
  }
  if (panel.available && panel.budget == null) {
    return localize('com_ui_cc_no_limit');
  }
  return null;
}

/**
 * The single dark context menu (§2). Pure: everything comes from `vm`, the
 * mode and the two callbacks; wiring stream D's stores is one adapter above.
 * Keeps the size, type scale and rhythm of the previous `TokenUsage` popover.
 */
export function ContextCounterMenu({ vm, mode, onModeChange, actions }: ContextCounterMenuProps) {
  const localize = useLocalize();
  const format = useContextCounterFormatter();
  const [hovered, setHovered] = useState<string | null>(null);
  const next = deriveNextPanel(vm);
  const last = deriveLastPanel(vm);
  const panel = mode === 'next' ? next : last;
  const action = resolveBottomAction(vm);
  const status = statusMessage(panel, localize);
  const staleValue =
    panel.mode === 'next' && panel.estimateStatus === 'calculating' && panel.available;
  const toggle = () => onModeChange(mode === 'next' ? 'last' : 'next');
  const rows = panel.compositionKnown
    ? panel.segments.filter((segment) => segment.value > 0 || segment.key === 'messages')
    : [];
  const showCacheRow = panel.mode === 'next' ? panel.available : panel.cacheRead != null;
  const showFreeRow = panel.available && panel.budget != null && !panel.budgetExhausted;
  const rowBudget = panel.budgetExhausted ? null : panel.budget;

  return (
    <div
      className="w-72 space-y-3"
      role="region"
      aria-label={localize('com_ui_cc_title')}
      aria-busy={panel.estimateStatus === 'calculating' || undefined}
      data-testid="cc-menu"
      data-mode={mode}
    >
      <div>
        <div className={cn(staleValue && 'opacity-60')}>
          <Header panel={panel} format={format} />
        </div>
        <div className="mt-1">
          <ModeToggle mode={mode} source={panel.source} onToggle={toggle} />
        </div>
        <FillBar panel={panel} format={format} highlightId={hovered} />
        <p
          role="status"
          aria-live="polite"
          className={status != null ? 'mt-2 text-xs text-text-secondary' : 'sr-only'}
          data-testid="cc-status"
        >
          {status}
        </p>
      </div>

      {panel.mode === 'next' && panel.excluded != null && (
        <ExcludedNotice excluded={panel.excluded} budget={panel.budget} format={format} />
      )}

      {(rows.length > 0 || showCacheRow || showFreeRow) && (
        <div className="space-y-1.5" data-testid="cc-breakdown">
          {rows.map((segment) => (
            <SegmentRow
              key={segment.key}
              id={segment.key}
              label={localize(ROW_KEYS[segment.key])}
              slot={segment.slot}
              value={segment.value}
              budget={rowBudget}
              approximate={panel.compositionEstimated}
              format={format}
              onHoverChange={setHovered}
            />
          ))}
          {showCacheRow && (
            <InfoRow
              id="cache"
              label={localize('com_ui_cc_row_cache')}
              value={panel.cacheRead}
              budget={rowBudget}
              format={format}
            />
          )}
          {panel.cacheWrite != null && panel.cacheWrite > 0 && (
            <InfoRow
              id="cache-write"
              label={localize('com_ui_cc_row_cache_write')}
              value={panel.cacheWrite}
              budget={rowBudget}
              format={format}
            />
          )}
          {showFreeRow && (
            <InfoRow
              id="free"
              label={localize('com_ui_cc_row_free')}
              value={panel.free}
              budget={rowBudget}
              format={format}
            />
          )}
        </div>
      )}

      {vm.isEmptyChat && mode === 'next' && (
        <p className="text-xs text-text-tertiary" data-testid="cc-empty-chat">
          {localize('com_ui_cc_empty_chat')}
        </p>
      )}

      <div className="border-t border-border-light" role="separator" />
      <LastCall
        mode={mode}
        last={last}
        next={next}
        lastOutput={vm.lastCallMeasurement?.output ?? null}
        format={format}
      />

      <div className="border-t border-border-light" role="separator" />
      <SessionUsage usage={vm.sessionUsage} format={format} />

      {action.kind !== 'none' && (
        <>
          <div className="border-t border-border-light" role="separator" />
          <Action action={action} mode={mode} actions={actions} />
        </>
      )}
    </div>
  );
}
