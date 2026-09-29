import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { EModelEndpoint, SkillsScope } from 'librechat-data-provider';
import type { IAgentCreatorPublication } from '..';
import { createAgentCreatorPublicationMethods } from './agentCreatorPublication';
import { createModels } from '../models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: MongoMemoryServer;
let AgentCreatorPublication: mongoose.Model<IAgentCreatorPublication>;
let methods: ReturnType<typeof createAgentCreatorPublicationMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  AgentCreatorPublication = mongoose.models
    .AgentCreatorPublication as mongoose.Model<IAgentCreatorPublication>;
  methods = createAgentCreatorPublicationMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await AgentCreatorPublication.deleteMany({});
});

describe('recordAgentCreatorPublication', () => {
  it('persists a plain publication DTO for a successful Creator publish', async () => {
    const recorded = await methods.recordAgentCreatorPublication({
      publicationId: 'pub-1',
      agentId: 'agent_1',
      createdBy: 'user-1',
      createdAt: '2026-09-28T12:00:00.000Z',
      source: 'agent_creator',
      specSnapshot: {
        name: 'Research helper',
        provider: EModelEndpoint.openAI,
        model: 'gpt-4o-mini',
        model_parameters: {
          temperature: null,
          maxContextTokens: null,
          max_context_tokens: null,
          max_output_tokens: null,
          top_p: null,
          frequency_penalty: null,
          presence_penalty: null,
        },
        skills: [{ id: 'skill-1', source: 'selected' }],
      },
      previewSnapshot: {
        name: 'Research helper',
        description: null,
        instructions: null,
        provider: EModelEndpoint.openAI,
        model: 'gpt-4o-mini',
        model_parameters: {
          temperature: null,
          maxContextTokens: null,
          max_context_tokens: null,
          max_output_tokens: null,
          top_p: null,
          frequency_penalty: null,
          presence_penalty: null,
        },
        skills: ['skill-1'],
        skills_enabled: true,
        skills_scope: SkillsScope.selected,
        skill_authoring_enabled: false,
      },
    });

    expect(recorded).toMatchObject({
      publicationId: 'pub-1',
      agentId: 'agent_1',
      createdBy: 'user-1',
      createdAt: '2026-09-28T12:00:00.000Z',
      source: 'agent_creator',
    });

    await expect(methods.getAgentCreatorPublicationByAgentId('agent_1')).resolves.toMatchObject({
      publicationId: 'pub-1',
      agentId: 'agent_1',
    });
  });
});
