import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IOrchestrationRun } from '..';
import { createOrchestrationRunMethods } from './orchestrationRun';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: MongoMemoryServer;
let OrchestrationRun: mongoose.Model<IOrchestrationRun>;
let methods: ReturnType<typeof createOrchestrationRunMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  OrchestrationRun = mongoose.models.OrchestrationRun as mongoose.Model<IOrchestrationRun>;
  methods = createOrchestrationRunMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await OrchestrationRun.deleteMany({});
});

describe('orchestration run methods', () => {
  it('creates and returns the latest owner-scoped run', async () => {
    await methods.createOrchestrationRun({
      runId: 'run-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      requestedMode: 'team',
      resolvedMode: 'team',
      scheduler: 'manual',
      state: 'pending',
      nodes: [{ id: 'planner', state: 'pending', cls: 'planner' }],
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
    });
    await methods.createOrchestrationRun({
      runId: 'run-2',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      requestedMode: 'm3',
      resolvedMode: 'm3',
      scheduler: 'manual',
      state: 'pending',
      nodes: [{ id: 'planner', state: 'pending', cls: 'planner' }],
      createdAt: '2026-09-28T11:00:00.000Z',
      updatedAt: '2026-09-28T11:00:00.000Z',
    });

    await expect(
      methods.getLatestOrchestrationRun({
        conversationId: 'conversation-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      }),
    ).resolves.toMatchObject({
      runId: 'run-2',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      requestedMode: 'm3',
      resolvedMode: 'm3',
      scheduler: 'manual',
      state: 'pending',
      nodes: [{ id: 'planner', state: 'pending', cls: 'planner' }],
    });
  });

  it('does not return runs for another user or tenant', async () => {
    await methods.createOrchestrationRun({
      runId: 'run-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      requestedMode: 'auto',
      resolvedMode: 'auto',
      scheduler: 'manual',
      state: 'pending',
      nodes: [{ id: 'auto', state: 'pending' }],
    });

    await expect(
      methods.getLatestOrchestrationRun({
        conversationId: 'conversation-1',
        userId: 'user-2',
        tenantId: 'tenant-1',
      }),
    ).resolves.toBeNull();
    await expect(
      methods.getLatestOrchestrationRun({
        conversationId: 'conversation-1',
        userId: 'user-1',
        tenantId: 'tenant-2',
      }),
    ).resolves.toBeNull();
  });

  it('cancels only active owner-scoped runs', async () => {
    await methods.createOrchestrationRun({
      runId: 'run-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      requestedMode: 'm2',
      resolvedMode: 'm2',
      scheduler: 'manual',
      state: 'pending',
      nodes: [{ id: 'm2', state: 'pending' }],
    });

    await expect(
      methods.cancelOrchestrationRun({
        runId: 'run-1',
        userId: 'user-2',
        tenantId: 'tenant-1',
      }),
    ).resolves.toBeNull();

    await expect(
      methods.cancelOrchestrationRun({
        runId: 'run-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      }),
    ).resolves.toMatchObject({
      runId: 'run-1',
      state: 'cancelled',
    });

    await expect(
      methods.cancelOrchestrationRun({
        runId: 'run-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
      }),
    ).resolves.toBeNull();
  });
});
