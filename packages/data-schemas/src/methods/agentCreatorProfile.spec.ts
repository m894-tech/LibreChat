import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { EModelEndpoint, SkillsScope } from 'librechat-data-provider';
import type { IAgentCreatorProfile } from '..';
import { createAgentCreatorProfileMethods } from './agentCreatorProfile';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: MongoMemoryServer;
let AgentCreatorProfile: mongoose.Model<IAgentCreatorProfile>;
let methods: ReturnType<typeof createAgentCreatorProfileMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  AgentCreatorProfile = mongoose.models.AgentCreatorProfile as mongoose.Model<IAgentCreatorProfile>;
  methods = createAgentCreatorProfileMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await AgentCreatorProfile.deleteMany({});
});

describe('Agent Creator profile methods', () => {
  it('persists preferences and remembers child agents for a creator agent', async () => {
    const profile = await methods.upsertAgentCreatorProfile({
      creatorAgentId: 'agent_creator',
      createdBy: 'user-1',
      preferences: {
        defaultProvider: EModelEndpoint.openAI,
        defaultModel: 'gpt-4o-mini',
        defaultSkillsScope: SkillsScope.selected,
      },
    });

    expect(profile).toMatchObject({
      creatorAgentId: 'agent_creator',
      createdBy: 'user-1',
      preferences: {
        defaultProvider: EModelEndpoint.openAI,
        defaultModel: 'gpt-4o-mini',
        defaultSkillsScope: SkillsScope.selected,
      },
      childAgents: [],
    });

    const remembered = await methods.rememberAgentCreatorChild({
      creatorAgentId: 'agent_creator',
      createdBy: 'user-1',
      child: {
        agentId: 'agent_child',
        name: 'Child Agent',
        publicationId: 'publication-1',
        createdAt: '2026-09-29T12:00:00.000Z',
      },
    });

    expect(remembered.childAgents).toEqual([
      {
        agentId: 'agent_child',
        name: 'Child Agent',
        publicationId: 'publication-1',
        createdAt: '2026-09-29T12:00:00.000Z',
      },
    ]);
    await expect(
      methods.getAgentCreatorProfile({ creatorAgentId: 'agent_creator', createdBy: 'user-1' }),
    ).resolves.toMatchObject({
      creatorAgentId: 'agent_creator',
      childAgents: [
        {
          agentId: 'agent_child',
          publicationId: 'publication-1',
        },
      ],
    });
  });
});
