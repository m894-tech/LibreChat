import React, { useMemo, useState, useEffect } from 'react';
import { Bot, ChevronRight } from 'lucide-react';
import {
  loadSessionAgentIds,
  normalizeSessionAgentsConversationId,
  SESSION_AGENTS_CHANGED_EVENT,
  type SessionAgentsChangedDetail,
} from '~/utils/sessionAgents';
import { isPersistedAgentId } from '~/utils/agentPicker';
import AgentPickerDialog from './AgentPickerDialog';
import { useAgentsMapContext } from '~/Providers';
import { cn, renderAgentAvatar } from '~/utils';
import { useLocalize } from '~/hooks';

type AgentPickerButtonProps = React.HTMLAttributes<HTMLButtonElement> & {
  activeAgentId?: string | null;
  conversationId?: string | null;
  index?: number;
};

const AgentPickerButton = React.forwardRef<HTMLButtonElement, AgentPickerButtonProps>(
  ({ activeAgentId, conversationId, index = 0, className, ...props }, ref) => {
    const localize = useLocalize();
    const agentsMap = useAgentsMapContext();
    const [open, setOpen] = useState(false);
    const convoKey = normalizeSessionAgentsConversationId(conversationId);
    const [sessionIds, setSessionIds] = useState<string[]>(() =>
      loadSessionAgentIds(convoKey, index),
    );

    useEffect(() => {
      setSessionIds(loadSessionAgentIds(convoKey, index));
    }, [convoKey, index, open, activeAgentId]);

    useEffect(() => {
      if (typeof window === 'undefined') {
        return;
      }
      const onChanged = (event: Event) => {
        const detail = (event as CustomEvent<SessionAgentsChangedDetail>).detail;
        if (detail?.index != null && detail.index !== index) {
          return;
        }
        if (
          detail?.conversationId != null &&
          normalizeSessionAgentsConversationId(detail.conversationId) !== convoKey
        ) {
          return;
        }
        setSessionIds(loadSessionAgentIds(convoKey, index));
      };
      window.addEventListener(SESSION_AGENTS_CHANGED_EVENT, onChanged as EventListener);
      return () => {
        window.removeEventListener(SESSION_AGENTS_CHANGED_EVENT, onChanged as EventListener);
      };
    }, [convoKey, index]);

    const activeAgent = useMemo(() => {
      if (!isPersistedAgentId(activeAgentId)) {
        return null;
      }
      return agentsMap?.[activeAgentId] ?? null;
    }, [agentsMap, activeAgentId]);

    const label = useMemo(() => {
      if (activeAgent?.name) {
        return activeAgent.name;
      }
      if (isPersistedAgentId(activeAgentId)) {
        return activeAgentId as string;
      }
      const named = sessionIds.map((id) => agentsMap?.[id]?.name || id).filter(Boolean);
      if (named.length === 1) {
        return named[0];
      }
      if (named.length > 1) {
        return localize('com_ui_x_selected', { 0: named.length });
      }
      return localize('com_ui_agent_picker_none');
    }, [activeAgent, activeAgentId, sessionIds, agentsMap, localize]);

    const hasSelection = Boolean(isPersistedAgentId(activeAgentId) || sessionIds.length > 0);

    return (
      <>
        <button
          ref={ref}
          type="button"
          {...props}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
          className={cn(
            'flex w-full cursor-pointer items-center justify-between rounded-lg p-2 hover:bg-surface-hover',
            className,
          )}
          aria-label={localize('com_ui_agent_picker_open')}
          data-testid="agent-picker-button"
        >
          <div className="flex min-w-0 items-center gap-2">
            {activeAgent ? (
              renderAgentAvatar(activeAgent, { size: 'icon', showBorder: false })
            ) : (
              <Bot className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <div className="text-xs text-text-secondary">{localize('com_ui_agent')}</div>
              <div
                className={cn(
                  'truncate text-sm',
                  hasSelection ? 'text-text-primary' : 'text-text-secondary',
                )}
                title={label}
              >
                {label}
              </div>
            </div>
          </div>
          <ChevronRight className="h-3 w-3 flex-shrink-0 text-text-secondary" aria-hidden="true" />
        </button>
        <AgentPickerDialog
          open={open}
          onOpenChange={setOpen}
          activeAgentId={isPersistedAgentId(activeAgentId) ? activeAgentId : null}
          conversationId={convoKey}
          index={index}
        />
      </>
    );
  },
);

AgentPickerButton.displayName = 'AgentPickerButton';
export default AgentPickerButton;
