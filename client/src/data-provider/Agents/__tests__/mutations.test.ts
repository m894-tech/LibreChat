import { createElement } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dataService, PermissionBits, QueryKeys } from 'librechat-data-provider';
import type {
  Agent,
  AgentCreatorSpec,
  AgentListResponse,
  GraphEdge,
} from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import type { ReactNode } from 'react';
import {
  useCancelOrchestrationRunMutation,
  useCreateOrchestrationRunMutation,
  useDeleteAgentMutation,
  useDuplicateAgentMutation,
  usePublishAgentCreatorMutation,
  useUpdateAgentMutation,
  useValidateAgentCreatorMutation,
} from '../mutations';

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      deleteAgent: jest.fn(),
      updateAgent: jest.fn(),
      duplicateAgent: jest.fn(),
      validateAgentCreatorSpec: jest.fn(),
      publishAgentCreatorSpec: jest.fn(),
      createOrchestrationRun: jest.fn(),
      cancelOrchestrationRun: jest.fn(),
    },
  };
});

const createAgent = (id: string, edges: GraphEdge[] = [], isEditable?: boolean): Agent => ({
  id,
  name: id,
  description: null,
  created_at: 0,
  avatar: null,
  provider: 'openAI',
  model: 'test-model',
  model_parameters: {
    temperature: null,
    maxContextTokens: null,
    max_context_tokens: null,
    max_output_tokens: null,
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
  },
  edges,
  ...(isEditable !== undefined ? { isEditable } : {}),
});

const createWrapper = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };

const agentCreatorSpec = (): AgentCreatorSpec => ({
  name: 'Research helper',
  provider: 'agents',
  model: 'test-model',
  model_parameters: {
    temperature: null,
    maxContextTokens: null,
    max_context_tokens: null,
    max_output_tokens: null,
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
  },
  skills: [{ id: 'skill-1' }],
});

describe('useValidateAgentCreatorMutation', () => {
  it('calls the Agent Creator validation endpoint', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const payload = agentCreatorSpec();
    const response = {
      valid: true,
      issues: [],
      preview: {
        name: 'Research helper',
        description: null,
        instructions: null,
        provider: 'agents',
        model: 'test-model',
        model_parameters: payload.model_parameters,
        skills: ['skill-1'],
        skills_enabled: true,
        skills_scope: 'selected',
        skill_authoring_enabled: false,
      },
    } satisfies t.AgentCreatorValidateResponse;
    jest.mocked(dataService.validateAgentCreatorSpec).mockResolvedValue(response);

    const { result } = renderHook(() => useValidateAgentCreatorMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    expect(dataService.validateAgentCreatorSpec).toHaveBeenCalledWith(payload);
  });
});

describe('usePublishAgentCreatorMutation', () => {
  it('adds the published agent to agent list caches as editable', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const payload = agentCreatorSpec();
    const publishedAgent = createAgent('agent_published');
    const existingAgent = createAgent('agent_existing', [], false);
    const viewListKey = [QueryKeys.agents, { requiredPermission: PermissionBits.VIEW }];
    const editListKey = [QueryKeys.agents, { requiredPermission: PermissionBits.EDIT }];
    queryClient.setQueryData(viewListKey, {
      object: 'list',
      data: [existingAgent],
      first_id: existingAgent.id,
      last_id: existingAgent.id,
      has_more: false,
    } satisfies AgentListResponse);
    queryClient.setQueryData(editListKey, {
      object: 'list',
      data: [],
      first_id: '',
      last_id: '',
      has_more: false,
    } satisfies AgentListResponse);
    jest.mocked(dataService.publishAgentCreatorSpec).mockResolvedValue(publishedAgent);

    const { result } = renderHook(() => usePublishAgentCreatorMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ spec: payload, creatorAgentId: 'agent_creator' });
    });

    expect(dataService.publishAgentCreatorSpec).toHaveBeenCalledWith({
      spec: payload,
      creatorAgentId: 'agent_creator',
    });
    expect(queryClient.getQueryData<AgentListResponse>(viewListKey)?.data).toEqual([
      { ...publishedAgent, isEditable: true },
      existingAgent,
    ]);
    expect(queryClient.getQueryData<AgentListResponse>(editListKey)?.data).toEqual([
      { ...publishedAgent, isEditable: true },
    ]);
  });

  it('accepts a legacy direct Agent Creator spec payload', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const payload = agentCreatorSpec();
    const publishedAgent = createAgent('agent_published');
    jest.mocked(dataService.publishAgentCreatorSpec).mockResolvedValue(publishedAgent);

    const { result } = renderHook(() => usePublishAgentCreatorMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync(payload);
    });

    expect(dataService.publishAgentCreatorSpec).toHaveBeenCalledWith(payload);
  });
});

describe('useDeleteAgentMutation', () => {
  it('refreshes only expanded agent caches with edges that reference the deleted agent', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const targetId = 'agent_target';
    const affectedId = 'agent_affected';
    const affectedSourceId = 'agent_affected_source';
    const unrelatedId = 'agent_unrelated';
    const affectedQueryKey = [QueryKeys.agent, affectedId, 'expanded'];
    const affectedSourceQueryKey = [QueryKeys.agent, affectedSourceId, 'expanded'];
    const unrelatedQueryKey = [QueryKeys.agent, unrelatedId, 'expanded'];
    const viewListKey = [QueryKeys.agents, { requiredPermission: PermissionBits.VIEW }];
    const staleAffectedAgent = createAgent(affectedId, [
      { from: affectedId, to: targetId, edgeType: 'handoff' },
    ]);
    const refreshedAffectedAgent = createAgent(affectedId);
    const staleAffectedSourceAgent = createAgent(affectedSourceId, [
      {
        from: [targetId, 'agent_surviving_source'],
        to: affectedSourceId,
        edgeType: 'handoff',
      },
    ]);
    const refreshedAffectedSourceAgent = createAgent(affectedSourceId, [
      { from: 'agent_surviving_source', to: affectedSourceId, edgeType: 'handoff' },
    ]);
    const locallyPrunedAffectedSourceAgent = createAgent(affectedSourceId, [
      { from: ['agent_surviving_source'], to: affectedSourceId, edgeType: 'handoff' },
    ]);
    const unrelatedAgent = createAgent(unrelatedId, [
      { from: unrelatedId, to: 'agent_other', edgeType: 'handoff' },
    ]);
    const affectedFetch = jest
      .fn<Promise<Agent>, []>()
      .mockResolvedValueOnce(staleAffectedAgent)
      .mockResolvedValue(refreshedAffectedAgent);
    const affectedSourceFetch = jest
      .fn<Promise<Agent>, []>()
      .mockResolvedValueOnce(staleAffectedSourceAgent)
      .mockResolvedValue(refreshedAffectedSourceAgent);
    const unrelatedFetch = jest.fn<Promise<Agent>, []>().mockResolvedValue(unrelatedAgent);

    await queryClient.prefetchQuery(affectedQueryKey, affectedFetch);
    await queryClient.prefetchQuery(affectedSourceQueryKey, affectedSourceFetch);
    await queryClient.prefetchQuery(unrelatedQueryKey, unrelatedFetch);
    queryClient.setQueryData<AgentListResponse>(viewListKey, {
      object: 'list',
      data: [staleAffectedAgent, staleAffectedSourceAgent, unrelatedAgent, createAgent(targetId)],
      first_id: affectedId,
      last_id: targetId,
      has_more: false,
    });
    queryClient.setQueryData([QueryKeys.agent, targetId], createAgent(targetId));
    queryClient.setQueryData([QueryKeys.agent, targetId, 'expanded'], createAgent(targetId));

    jest.mocked(dataService.deleteAgent).mockResolvedValue();
    const { result } = renderHook(() => useDeleteAgentMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ agent_id: targetId });
    });

    await waitFor(() => expect(affectedFetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(affectedSourceFetch).toHaveBeenCalledTimes(2));

    expect(queryClient.getQueryData(affectedQueryKey)).toEqual(refreshedAffectedAgent);
    expect(queryClient.getQueryData(affectedSourceQueryKey)).toEqual(refreshedAffectedSourceAgent);
    expect(unrelatedFetch).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(unrelatedQueryKey)).toEqual(unrelatedAgent);
    expect(queryClient.getQueryData<AgentListResponse>(viewListKey)?.data).toEqual([
      refreshedAffectedAgent,
      locallyPrunedAffectedSourceAgent,
      unrelatedAgent,
    ]);
    expect(queryClient.getQueryData([QueryKeys.agent, targetId])).toBeUndefined();
    expect(queryClient.getQueryData([QueryKeys.agent, targetId, 'expanded'])).toBeUndefined();
  });
});

describe('useCreateOrchestrationRunMutation', () => {
  it('caches the created run by conversation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = {
      runId: 'run-1',
      conversationId: 'conversation-1',
      requestedMode: 'm2',
      resolvedMode: 'm2',
      scheduler: 'manual',
      state: 'pending',
      nodes: [{ id: 'm2', state: 'pending' }],
    } satisfies t.CreateOrchestrationRunResponse;
    jest.mocked(dataService.createOrchestrationRun).mockResolvedValue(run);

    const { result } = renderHook(() => useCreateOrchestrationRunMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ conversationId: 'conversation-1', mode: 'm2' });
    });

    expect(dataService.createOrchestrationRun).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      mode: 'm2',
    });
    expect(queryClient.getQueryData([QueryKeys.orchestrationRun, 'conversation-1'])).toBe(run);
  });
});

describe('useCancelOrchestrationRunMutation', () => {
  it('caches the cancelled run by conversation', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const run = {
      runId: 'run-1',
      conversationId: 'conversation-1',
      requestedMode: 'm2',
      resolvedMode: 'm2',
      scheduler: 'manual',
      state: 'cancelled',
      nodes: [{ id: 'm2', state: 'pending' }],
    } satisfies t.CancelOrchestrationRunResponse;
    jest.mocked(dataService.cancelOrchestrationRun).mockResolvedValue(run);

    const { result } = renderHook(() => useCancelOrchestrationRunMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ runId: 'run-1' });
    });

    expect(dataService.cancelOrchestrationRun).toHaveBeenCalledWith({ runId: 'run-1' });
    expect(queryClient.getQueryData([QueryKeys.orchestrationRun, 'conversation-1'])).toBe(run);
  });
});

describe('useUpdateAgentMutation', () => {
  it('preserves the list-cache isEditable flag after a successful update', async () => {
    /** MANAGE_AGENTS can PATCH agents the ACL marks non-editable. Mutation success must
     *  not promote those VIEW rows into the editable-only "My Agents" subset. */
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const agentId = 'agent_view_only';
    const listKey = [QueryKeys.agents, { requiredPermission: PermissionBits.VIEW }];
    const cachedList: AgentListResponse = {
      object: 'list',
      data: [createAgent(agentId, [], false)],
      first_id: agentId,
      last_id: agentId,
      has_more: false,
    };
    queryClient.setQueryData(listKey, cachedList);

    const updatedAgent = createAgent(agentId);
    updatedAgent.name = 'Renamed';
    jest.mocked(dataService.updateAgent).mockResolvedValue(updatedAgent);

    const { result } = renderHook(() => useUpdateAgentMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ agent_id: agentId, data: { name: 'Renamed' } });
    });

    const listRes = queryClient.getQueryData<AgentListResponse>(listKey);
    expect(listRes?.data).toHaveLength(1);
    expect(listRes?.data[0]).toMatchObject({
      id: agentId,
      name: 'Renamed',
      isEditable: false,
    });
  });
});

describe('useDuplicateAgentMutation', () => {
  it('marks the duplicated agent editable in the list cache', async () => {
    /** Duplicating grants ownership, so the new row is editable. Without this the row
     *  carries no `isEditable` and only survives the selector filter by failing open. */
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const sourceId = 'agent_source';
    const duplicateId = 'agent_duplicate';
    const listKey = [QueryKeys.agents, { requiredPermission: PermissionBits.VIEW }];
    queryClient.setQueryData(listKey, {
      object: 'list',
      data: [createAgent(sourceId, [], false)],
      first_id: sourceId,
      last_id: sourceId,
      has_more: false,
    } satisfies AgentListResponse);

    jest
      .mocked(dataService.duplicateAgent)
      .mockResolvedValue({ agent: createAgent(duplicateId), actions: [] });

    const { result } = renderHook(() => useDuplicateAgentMutation(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ agent_id: sourceId });
    });

    const listRes = queryClient.getQueryData<AgentListResponse>(listKey);
    expect(listRes?.data[0]).toMatchObject({ id: duplicateId, isEditable: true });
    /** The untouched source row keeps its own ACL flag. */
    expect(listRes?.data[1]).toMatchObject({ id: sourceId, isEditable: false });
  });
});
