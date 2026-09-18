import type { useLocalize } from '~/hooks';
import type { Endpoint } from '~/common';
import { filterItems } from '../utils';

const agentsEndpoint: Endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: true,
  icon: null,
  showMarketplace: true,
  searchAliases: ['agent marketplace', 'marketplace'],
};

const disabledAgentsEndpoint: Endpoint = {
  value: 'agents',
  label: 'My Agents',
  hasModels: false,
  icon: null,
};

describe('model selector utilities', () => {
  it('matches endpoint search aliases', () => {
    const results = filterItems([agentsEndpoint], 'marketplace', undefined, undefined);
    expect(results).toEqual([agentsEndpoint]);
  });

  it('matches localized Marketplace labels', () => {
    const localize = ((key: string) => {
      if (key === 'com_agents_marketplace') {
        return 'Tienda de Agentes';
      }
      if (key === 'com_ui_marketplace') {
        return 'Tienda';
      }
      return key;
    }) as ReturnType<typeof useLocalize>;

    const results = filterItems([agentsEndpoint], 'tienda', undefined, undefined, localize);
    expect(results).toEqual([agentsEndpoint]);
  });

  it('does not match agents when there are no selectable agent options', () => {
    const results = filterItems([disabledAgentsEndpoint], 'my agents', undefined, undefined);
    expect(results).toEqual([]);
  });

  it('matches modelSpecs by preset.model so mock-model search finds specs-only providers', () => {
    const mockSpec = {
      name: 'e2e-mock-provider-a',
      label: 'Mock Provider A',
      preset: { endpoint: 'Mock Provider A', model: 'mock-model-a' },
    };
    const results = filterItems([mockSpec], 'mock-model-a', undefined, undefined);
    expect(results).toEqual([mockSpec]);
  });

  it('matches modelSpecs by preset.endpoint when label/name do not match', () => {
    const mockSpec = {
      name: 'e2e-friendly',
      label: 'Friendly Name',
      preset: { endpoint: 'Mock Provider A', model: 'mock-model-a' },
    };
    const results = filterItems([mockSpec], 'mock provider a', undefined, undefined);
    expect(results).toEqual([mockSpec]);
  });
});
