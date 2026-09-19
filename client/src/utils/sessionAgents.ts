/** Session roster of agents. One remains conversation.agent_id; extras are local quick-switch. */

import { isAgentsEndpoint, isEphemeralAgentId } from 'librechat-data-provider';
import { isPersistedAgentId } from './agentPicker';

/** Legacy key: session_agents__${index} (global per pane). */
const LEGACY_INDEX_PREFIX = 'session_agents__';
/** Per-conversation key: session_agents_convo__${conversationId} */
const CONVO_PREFIX = 'session_agents_convo__';

export const SESSION_AGENTS_NEW_CONVO = 'new';
export const SESSION_AGENTS_CHANGED_EVENT = 'session-agents-changed';

export type SessionAgentsChangedDetail = {
  conversationId: string;
  index: number;
  ids: string[];
};

export function normalizeSessionAgentsConversationId(conversationId?: string | null): string {
  if (conversationId == null || conversationId === '' || conversationId === 'search') {
    return SESSION_AGENTS_NEW_CONVO;
  }
  return conversationId;
}

export function sessionAgentsStorageKey(conversationId?: string | null, index = 0): string {
  const id = normalizeSessionAgentsConversationId(conversationId);
  if (index && index !== 0) {
    return `${CONVO_PREFIX}${id}__i${index}`;
  }
  return `${CONVO_PREFIX}${id}`;
}

function readIds(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => isPersistedAgentId(id));
  } catch {
    return [];
  }
}

/**
 * Load roster for one conversation.
 * Legacy `session_agents__${index}` is migrated only into the draft (`new`) slot.
 */
export function loadSessionAgentIds(conversationId?: string | null | number, index = 0): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  // Back-compat: loadSessionAgentIds(0) used to mean pane index only
  if (typeof conversationId === 'number') {
    index = conversationId;
    conversationId = SESSION_AGENTS_NEW_CONVO;
  }
  const id = normalizeSessionAgentsConversationId(conversationId);
  const key = sessionAgentsStorageKey(id, index);
  const owned = readIds(window.localStorage.getItem(key));
  if (owned.length > 0 || window.localStorage.getItem(key) != null) {
    return owned;
  }
  if (id === SESSION_AGENTS_NEW_CONVO) {
    const legacy = readIds(window.localStorage.getItem(`${LEGACY_INDEX_PREFIX}${index}`));
    if (legacy.length > 0) {
      try {
        window.localStorage.setItem(key, JSON.stringify(legacy));
      } catch {
        /* ignore */
      }
      return legacy;
    }
  }
  return [];
}

export function saveSessionAgentIds(
  ids: string[],
  conversationId?: string | null | number,
  index = 0,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  // Back-compat: saveSessionAgentIds(ids, 0)
  if (typeof conversationId === 'number') {
    index = conversationId;
    conversationId = SESSION_AGENTS_NEW_CONVO;
  }
  const id = normalizeSessionAgentsConversationId(conversationId);
  const unique = [...new Set(ids.filter((x) => isPersistedAgentId(x)))];
  const key = sessionAgentsStorageKey(id, index);
  window.localStorage.setItem(key, JSON.stringify(unique));
  if (id === SESSION_AGENTS_NEW_CONVO) {
    try {
      window.localStorage.setItem(`${LEGACY_INDEX_PREFIX}${index}`, JSON.stringify(unique));
    } catch {
      /* ignore */
    }
  }
  window.dispatchEvent(
    new CustomEvent(SESSION_AGENTS_CHANGED_EVENT, {
      detail: { conversationId: id, index, ids: unique } satisfies SessionAgentsChangedDetail,
    }),
  );
}

/** Copy roster when draft chat gets a real conversationId. */
export function copySessionAgents(
  sourceConversationId: string | null | undefined,
  targetConversationId: string | null | undefined,
  index = 0,
): string[] {
  const sourceId = normalizeSessionAgentsConversationId(sourceConversationId);
  const targetId = normalizeSessionAgentsConversationId(targetConversationId);
  const ids = loadSessionAgentIds(sourceId, index);
  if (sourceId === targetId) {
    return ids;
  }
  saveSessionAgentIds(ids, targetId, index);
  return ids;
}

export function ensureAgentInSession(ids: string[], agentId: string): string[] {
  if (!isPersistedAgentId(agentId)) {
    return ids.filter((id) => isPersistedAgentId(id));
  }
  if (ids.includes(agentId)) {
    return ids;
  }
  return [...ids, agentId];
}

export function removeAgentFromSession(ids: string[], agentId: string): string[] {
  return ids.filter((id) => id !== agentId && isPersistedAgentId(id));
}

/**
 * Whether a winning URL/spec or soft-default preset should wipe a prior agent
 * from the draft Session agents roster (and AGENT_ID_PREFIX). Agent-backed
 * specs that name their own agent keep that selection.
 */
export function specPresetDisplacesPriorAgent(
  preset:
    | {
        spec?: string | null;
        endpoint?: string | null;
        agent_id?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (preset?.spec == null || preset.spec === '') {
    return false;
  }
  const presetAgentId = typeof preset.agent_id === 'string' ? preset.agent_id : null;
  return !(
    isAgentsEndpoint(preset.endpoint) &&
    presetAgentId != null &&
    !isEphemeralAgentId(presetAgentId)
  );
}
