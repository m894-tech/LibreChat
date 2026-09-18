import type { SessionOrchMode } from '~/utils/sessionProfiles';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const TEAM_STEPS = [
  { id: 'plan', labelKey: 'com_ui_session_orch_step_plan' as const },
  { id: 'leaf', labelKey: 'com_ui_session_orch_step_leaf' as const },
  { id: 'accept', labelKey: 'com_ui_session_orch_step_accept' as const },
] as const;

export default function SessionOrchProgress({
  orchMode,
  orchParallel,
}: {
  orchMode: SessionOrchMode;
  orchParallel?: boolean;
}) {
  const localize = useLocalize();

  let status: string;
  switch (orchMode) {
    case 'off':
      status = localize('com_ui_session_orch_progress_off');
      break;
    case 'auto':
      status = localize('com_ui_session_orch_progress_auto');
      break;
    case 'm2':
      status = localize('com_ui_session_orch_progress_m2');
      break;
    case 'm3':
      status = orchParallel
        ? localize('com_ui_session_orch_progress_m3_parallel')
        : localize('com_ui_session_orch_progress_m3');
      break;
    case 'compare':
      status = localize('com_ui_session_orch_progress_compare');
      break;
    case 'team':
      status = localize('com_ui_session_orch_progress_team');
      break;
    default: {
      const _exhaustive: never = orchMode;
      status = String(_exhaustive);
      break;
    }
  }

  if (orchMode !== 'team') {
    return (
      <p className="px-2 pt-1 text-[10px] text-text-secondary" data-testid="session-orch-progress">
        {status}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-2 pt-1" data-testid="session-orch-progress">
      <p className="text-[10px] text-text-secondary">{status}</p>
      <div className="flex flex-wrap gap-1">
        {TEAM_STEPS.map((step) => (
          <span
            key={step.id}
            data-testid={`session-orch-step-${step.id}`}
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
              'border-border-medium text-text-secondary',
            )}
          >
            {localize(step.labelKey)}
          </span>
        ))}
      </div>
    </div>
  );
}
