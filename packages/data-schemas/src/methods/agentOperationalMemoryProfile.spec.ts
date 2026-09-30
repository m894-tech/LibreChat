import mongoose from 'mongoose';
import { MemoryScope } from 'librechat-data-provider';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IAgentOperationalMemoryProfile } from '..';
import { createAgentOperationalMemoryProfileMethods } from './agentOperationalMemoryProfile';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: MongoMemoryServer;
let AgentOperationalMemoryProfile: mongoose.Model<IAgentOperationalMemoryProfile>;
let methods: ReturnType<typeof createAgentOperationalMemoryProfileMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  AgentOperationalMemoryProfile = mongoose.models
    .AgentOperationalMemoryProfile as mongoose.Model<IAgentOperationalMemoryProfile>;
  methods = createAgentOperationalMemoryProfileMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await AgentOperationalMemoryProfile.deleteMany({});
});

describe('Agent Operational Memory profile methods', () => {
  it('upserts and serializes an agent-scoped operational memory profile', async () => {
    const profile = await methods.upsertAgentOperationalMemoryProfile({
      agentId: 'agent_child',
      createdBy: 'user-1',
      tenantId: 'tenant-1',
      role: 'coder',
      memoryScope: MemoryScope.agent,
      artifacts: [
        {
          key: 'workflow',
          title: 'Coder workflow',
          content: 'Keep changes surgical and verify focused behavior.',
          priority: 100,
        },
      ],
    });

    expect(profile).toMatchObject({
      agentId: 'agent_child',
      createdBy: 'user-1',
      tenantId: 'tenant-1',
      source: 'agent_creator',
      role: 'coder',
      memoryScope: MemoryScope.agent,
      artifacts: [
        {
          key: 'workflow',
          title: 'Coder workflow',
          content: 'Keep changes surgical and verify focused behavior.',
          priority: 100,
        },
      ],
    });

    await expect(
      methods.getAgentOperationalMemoryProfile({
        agentId: 'agent_child',
        createdBy: 'user-1',
        tenantId: 'tenant-1',
      }),
    ).resolves.toMatchObject({ agentId: 'agent_child', role: 'coder' });
  });

  it('updates artifacts and deletes profiles for rollback', async () => {
    await methods.upsertAgentOperationalMemoryProfile({
      agentId: 'agent_child',
      createdBy: 'user-1',
      tenantId: 'tenant-1',
      role: 'general',
      memoryScope: MemoryScope.agent,
      artifacts: [],
    });

    await expect(
      methods.updateAgentOperationalMemoryProfile({
        agentId: 'agent_child',
        createdBy: 'user-1',
        tenantId: 'tenant-1',
        role: 'coder',
        artifacts: [
          {
            key: 'verification',
            title: 'Verification rules',
            content: 'Run focused checks before done.',
            priority: 80,
          },
        ],
      }),
    ).resolves.toMatchObject({
      role: 'coder',
      artifacts: [expect.objectContaining({ key: 'verification' })],
    });

    await expect(
      methods.deleteAgentOperationalMemoryProfile({
        agentId: 'agent_child',
        createdBy: 'user-1',
        tenantId: 'tenant-1',
      }),
    ).resolves.toEqual({ deletedCount: 1 });
    await expect(
      methods.getAgentOperationalMemoryProfile({
        agentId: 'agent_child',
        createdBy: 'user-1',
        tenantId: 'tenant-1',
      }),
    ).resolves.toBeNull();
  });

  it('isolates profiles by tenant for unique index, get, update, and delete', async () => {
    await methods.upsertAgentOperationalMemoryProfile({
      agentId: 'agent_shared',
      createdBy: 'user-1',
      tenantId: 'tenant-a',
      role: 'coder',
      memoryScope: MemoryScope.agent,
      artifacts: [
        {
          key: 'tenant-a-rule',
          title: 'Tenant A rule',
          content: 'Only visible in tenant A.',
          priority: 100,
        },
      ],
    });
    await methods.upsertAgentOperationalMemoryProfile({
      agentId: 'agent_shared',
      createdBy: 'user-1',
      tenantId: 'tenant-b',
      role: 'analyst',
      memoryScope: MemoryScope.agent,
      artifacts: [
        {
          key: 'tenant-b-rule',
          title: 'Tenant B rule',
          content: 'Only visible in tenant B.',
          priority: 100,
        },
      ],
    });

    await expect(
      AgentOperationalMemoryProfile.countDocuments({
        agentId: 'agent_shared',
        createdBy: 'user-1',
      }),
    ).resolves.toBe(2);
    await expect(
      methods.getAgentOperationalMemoryProfile({
        agentId: 'agent_shared',
        createdBy: 'user-1',
        tenantId: 'tenant-a',
      }),
    ).resolves.toMatchObject({ role: 'coder' });
    await expect(
      methods.getAgentOperationalMemoryProfile({
        agentId: 'agent_shared',
        createdBy: 'user-1',
        tenantId: 'tenant-b',
      }),
    ).resolves.toMatchObject({ role: 'analyst' });

    await expect(
      methods.updateAgentOperationalMemoryProfile({
        agentId: 'agent_shared',
        createdBy: 'user-1',
        tenantId: 'tenant-a',
        role: 'researcher',
        artifacts: [
          {
            key: 'tenant-a-updated-rule',
            title: 'Tenant A updated rule',
            content: 'Updated only in tenant A.',
            priority: 90,
          },
        ],
      }),
    ).resolves.toMatchObject({ role: 'researcher' });
    await expect(
      methods.getAgentOperationalMemoryProfile({
        agentId: 'agent_shared',
        createdBy: 'user-1',
        tenantId: 'tenant-b',
      }),
    ).resolves.toMatchObject({
      role: 'analyst',
      artifacts: [expect.objectContaining({ key: 'tenant-b-rule' })],
    });

    await expect(
      methods.deleteAgentOperationalMemoryProfile({
        agentId: 'agent_shared',
        createdBy: 'user-1',
        tenantId: 'tenant-a',
      }),
    ).resolves.toEqual({ deletedCount: 1 });
    await expect(
      methods.getAgentOperationalMemoryProfile({
        agentId: 'agent_shared',
        createdBy: 'user-1',
        tenantId: 'tenant-a',
      }),
    ).resolves.toBeNull();
    await expect(
      methods.getAgentOperationalMemoryProfile({
        agentId: 'agent_shared',
        createdBy: 'user-1',
        tenantId: 'tenant-b',
      }),
    ).resolves.toMatchObject({ role: 'analyst' });
  });
});
