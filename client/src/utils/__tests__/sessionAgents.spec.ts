import {
  SESSION_AGENTS_CHANGED_EVENT,
  copySessionAgents,
  ensureAgentInSession,
  loadSessionAgentIds,
  removeAgentFromSession,
  saveSessionAgentIds,
  sessionAgentsStorageKey,
} from '../sessionAgents';

describe('sessionAgents', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('adds unique persisted ids only', () => {
    expect(ensureAgentInSession(['agent_a'], 'agent_b')).toEqual(['agent_a', 'agent_b']);
    expect(ensureAgentInSession(['agent_a'], 'agent_a')).toEqual(['agent_a']);
    expect(ensureAgentInSession(['agent_a'], 'claude-opus-5-thinking')).toEqual(['agent_a']);
  });

  it('removes ids', () => {
    expect(removeAgentFromSession(['agent_a', 'agent_b'], 'agent_a')).toEqual(['agent_b']);
    expect(removeAgentFromSession(['agent_a'], 'z')).toEqual(['agent_a']);
  });

  it('scrubs ephemeral ids from storage (legacy index key migrates into new)', () => {
    window.localStorage.setItem(
      'session_agents__0',
      JSON.stringify(['agent_a', 'claude-opus-5-thinking', 'CPA-DE__kimi___K']),
    );
    expect(loadSessionAgentIds('new', 0)).toEqual(['agent_a']);
    saveSessionAgentIds(['agent_a', 'gpt-5.4.1-thinking'], 'new', 0);
    expect(JSON.parse(window.localStorage.getItem(sessionAgentsStorageKey('new')) || '[]')).toEqual(
      ['agent_a'],
    );
  });

  it('dispatches change event on save', () => {
    const seen: Array<{ conversationId?: string; index?: number; ids?: string[] }> = [];
    const handler = (event: Event) => {
      seen.push((event as CustomEvent).detail);
    };
    window.addEventListener(SESSION_AGENTS_CHANGED_EVENT, handler as EventListener);
    saveSessionAgentIds(['agent_a', 'agent_b'], 'convo-A', 0);
    window.removeEventListener(SESSION_AGENTS_CHANGED_EVENT, handler as EventListener);
    expect(seen).toEqual([{ conversationId: 'convo-A', index: 0, ids: ['agent_a', 'agent_b'] }]);
  });

  it('saves an empty roster', () => {
    saveSessionAgentIds(['agent_a'], 'convo-A', 0);
    saveSessionAgentIds([], 'convo-A', 0);
    expect(loadSessionAgentIds('convo-A', 0)).toEqual([]);
  });

  it('isolates roster per conversation', () => {
    saveSessionAgentIds(['agent_a'], 'convo-A', 0);
    saveSessionAgentIds(['agent_b'], 'convo-B', 0);
    expect(loadSessionAgentIds('convo-A', 0)).toEqual(['agent_a']);
    expect(loadSessionAgentIds('convo-B', 0)).toEqual(['agent_b']);
  });

  it('copySessionAgents moves draft roster onto real id', () => {
    saveSessionAgentIds(['agent_a', 'agent_b'], 'new', 0);
    copySessionAgents('new', 'real-123');
    expect(loadSessionAgentIds('real-123', 0)).toEqual(['agent_a', 'agent_b']);
    saveSessionAgentIds(['agent_c'], 'new', 0);
    expect(loadSessionAgentIds('real-123', 0)).toEqual(['agent_a', 'agent_b']);
  });

  it('legacy loadSessionAgentIds(0) still works as draft', () => {
    saveSessionAgentIds(['agent_a'], 'new', 0);
    expect(loadSessionAgentIds(0 as unknown as string)).toEqual(['agent_a']);
  });
});
