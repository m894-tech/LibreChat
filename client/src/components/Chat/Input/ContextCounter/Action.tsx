import { useId } from 'react';
import { Button, Spinner } from '@librechat/client';
import { RefreshCw, ScrollText } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ContextCounterActions, ContextCounterMode } from './types';
import type { BottomAction, DisabledReason } from './model';
import type { TranslationKeys } from '~/hooks';
import { useLocalize } from '~/hooks';

const DISABLED_KEYS: Record<DisabledReason, TranslationKeys> = {
  sending: 'com_ui_cc_disabled_sending',
  compressing: 'com_ui_cc_disabled_compressing',
  model_switching: 'com_ui_cc_disabled_model_switching',
  calculating: 'com_ui_cc_disabled_calculating',
  estimate_unavailable: 'com_ui_cc_disabled_estimate_unavailable',
};

interface ActionProps {
  action: BottomAction;
  mode: ContextCounterMode;
  actions: ContextCounterActions;
}

/**
 * §3 item 7 — exactly one bottom control. Streaming shows a waiting status and
 * no button; a disabled button carries its short reason (§8) instead of
 * queueing silently. «Сжать» always targets the next request, hence the
 * longer label while the last call is on screen.
 */
export function Action({ action, mode, actions }: ActionProps) {
  const localize = useLocalize();
  const describedById = useId();

  switch (action.kind) {
    case 'none':
      return null;
    case 'waiting':
      return (
        <p
          role="status"
          className="flex items-center justify-center gap-2 text-xs text-text-secondary"
          data-testid="cc-action-waiting"
        >
          <Spinner className="size-3.5" />
          {localize('com_ui_cc_status_waiting')}
        </p>
      );
    case 'recalculate': {
      const reason = action.disabledReason;
      return (
        <ActionButton
          testId="cc-action-recalculate"
          label={localize(action.retry ? 'com_ui_cc_action_retry' : 'com_ui_cc_action_recalculate')}
          icon={<RefreshCw className="size-4" aria-hidden="true" />}
          onClick={actions.recalculate}
          disabledReason={reason != null ? localize(DISABLED_KEYS[reason]) : null}
          describedById={describedById}
        />
      );
    }
    case 'compress': {
      const reason = action.disabledReason;
      return (
        <ActionButton
          testId="cc-action-compress"
          label={localize(
            mode === 'last' ? 'com_ui_cc_action_compress_before_next' : 'com_ui_cc_action_compress',
          )}
          icon={<ScrollText className="size-4" aria-hidden="true" />}
          onClick={actions.compress}
          disabledReason={reason != null ? localize(DISABLED_KEYS[reason]) : null}
          description={localize('com_ui_cc_action_compress_note')}
          describedById={describedById}
        />
      );
    }
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

interface ActionButtonProps {
  testId: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabledReason: string | null;
  description?: string;
  describedById: string;
}

function ActionButton({
  testId,
  label,
  icon,
  onClick,
  disabledReason,
  description,
  describedById,
}: ActionButtonProps) {
  const hint = disabledReason ?? description ?? null;
  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="outline"
        onClick={onClick}
        disabled={disabledReason != null}
        aria-describedby={hint != null ? describedById : undefined}
        className="h-8 w-full justify-center gap-2 text-sm"
        data-testid={testId}
      >
        {icon}
        {label}
      </Button>
      {hint != null && (
        <p
          id={describedById}
          className={disabledReason != null ? 'text-center text-xs text-text-secondary' : 'sr-only'}
          data-testid={disabledReason != null ? 'cc-action-disabled-reason' : undefined}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
