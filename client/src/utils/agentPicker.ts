import { isEphemeralAgentId } from 'librechat-data-provider';
import type { Agent } from 'librechat-data-provider';

export type AgentPickerCategoryFilter = 'all' | 'favorites' | string;

export type AgentPickerListItem = {
  agent: Agent;
  isFavorite: boolean;
  isActive: boolean;
};

/** Real persisted agents only — never model specs / CPA composite ids / ephemeral. */
export function isPersistedAgentId(agentId: string | null | undefined): agentId is string {
  return (
    typeof agentId === 'string' && agentId.startsWith('agent_') && !isEphemeralAgentId(agentId)
  );
}

export function isPersistedAgent(agent: Agent | null | undefined): agent is Agent {
  return !!agent && isPersistedAgentId(agent.id) && typeof agent.name === 'string';
}

export function filterAndSortAgentsForPicker({
  agents,
  search,
  category,
  favoriteIds,
  activeAgentId,
}: {
  agents: Agent[];
  search: string;
  category: AgentPickerCategoryFilter;
  favoriteIds: Set<string>;
  activeAgentId?: string | null;
}): AgentPickerListItem[] {
  const q = search.trim().toLowerCase();
  const persisted = agents.filter(isPersistedAgent);

  const filtered = persisted.filter((agent) => {
    if (category === 'favorites' && !favoriteIds.has(agent.id)) {
      return false;
    }
    if (
      category !== 'all' &&
      category !== 'favorites' &&
      (agent.category || 'general') !== category
    ) {
      return false;
    }
    if (!q) {
      return true;
    }
    const haystack =
      `${agent.name || ''} ${agent.description || ''} ${agent.category || ''}`.toLowerCase();
    return haystack.includes(q);
  });

  filtered.sort((a, b) => {
    const aFav = favoriteIds.has(a.id) ? 0 : 1;
    const bFav = favoriteIds.has(b.id) ? 0 : 1;
    if (category !== 'favorites' && aFav !== bFav) {
      return aFav - bFav;
    }
    const aActive = a.id === activeAgentId ? 0 : 1;
    const bActive = b.id === activeAgentId ? 0 : 1;
    if (aActive !== bActive) {
      return aActive - bActive;
    }
    return (a.name || a.id).localeCompare(b.name || b.id);
  });

  return filtered.map((agent) => ({
    agent,
    isFavorite: favoriteIds.has(agent.id),
    isActive: agent.id === activeAgentId,
  }));
}

/** Category chips derived from agents actually in the list (e.g. M894), not empty taxonomy. */
export function categoriesFromAgents(agents: Agent[]): string[] {
  const set = new Set<string>();
  for (const agent of agents) {
    if (!isPersistedAgent(agent)) continue;
    const cat = (agent.category || '').trim();
    if (cat) set.add(cat);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
