import type { OrchMode, OrchestrationRun } from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';
import {
  createGetLatestOrchestrationRunHandler,
  createManualOrchestrationRun,
  createManualOrchestrationRunHandler,
  cancelManualOrchestrationRun,
  createCancelOrchestrationRunHandler,
  getLatestManualOrchestrationRun,
  planNodesForMode,
} from './orchestration';

function createMockResponse(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
}

const owner = { userId: 'user-1', tenantId: 'tenant-1' };
const enabledConfig = {
  enabled: true,
  allowedModes: ['auto', 'team', 'm2', 'm3', 'compare'] as Array<Exclude<OrchMode, 'off'>>,
  maxNodesPerRun: 16,
};

describe('planNodesForMode', () => {
  it('creates placeholder nodes for every manual mode', () => {
    expect(planNodesForMode('auto')).toHaveLength(1);
    expect(planNodesForMode('m2')).toHaveLength(1);
    expect(planNodesForMode('team').map((node) => node.id)).toEqual([
      'planner',
      'member-1',
      'member-2',
      'accept',
    ]);
    expect(planNodesForMode('m3').map((node) => node.id)).toEqual([
      'planner',
      'worker',
      'reviewer',
    ]);
    expect(planNodesForMode('compare').map((node) => node.id)).toEqual([
      'candidate-a',
      'candidate-b',
    ]);
  });

  it('honors the configured maxNodesPerRun cap', () => {
    expect(planNodesForMode('team', { maxNodesPerRun: 2 }).map((node) => node.id)).toEqual([
      'planner',
      'member-1',
    ]);
  });
});

describe('createManualOrchestrationRun', () => {
  it('rejects when orchestration is disabled', async () => {
    const createOrchestrationRun = jest.fn();
    const result = await createManualOrchestrationRun({
      body: { conversationId: 'conversation-1', mode: 'm2' },
      config: { enabled: false },
      owner,
      methods: { createOrchestrationRun },
    });

    expect(result.status).toBe(403);
    expect(createOrchestrationRun).not.toHaveBeenCalled();
  });

  it('rejects off, unknown, and disallowed modes', async () => {
    const createOrchestrationRun = jest.fn();
    await expect(
      createManualOrchestrationRun({
        body: { conversationId: 'conversation-1', mode: 'off' },
        config: enabledConfig,
        owner,
        methods: { createOrchestrationRun },
      }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      createManualOrchestrationRun({
        body: { conversationId: 'conversation-1', mode: 'future' },
        config: enabledConfig,
        owner,
        methods: { createOrchestrationRun },
      }),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      createManualOrchestrationRun({
        body: { conversationId: 'conversation-1', mode: 'compare' },
        config: { ...enabledConfig, allowedModes: ['m2'] },
        owner,
        methods: { createOrchestrationRun },
      }),
    ).resolves.toMatchObject({ status: 403 });
    expect(createOrchestrationRun).not.toHaveBeenCalled();
  });

  it('validates conversation ownership when the ownership reader is available', async () => {
    const createOrchestrationRun = jest.fn();
    const getConvoOwnership = jest.fn(async () => null);
    const result = await createManualOrchestrationRun({
      body: { conversationId: 'conversation-1', mode: 'm2' },
      config: enabledConfig,
      owner,
      methods: { createOrchestrationRun, getConvoOwnership },
    });

    expect(getConvoOwnership).toHaveBeenCalledWith('user-1', 'conversation-1', 'tenant-1');
    expect(createOrchestrationRun).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 404, body: { error: 'conversation not found' } });
  });

  it('creates a manual owner-scoped run with placeholder nodes', async () => {
    const createOrchestrationRun = jest.fn(async (run) => ({
      ...run,
      createdAt: '2026-09-28T12:00:00.000Z',
      updatedAt: '2026-09-28T12:00:00.000Z',
    }));

    const result = await createManualOrchestrationRun({
      body: { conversationId: 'conversation-1', mode: 'team' },
      config: enabledConfig,
      owner,
      methods: {
        createOrchestrationRun,
        getConvoOwnership: jest.fn(async () => ({ user: 'user-1' })),
      },
    });

    expect(createOrchestrationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: expect.any(String),
        conversationId: 'conversation-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        requestedMode: 'team',
        resolvedMode: 'team',
        scheduler: 'manual',
        state: 'pending',
      }),
    );
    expect(result).toMatchObject({
      status: 201,
      body: {
        conversationId: 'conversation-1',
        requestedMode: 'team',
        resolvedMode: 'team',
        scheduler: 'manual',
        state: 'pending',
      },
    });
    expect('userId' in result.body).toBe(false);
    expect('tenantId' in result.body).toBe(false);
  });
});

describe('getLatestManualOrchestrationRun', () => {
  it('returns 404 for another user because methods are called with owner scope', async () => {
    const getLatestOrchestrationRun = jest.fn(async () => null);
    const result = await getLatestManualOrchestrationRun({
      conversationId: 'conversation-1',
      owner,
      methods: { getLatestOrchestrationRun },
    });

    expect(getLatestOrchestrationRun).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(result).toEqual({ status: 404, body: { error: 'not found' } });
  });
});

describe('cancelManualOrchestrationRun', () => {
  it('cancels using owner scope and returns the redacted view', async () => {
    const cancelledRun = {
      runId: 'run-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      requestedMode: 'm2',
      resolvedMode: 'm2',
      scheduler: 'manual',
      state: 'cancelled',
      nodes: [{ id: 'm2', state: 'pending' }],
      createdAt: '2026-09-28T12:00:00.000Z',
      updatedAt: '2026-09-28T12:00:00.000Z',
    } satisfies OrchestrationRun;
    const cancelOrchestrationRun = jest.fn(async () => cancelledRun);
    const result = await cancelManualOrchestrationRun({
      runId: 'run-1',
      owner,
      methods: { cancelOrchestrationRun },
    });

    expect(cancelOrchestrationRun).toHaveBeenCalledWith({
      runId: 'run-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(result).toMatchObject({
      status: 200,
      body: { runId: 'run-1', state: 'cancelled' },
    });
    expect('userId' in result.body).toBe(false);
  });

  it('returns 404 when no active owner-scoped run can be cancelled', async () => {
    const cancelOrchestrationRun = jest.fn(async () => null);
    const result = await cancelManualOrchestrationRun({
      runId: 'run-1',
      owner,
      methods: { cancelOrchestrationRun },
    });

    expect(result).toEqual({ status: 404, body: { error: 'not found' } });
  });
});

describe('orchestration handlers', () => {
  it('uses req.user.id and tenantId for create owner scope', async () => {
    const createOrchestrationRun = jest.fn(async (run) => ({
      ...run,
      createdAt: '2026-09-28T12:00:00.000Z',
      updatedAt: '2026-09-28T12:00:00.000Z',
    }));
    const getConvoOwnership = jest.fn(async () => ({ user: 'user-1' }));
    const handler = createManualOrchestrationRunHandler({
      createOrchestrationRun,
      getLatestOrchestrationRun: jest.fn(),
      cancelOrchestrationRun: jest.fn(),
      getConvoOwnership,
    });
    const req = {
      body: { conversationId: 'conversation-1', mode: 'm2' },
      user: { id: 'user-1', tenantId: 'tenant-1' },
      config: { endpoints: { agents: { orchestration: enabledConfig } } },
    } as unknown as ServerRequest;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res, next);

    expect(createOrchestrationRun).toHaveBeenCalledWith(expect.objectContaining(owner));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  it('uses req.user.id and tenantId for latest run lookup', async () => {
    const getLatestOrchestrationRun = jest.fn(async () => null);
    const handler = createGetLatestOrchestrationRunHandler({
      createOrchestrationRun: jest.fn(),
      getLatestOrchestrationRun,
      cancelOrchestrationRun: jest.fn(),
    });
    const req = {
      params: { conversationId: 'conversation-1' },
      user: { id: 'user-1', tenantId: 'tenant-1' },
    } as unknown as ServerRequest;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res, next);

    expect(getLatestOrchestrationRun).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('uses req.user.id and tenantId for cancel run', async () => {
    const cancelOrchestrationRun = jest.fn(async () => null);
    const handler = createCancelOrchestrationRunHandler({
      createOrchestrationRun: jest.fn(),
      getLatestOrchestrationRun: jest.fn(),
      cancelOrchestrationRun,
    });
    const req = {
      params: { runId: 'run-1' },
      user: { id: 'user-1', tenantId: 'tenant-1' },
    } as unknown as ServerRequest;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res, next);

    expect(cancelOrchestrationRun).toHaveBeenCalledWith({
      runId: 'run-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });
});
