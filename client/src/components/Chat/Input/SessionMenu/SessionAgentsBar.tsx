import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { PermissionTypes, Permissions } from 'librechat-data-provider';
import type { Agent } from 'librechat-data-provider';
import {
  SESSION_AGENTS_CHANGED_EVENT,
  ensureAgentInSession,
  loadSessionAgentIds,
  normalizeSessionAgentsConversationId,
  removeAgentFromSession,
  saveSessionAgentIds,
  sessionAgentsStorageKey,
  type SessionAgentsChangedDetail,
} from '~/utils/sessionAgents';
import { useHasAccess, useLocalize, useSelectAgent } from '~/hooks';
import { isPersistedAgentId } from '~/utils/agentPicker';
import { isM894OrchAgentId } from '~/utils/sessionOrch';
import { useAgentsMapContext } from '~/Providers';
import { cn } from '~/utils';

type SessionAgentsBarProps = {
  activeAgentId?: string | null;
  conversationId?: string | null;
  index?: number;
  className?: string;
};

/**
 * Compact always-visible quick-switch strip for the local session agent roster.
 * Conversation still has a single agent_id; extras are localStorage pins.
 */
export default function SessionAgentsBar({
  activeAgentId,
  conversationId,
  index = 0,
  className,
}: SessionAgentsBarProps) {
  const localize = useLocalize();
  const agentsMap = useAgentsMapContext();
  const { onSelect, onClear } = useSelectAgent();
  const canUseAgents = useHasAccess({
    permissionType: PermissionTypes.AGENTS,
    permission: Permissions.USE,
  });
  const convoKey = normalizeSessionAgentsConversationId(conversationId);

  const [sessionIds, setSessionIds] = useState<string[]>(() =>
    loadSessionAgentIds(convoKey, index),
  );

  const refresh = useCallback(() => {
    setSessionIds(loadSessionAgentIds(convoKey, index));
  }, [convoKey, index]);

  useEffect(() => {
    refresh();
  }, [refresh, activeAgentId]);

  useEffect(() => {
    const stripped = sessionIds.filter((id) => !isM894OrchAgentId(id));
    if (stripped.length !== sessionIds.length) {
      saveSessionAgentIds(stripped, convoKey, index);
      setSessionIds(stripped);
    }
  }, [sessionIds, convoKey, index]);

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
      refresh();
    };
    const onStorage = (event: StorageEvent) => {
      const key = sessionAgentsStorageKey(convoKey, index);
      if (event.key === key || event.key === `session_agents__${index}`) {
        refresh();
      }
    };
    window.addEventListener(SESSION_AGENTS_CHANGED_EVENT, onChanged as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(SESSION_AGENTS_CHANGED_EVENT, onChanged as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [convoKey, index, refresh]);

  const sessionAgents = useMemo(() => {
    return sessionIds
      .filter((id) => !isM894OrchAgentId(id))
      .map((id) => agentsMap?.[id])
      .filter((agent): agent is Agent => Boolean(agent?.id));
  }, [sessionIds, agentsMap]);

  const persist = useCallback(
    (next: string[]) => {
      saveSessionAgentIds(next, convoKey, index);
      setSessionIds(next.filter((id) => isPersistedAgentId(id)));
    },
    [convoKey, index],
  );

  const handleSelect = useCallback(
    async (agentId: string) => {
      if (!isPersistedAgentId(agentId)) {
        return;
      }
      persist(ensureAgentInSession(sessionIds, agentId));
      await onSelect(agentId);
    },
    [onSelect, persist, sessionIds],
  );

  const handleRemove = useCallback(
    async (agentId: string) => {
      const next = removeAgentFromSession(sessionIds, agentId);
      persist(next);
      if (activeAgentId === agentId) {
        if (next[0]) {
          await onSelect(next[0]);
        } else {
          await onClear();
        }
      }
    },
    [sessionIds, persist, activeAgentId, onSelect, onClear],
  );

  if (!canUseAgents || sessionAgents.length === 0) {
    return null;
  }

  return (
    <div
      className={cn('flex w-full flex-wrap items-center gap-1 px-2 pb-1', className)}
      data-testid="session-agents-bar"
      aria-label={localize('com_ui_agent_picker_session')}
    >
      <span className="mr-1 text-[10px] uppercase tracking-wide text-text-secondary">
        {localize('com_ui_session_agents_bar')}
      </span>
      {sessionAgents.map((agent) => {
        const isActive = agent.id === activeAgentId;
        return (
          <div
            key={agent.id}
            className={cn(
              'flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
              isActive
                ? 'border-border-heavy bg-surface-hover text-text-primary'
                : 'border-border-light text-text-secondary hover:border-border-heavy hover:text-text-primary',
            )}
          >
            <button
              type="button"
              className="max-w-[140px] truncate"
              title={agent.name || agent.id}
              onClick={() => {
                void handleSelect(agent.id);
              }}
              data-testid={`session-agent-chip-${agent.id}`}
            >
              {agent.name || agent.id}
            </button>
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-surface-secondary hover:text-text-primary"
              aria-label={localize('com_ui_agent_picker_remove_from_session')}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleRemove(agent.id);
              }}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
