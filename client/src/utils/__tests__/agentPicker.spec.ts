import type { Agent } from 'librechat-data-provider';
import {
  categoriesFromAgents,
  filterAndSortAgentsForPicker,
  isPersistedAgentId,
} from '../agentPicker';

const agent = (partial: Partial<Agent> & Pick<Agent, 'id' | 'name'>): Agent =>
  ({
    description: '',
    instructions: '',
    provider: 'openAI',
    model: 'gpt',
    model_parameters: {},
    tools: [],
    ...partial,
  }) as Agent;

describe('filterAndSortAgentsForPicker', () => {
  const agents = [
    agent({ id: 'agent_a', name: 'Alpha Analyst', category: 'M894', description: 'margins' }),
    agent({ id: 'agent_b', name: 'Beta Bot', category: 'M894', description: 'general helper' }),
    agent({ id: 'agent_c', name: 'Sales Closer', category: 'sales', description: 'pipeline' }),
    agent({ id: 'claude-opus-5-thinking', name: 'claude-opus-5-thinking', category: 'general' }),
    agent({ id: 'CPA-DE__kimi-k2.5___Kimi', name: 'kimi-k2.5', category: 'general' }),
  ];

  it('drops ephemeral / model-spec shaped ids', () => {
    const items = filterAndSortAgentsForPicker({
      agents,
      search: '',
      category: 'all',
      favoriteIds: new Set(),
      activeAgentId: null,
    });
    expect(items.map((i) => i.agent.id)).toEqual(['agent_a', 'agent_b', 'agent_c']);
  });

  it('puts favorites first, then active, then alpha', () => {
    const items = filterAndSortAgentsForPicker({
      agents,
      search: '',
      category: 'all',
      favoriteIds: new Set(['agent_c']),
      activeAgentId: 'agent_b',
    });
    expect(items.map((i) => i.agent.id)).toEqual(['agent_c', 'agent_b', 'agent_a']);
    expect(items[0].isFavorite).toBe(true);
    expect(items[1].isActive).toBe(true);
  });

  it('filters by category and search', () => {
    const items = filterAndSortAgentsForPicker({
      agents,
      search: 'margin',
      category: 'M894',
      favoriteIds: new Set(),
    });
    expect(items.map((i) => i.agent.id)).toEqual(['agent_a']);
  });
});

describe('isPersistedAgentId / categoriesFromAgents', () => {
  it('accepts only agent_ ids', () => {
    expect(isPersistedAgentId('agent_abc')).toBe(true);
    expect(isPersistedAgentId('claude-opus-5-thinking')).toBe(false);
    expect(isPersistedAgentId('CPA-DE__x___Y')).toBe(false);
  });

  it('builds chips from real agent categories', () => {
    expect(
      categoriesFromAgents([
        agent({ id: 'agent_a', name: 'A', category: 'M894' }),
        agent({ id: 'agent_b', name: 'B', category: 'M894 Board' }),
        agent({ id: 'x', name: 'x', category: 'general' }),
      ]),
    ).toEqual(['M894', 'M894 Board']);
  });
});
