import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Star, X } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { OGDialog, OGDialogContent, OGDialogHeader, OGDialogTitle } from '@librechat/client';
import type { Agent } from 'librechat-data-provider';
import {
  SESSION_AGENTS_CHANGED_EVENT,
  ensureAgentInSession,
  loadSessionAgentIds,
  normalizeSessionAgentsConversationId,
  removeAgentFromSession,
  saveSessionAgentIds,
  type SessionAgentsChangedDetail,
} from '~/utils/sessionAgents';
import {
  categoriesFromAgents,
  filterAndSortAgentsForPicker,
  isPersistedAgent,
  isPersistedAgentId,
  type AgentPickerCategoryFilter,
} from '~/utils/agentPicker';
import { useLocalize, useFavorites, useSelectAgent } from '~/hooks';
import { useAgentsMapContext } from '~/Providers';
import { cn, renderAgentAvatar } from '~/utils';

type AgentPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeAgentId?: string | null;
  conversationId?: string | null;
  index?: number;
};

const ROW_ESTIMATE = 52;
const VIRTUALIZE_THRESHOLD = 24;

export default function AgentPickerDialog({
  open,
  onOpenChange,
  activeAgentId,
  conversationId,
  index = 0,
}: AgentPickerDialogProps) {
  const localize = useLocalize();
  const { onSelect, onClear } = useSelectAgent();
  const agentsMap = useAgentsMapContext();
  const { favorites, toggleFavoriteAgent } = useFavorites();
  const listRef = useRef<HTMLDivElement>(null);
  const convoKey = normalizeSessionAgentsConversationId(conversationId);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<AgentPickerCategoryFilter>('all');
  const [sessionIds, setSessionIds] = useState<string[]>(() =>
    loadSessionAgentIds(convoKey, index),
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setSessionIds(loadSessionAgentIds(convoKey, index));
  }, [open, convoKey, index]);

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

  const agents = useMemo(
    () => (Object.values(agentsMap ?? {}) as Agent[]).filter(isPersistedAgent),
    [agentsMap],
  );
  const isLoading = agentsMap == null;
  const sessionIdSet = useMemo(() => new Set(sessionIds), [sessionIds]);

  const favoriteIds = useMemo(
    () => new Set((favorites || []).map((f) => f.agentId).filter(Boolean) as string[]),
    [favorites],
  );

  const items = useMemo(
    () =>
      filterAndSortAgentsForPicker({
        agents,
        search,
        category,
        favoriteIds,
        activeAgentId,
      }),
    [agents, search, category, favoriteIds, activeAgentId],
  );

  const sessionAgents = useMemo(
    () => sessionIds.map((id) => agentsMap?.[id]).filter(isPersistedAgent),
    [sessionIds, agentsMap],
  );

  const shouldVirtualize = items.length >= VIRTUALIZE_THRESHOLD;

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: useCallback(() => ROW_ESTIMATE, []),
    overscan: 8,
    enabled: open && shouldVirtualize,
    getItemKey: useCallback((index: number) => items[index]?.agent.id ?? index, [items]),
  });

  const categoryChips = useMemo(() => {
    const chips: Array<{ value: AgentPickerCategoryFilter; label: string }> = [
      { value: 'all', label: localize('com_ui_all') },
      { value: 'favorites', label: localize('com_ui_favorites') },
    ];
    for (const cat of categoriesFromAgents(agents)) {
      chips.push({ value: cat, label: cat });
    }
    return chips;
  }, [agents, localize]);

  const persistSession = useCallback(
    (next: string[]) => {
      setSessionIds(next);
      saveSessionAgentIds(next, convoKey, index);
    },
    [convoKey, index],
  );

  const handleSelect = useCallback(
    async (agentId: string) => {
      if (!isPersistedAgentId(agentId)) {
        return;
      }
      const next = ensureAgentInSession(sessionIds, agentId);
      persistSession(next);
      await onSelect(agentId);
      onOpenChange(false);
    },
    [onSelect, onOpenChange, persistSession, sessionIds],
  );

  const handleToggleSession = useCallback(
    async (agentId: string, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (sessionIdSet.has(agentId)) {
        const next = removeAgentFromSession(sessionIds, agentId);
        persistSession(next);
        if (activeAgentId === agentId) {
          if (next[0]) {
            await onSelect(next[0]);
          } else {
            await onClear();
          }
        }
        return;
      }
      persistSession(ensureAgentInSession(sessionIds, agentId));
    },
    [sessionIdSet, sessionIds, persistSession, activeAgentId, onSelect, onClear],
  );

  const handleRemoveFromSession = useCallback(
    async (agentId: string) => {
      const next = removeAgentFromSession(sessionIds, agentId);
      persistSession(next);
      if (activeAgentId === agentId) {
        if (next[0]) {
          await onSelect(next[0]);
        } else {
          await onClear();
        }
      }
    },
    [sessionIds, persistSession, activeAgentId, onSelect, onClear],
  );

  const handleClear = useCallback(async () => {
    persistSession([]);
    await onClear();
    onOpenChange(false);
  }, [onClear, onOpenChange, persistSession]);

  const renderRow = (item: (typeof items)[number]) => {
    const { agent, isFavorite, isActive } = item;
    const inSession = sessionIdSet.has(agent.id);
    return (
      <div
        key={agent.id}
        className={cn(
          'group flex w-full items-center gap-2 rounded-lg px-2 py-1.5',
          isActive ? 'bg-surface-hover' : 'hover:bg-surface-hover',
        )}
      >
        <button
          type="button"
          role="option"
          aria-selected={isActive}
          title={agent.name || agent.id}
          onClick={() => handleSelect(agent.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <div className="flex-shrink-0">
            {renderAgentAvatar(agent, { size: 'icon', showBorder: false })}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-text-primary">{agent.name || agent.id}</div>
            {agent.description ? (
              <div className="truncate text-xs text-text-secondary">{agent.description}</div>
            ) : null}
          </div>
          {isActive ? (
            <span className="flex-shrink-0 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
              {localize('com_ui_active')}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          title={
            inSession
              ? localize('com_ui_agent_picker_remove_from_session')
              : localize('com_ui_agent_picker_add_to_session')
          }
          aria-label={
            inSession
              ? localize('com_ui_agent_picker_remove_from_session')
              : localize('com_ui_agent_picker_add_to_session')
          }
          aria-pressed={inSession}
          onClick={(e) => handleToggleSession(agent.id, e)}
          className={cn(
            'rounded px-1.5 py-1 text-[10px] font-medium uppercase tracking-wide',
            inSession
              ? 'bg-surface-secondary text-text-primary'
              : 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary',
          )}
        >
          {inSession ? localize('com_ui_agent_picker_in_session') : localize('com_ui_add')}
        </button>
        <button
          type="button"
          title={
            isFavorite
              ? localize('com_ui_agent_picker_unfavorite')
              : localize('com_ui_agent_picker_favorite')
          }
          aria-label={
            isFavorite
              ? localize('com_ui_agent_picker_unfavorite')
              : localize('com_ui_agent_picker_favorite')
          }
          aria-pressed={isFavorite}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFavoriteAgent(agent.id);
          }}
          className={cn(
            'rounded p-1 text-text-secondary hover:bg-surface-secondary hover:text-text-primary',
            isFavorite && 'text-amber-500 hover:text-amber-400',
          )}
        >
          <Star className="h-4 w-4" fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>
    );
  };

  const virtualRows = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];
  const totalSize = shouldVirtualize ? rowVirtualizer.getTotalSize() : 0;
  const useVirtualRows = shouldVirtualize && virtualRows.length > 0;

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        className="flex w-[min(92vw,360px)] max-w-[360px] flex-col gap-0 overflow-hidden p-0"
        showCloseButton={true}
      >
        <OGDialogHeader className="border-b border-border-light px-3 py-2.5 text-left">
          <div className="flex items-center justify-between gap-2 pr-6">
            <OGDialogTitle className="text-sm font-medium text-text-primary">
              {localize('com_ui_agent_picker_title')}
            </OGDialogTitle>
            {activeAgentId || sessionIds.length > 0 ? (
              <button
                type="button"
                className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                onClick={() => {
                  void handleClear();
                }}
                data-testid="agent-picker-clear"
              >
                {localize('com_ui_agent_picker_clear')}
              </button>
            ) : null}
          </div>
        </OGDialogHeader>

        {sessionAgents.length > 0 ? (
          <div
            className="flex flex-wrap gap-1 border-b border-border-light px-3 py-2"
            data-testid="agent-picker-session-roster"
          >
            <div className="w-full text-[10px] uppercase tracking-wide text-text-secondary">
              {localize('com_ui_agent_picker_session')}
            </div>
            {sessionAgents.map((agent) => {
              const isActive = agent.id === activeAgentId;
              return (
                <div
                  key={agent.id}
                  className={cn(
                    'flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs',
                    isActive
                      ? 'border-border-heavy bg-surface-hover text-text-primary'
                      : 'border-border-light text-text-secondary',
                  )}
                >
                  <button
                    type="button"
                    className="max-w-[140px] truncate"
                    title={agent.name || agent.id}
                    onClick={() => {
                      void handleSelect(agent.id);
                    }}
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
                      void handleRemoveFromSession(agent.id);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 border-b border-border-light px-3 py-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={localize('com_ui_agent_picker_search')}
            aria-label={localize('com_ui_agent_picker_search')}
            className="w-full rounded-lg border border-border-light bg-surface-primary px-2.5 py-1.5 text-sm text-text-primary outline-none placeholder:text-text-secondary focus:border-border-heavy"
          />
          <div
            className="flex flex-wrap gap-1"
            role="tablist"
            aria-label={localize('com_ui_agent_picker_categories')}
          >
            {categoryChips.map((chip) => {
              const active = category === chip.value;
              return (
                <button
                  key={chip.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCategory(chip.value)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    active
                      ? 'border-border-heavy bg-surface-hover text-text-primary'
                      : 'border-border-light text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                  )}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          ref={listRef}
          className="h-[min(50vh,360px)] overflow-y-auto px-1 py-1"
          role="listbox"
          aria-label={localize('com_ui_agent_picker_title')}
          data-testid="agent-picker-list"
          data-virtualized={shouldVirtualize ? 'true' : 'false'}
        >
          {isLoading && (
            <div className="px-3 py-6 text-center text-sm text-text-secondary">
              {localize('com_ui_loading')}
            </div>
          )}
          {!isLoading && items.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-text-secondary">
              {localize('com_ui_agent_picker_empty')}
            </div>
          )}
          {!isLoading && !useVirtualRows && items.map((item) => renderRow(item))}
          {!isLoading && useVirtualRows && (
            <div
              style={{ height: totalSize, width: '100%', position: 'relative' }}
              data-testid="agent-picker-virtual-spacer"
            >
              {virtualRows.map((virtualRow) => {
                const item = items[virtualRow.index];
                if (!item) {
                  return null;
                }
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {renderRow(item)}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
