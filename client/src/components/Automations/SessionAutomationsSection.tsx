import { useNavigate } from 'react-router-dom';
import { Timer, ChevronRight } from 'lucide-react';
import { Constants } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

/**
 * Client-only stub: Automations server is optional for Session chrome MVP.
 * Navigates to routes that may 404 until Automations is wired separately.
 */
export default function SessionAutomationsSection({
  conversationId,
}: {
  conversationId?: string | null;
}) {
  const navigate = useNavigate();
  const localize = useLocalize();
  const valid = !!conversationId && conversationId !== Constants.NEW_CONVO;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
        {localize('com_ui_session_automations')}
      </div>
      <button
        type="button"
        disabled={!valid}
        onClick={() =>
          navigate(`/automations/new?conv=${encodeURIComponent(conversationId || '')}`)
        }
        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-40"
      >
        <span className="flex items-center gap-2">
          <Timer className="icon-md" />
          {localize('com_ui_session_automations')}
        </span>
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => navigate('/automations')}
        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
      >
        <span>{localize('com_ui_session_automations')}</span>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
