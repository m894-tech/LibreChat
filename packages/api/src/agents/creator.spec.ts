import { EModelEndpoint, PermissionTypes, Permissions, SkillsScope } from 'librechat-data-provider';
import type { AgentCreatorSpec } from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';
import {
  createAgentCreatorAgentLookup,
  createAgentCreatorCreateHandler,
  createAgentCreatorPublishHandler,
  createCanonicalAgentCreatorInstructions,
  validateAgentCreatorSpec,
} from './creator';

const modelParameters = {
  temperature: null,
  maxContextTokens: null,
  max_context_tokens: null,
  max_output_tokens: null,
  top_p: null,
  frequency_penalty: null,
  presence_penalty: null,
};

const spec = (overrides: Partial<AgentCreatorSpec> = {}): AgentCreatorSpec => ({
  name: 'Research helper',
  provider: 'openAI',
  model: 'gpt-4o-mini',
  model_parameters: modelParameters,
  skills: [{ id: 'skill-1' }],
  ...overrides,
});

describe('validateAgentCreatorSpec', () => {
  it('fails closed when creator is disabled', async () => {
    const result = await validateAgentCreatorSpec({
      config: { enabled: false, maxDraftSkills: 10 },
      spec: spec(),
      lookupSkills: async () => [{ id: 'skill-1', accessible: true }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'creator_disabled' })]),
    );
  });

  it('defines canonical Agent Creator instructions for safe publish workflow', () => {
    const instructions = createCanonicalAgentCreatorInstructions();

    expect(instructions).toContain('Do not behave like a generic blank agent');
    expect(instructions).toContain('clarifying questions');
    expect(instructions).toContain('draft agent spec');
    expect(instructions).toContain('Show a readable preview');
    expect(instructions).toContain('Require explicit user confirmation before publishing');
    expect(instructions).toContain('remember the user\'s creator preferences');
    expect(instructions).toContain('child agents');
    expect(instructions).toContain('Recommend tools, skills, and models');
    expect(instructions).toContain('Publish safely');
  });

  it('projects valid selected skills to an agent create preview', async () => {
    const result = await validateAgentCreatorSpec({
      config: { enabled: true, maxDraftSkills: 10 },
      spec: spec(),
      lookupSkills: async () => [{ id: 'skill-1', accessible: true }],
    });

    expect(result).toMatchObject({
      valid: true,
      issues: [],
      preview: {
        name: 'Research helper',
        skills: ['skill-1'],
        skills_enabled: true,
        skills_scope: SkillsScope.selected,
        skill_authoring_enabled: false,
      },
    });
  });

  it('carries spec into the validation preview', async () => {
    const result = await validateAgentCreatorSpec({
      config: { enabled: true, maxDraftSkills: 10 },
      spec: spec({ spec: 'openai-mini' }),
      lookupSkills: async () => [{ id: 'skill-1', accessible: true }],
    });

    expect(result).toMatchObject({
      valid: true,
      preview: {
        spec: 'openai-mini',
      },
    });
  });

  it('rejects public search and authored skill acquisitions in R0', async () => {
    const result = await validateAgentCreatorSpec({
      config: {
        enabled: true,
        allowPublicSkillSearch: false,
        allowSkillAuthoring: false,
        maxDraftSkills: 10,
      },
      spec: spec({
        skills: [
          { id: 'public-skill', source: 'public' },
          { id: 'authored-skill', source: 'authored' },
        ],
      }),
      lookupSkills: async () => [
        { id: 'public-skill', accessible: true },
        { id: 'authored-skill', accessible: true },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.filter((item) => item.code === 'invalid_skill_source')).toHaveLength(2);
  });

  it('rejects public search and authored skill acquisitions in R0 even when future flags are enabled', async () => {
    const result = await validateAgentCreatorSpec({
      config: {
        enabled: true,
        allowPublicSkillSearch: true,
        allowSkillAuthoring: true,
        maxDraftSkills: 10,
      },
      spec: spec({
        skills: [
          { id: 'public-skill', source: 'public' },
          { id: 'authored-skill', source: 'authored' },
        ],
      }),
      lookupSkills: async () => [
        { id: 'public-skill', accessible: true },
        { id: 'authored-skill', accessible: true },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.filter((item) => item.code === 'invalid_skill_source')).toHaveLength(2);
  });

  it('enforces skill count and selected scope', async () => {
    const result = await validateAgentCreatorSpec({
      config: { enabled: true, maxDraftSkills: 1 },
      spec: spec({
        skills_scope: SkillsScope.all,
        skills: [{ id: 'skill-1' }, { id: 'skill-2' }],
      }),
      lookupSkills: async () => [
        { id: 'skill-1', accessible: true },
        { id: 'skill-2', accessible: true },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'skill_count_exceeded' }),
        expect.objectContaining({ code: 'unsupported_skills_scope' }),
      ]),
    );
  });

  it('rejects missing or inaccessible selected skills', async () => {
    const result = await validateAgentCreatorSpec({
      config: { enabled: true, maxDraftSkills: 10 },
      spec: spec({ skills: [{ id: 'missing' }, { id: 'blocked' }] }),
      lookupSkills: async () => [{ id: 'blocked', accessible: false }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'skill_not_found' }),
        expect.objectContaining({ code: 'skill_not_accessible' }),
      ]),
    );
  });

  it('rejects public sources and public-candidate ids even when public search is enabled', async () => {
    const lookupSkills = jest.fn(async () => [{ id: 'skill-1', accessible: true }]);
    const result = await validateAgentCreatorSpec({
      config: {
        enabled: true,
        allowPublicSkillSearch: true,
        allowSkillAuthoring: false,
        maxDraftSkills: 10,
      },
      spec: spec({
        skills: [
          { id: 'public-skill', source: 'public' },
          { id: 'public-candidate:github/example/research', source: 'selected' },
          { id: 'public-candidate:omitted-source' },
        ],
      }),
      lookupSkills,
    });

    expect(result.valid).toBe(false);
    expect(
      result.issues.filter((item) => item.code === 'invalid_skill_source').length,
    ).toBeGreaterThanOrEqual(3);
    expect(lookupSkills).toHaveBeenCalledWith(['public-skill']);
  });

  it('rejects drafted skills when skill authoring is disabled', async () => {
    const result = await validateAgentCreatorSpec({
      config: { enabled: true, allowSkillAuthoring: false, maxDraftSkills: 10 },
      spec: spec({
        draftedSkills: [
          {
            name: 'Draft one',
            description: 'Draft skill',
            body: 'Use this draft skill.',
          },
        ],
      }),
      lookupSkills: async () => [{ id: 'skill-1', accessible: true }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'skill_authoring_disabled' })]),
    );
  });

  it('accepts valid drafted skills when skill authoring is enabled', async () => {
    const result = await validateAgentCreatorSpec({
      config: { enabled: true, allowSkillAuthoring: true, maxDraftSkills: 10 },
      spec: spec({
        draftedSkills: [
          {
            name: 'Draft one',
            description: 'Draft skill',
            body: 'Use this draft skill.',
            allowedTools: ['web_search'],
          },
        ],
      }),
      lookupSkills: async () => [{ id: 'skill-1', accessible: true }],
    });

    expect(result).toMatchObject({
      valid: true,
      issues: [],
      preview: {
        skills: ['skill-1'],
        skills_enabled: true,
        skill_authoring_enabled: true,
      },
    });
  });

  it('counts selected and drafted skills against maxDraftSkills', async () => {
    const result = await validateAgentCreatorSpec({
      config: { enabled: true, allowSkillAuthoring: true, maxDraftSkills: 1 },
      spec: spec({
        draftedSkills: [
          {
            name: 'Draft one',
            description: 'Draft skill',
            body: 'Use this draft skill.',
          },
        ],
      }),
      lookupSkills: async () => [{ id: 'skill-1', accessible: true }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'skill_count_exceeded' })]),
    );
  });

  it('rejects alwaysApply and always-apply attempts on drafted skills', async () => {
    const result = await validateAgentCreatorSpec({
      config: { enabled: true, allowSkillAuthoring: true, maxDraftSkills: 10 },
      spec: spec({
        draftedSkills: [
          {
            name: 'Draft one',
            description: 'Draft skill',
            body: 'Use this draft skill.',
            alwaysApply: true,
          } as unknown as NonNullable<AgentCreatorSpec['draftedSkills']>[number],
          {
            name: 'Draft two',
            description: 'Draft skill',
            body: 'Use this draft skill.',
            frontmatter: { 'always-apply': true },
          },
          {
            name: 'Draft three',
            description: 'Draft skill',
            body: 'Use this draft skill.',
            frontmatter: { alwaysApply: true },
          },
          {
            name: 'Draft four',
            description: 'Draft skill',
            body: '---\nalways-apply: true\n---\nUse this draft skill.',
          },
        ],
      }),
      lookupSkills: async () => [{ id: 'skill-1', accessible: true }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.filter((item) => item.code === 'invalid_skill_draft')).toHaveLength(4);
  });

  it('rejects malformed drafted skill allowedTools entries', async () => {
    const result = await validateAgentCreatorSpec({
      config: { enabled: true, allowSkillAuthoring: true, maxDraftSkills: 10 },
      spec: spec({
        draftedSkills: [
          {
            name: 'Draft one',
            description: 'Draft skill',
            body: 'Use this draft skill.',
            allowedTools: ['web_search', ''],
          },
        ],
      }),
      lookupSkills: async () => [{ id: 'skill-1', accessible: true }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'invalid_skill_draft' })]),
    );
  });

  it('returns validation issues for malformed request bodies without throwing', async () => {
    const malformedBodies = [
      {},
      { name: null, provider: null, skills: null },
      { name: 'Bad skills', provider: EModelEndpoint.agents, skills: null },
      { name: 'Bad skills', provider: EModelEndpoint.agents, skills: 'skill-1' },
      { name: 'Bad skill item', provider: EModelEndpoint.agents, skills: [null] },
    ];

    await Promise.all(
      malformedBodies.map(async (body) => {
        const result = await validateAgentCreatorSpec({
          config: { enabled: true, maxDraftSkills: 10 },
          spec: body,
          lookupSkills: async () => [],
        });

        expect(result.valid).toBe(false);
        expect(result.preview).toBeUndefined();
        expect(result.issues.length).toBeGreaterThan(0);
      }),
    );
  });
});

function createMockResponse(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
}

function createPublishRequest(body: AgentCreatorSpec): ServerRequest {
  return {
    body,
    config: createCreatorConfig(),
    user: { id: 'user-1', role: 'USER' },
  } as unknown as ServerRequest;
}

function createCreatorConfig(): ServerRequest['config'] {
  return {
    endpoints: {
      agents: {
        creator: {
          enabled: true,
          allowPublicSkillSearch: false,
          allowSkillAuthoring: false,
          maxDraftSkills: 10,
          defaultSkillsScope: SkillsScope.selected,
        },
      },
    },
  } as ServerRequest['config'];
}

function createAgentCreatorRequest(body: { provider?: unknown; model?: unknown; spec?: unknown }): ServerRequest {
  return {
    body,
    config: createCreatorConfig(),
    user: { id: 'user-1', role: 'USER', tenantId: 'tenant-1' },
  } as unknown as ServerRequest;
}

function createAgentCreatorCreateHandlerTestDeps(createAgent: jest.Mock) {
  const upsertProfile = jest.fn(async () => ({
    creatorAgentId: 'agent_creator',
    createdBy: 'user-1',
    preferences: {},
    childAgents: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));

  return {
    handler: createAgentCreatorCreateHandler({ createAgent, upsertProfile }),
    upsertProfile,
  };
}

function createPublishHandler(
  createAgent: jest.Mock,
  recordPublication = jest.fn(),
  skillDeps: {
    createSkill?: jest.Mock;
    deleteAgent?: jest.Mock;
    deleteSkill?: jest.Mock;
    grantPermission?: jest.Mock;
    hasSkillCreatePermission?: jest.Mock;
    lookupCreatorAgent?: jest.Mock;
    rememberChild?: jest.Mock;
  } = {},
) {
  const createSkill =
    skillDeps.createSkill ??
    jest.fn(async () => ({ skill: { _id: { toString: () => 'created-skill-1' } } }));
  const deleteAgent = skillDeps.deleteAgent ?? jest.fn(async () => ({ deleted: true }));
  const deleteSkill = skillDeps.deleteSkill ?? jest.fn(async () => ({ deleted: true }));
  const grantPermission = skillDeps.grantPermission ?? jest.fn(async () => undefined);
  const hasSkillCreatePermission = skillDeps.hasSkillCreatePermission ?? jest.fn(async () => true);
  const lookupCreatorAgent =
    skillDeps.lookupCreatorAgent ??
    jest.fn(async (_req: ServerRequest, id: string) => ({ id, accessible: true }));
  const rememberChild = skillDeps.rememberChild;
  return {
    handler: createAgentCreatorPublishHandler({
      createAgent,
      createSkill,
      deleteAgent,
      deleteSkill,
      grantPermission,
      hasSkillCreatePermission,
      lookupCreatorAgent,
      recordPublication,
      findAccessibleResources: async () => ['skill-1'],
      withDeploymentSkillIds: (ids) => ids,
      getSkillDbMethods: () => ({
        getSkillById: async (id) => (id === 'skill-1' ? { id } : null),
      }),
      rememberChild,
    }),
    createSkill,
    deleteAgent,
    deleteSkill,
    grantPermission,
    hasSkillCreatePermission,
    lookupCreatorAgent,
    rememberChild,
    recordPublication,
  };
}

describe('createAgentCreatorCreateHandler', () => {
  it('creates a dedicated creator with canonical server-generated instructions', async () => {
    let createBody: unknown;
    const createAgent = jest.fn(async (request: ServerRequest) => {
      createBody = request.body;
      return { id: 'agent_creator', ...request.body };
    });
    const { handler, upsertProfile } = createAgentCreatorCreateHandlerTestDeps(createAgent);
    const req = createAgentCreatorRequest({ provider: 'openAI', model: 'gpt-4o-mini' });
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(createBody).toMatchObject({
      name: 'Agent Creator',
      description:
        'Dedicated Agent Creator that helps design, preview, validate, and safely publish reusable agents.',
      instructions: createCanonicalAgentCreatorInstructions(),
      provider: 'openAI',
      model: 'gpt-4o-mini',
      skills: [],
      skills_enabled: false,
      memory_scope: 'agent',
    });
    expect(upsertProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        creatorAgentId: 'agent_creator',
        createdBy: 'user-1',
        tenantId: 'tenant-1',
        preferences: expect.objectContaining({
          defaultProvider: 'openAI',
          defaultModel: 'gpt-4o-mini',
          defaultSkillsScope: SkillsScope.selected,
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects creation when enforced model specs have no selected compatible spec', async () => {
    const createAgent = jest.fn();
    const { handler } = createAgentCreatorCreateHandlerTestDeps(createAgent);
    const req = createAgentCreatorRequest({ provider: 'openAI', model: 'gpt-4o-mini' });
    req.config = {
      ...req.config,
      modelSpecs: {
        enforce: true,
        list: [
          {
            name: 'claude-spec',
            label: 'Claude Spec',
            preset: { endpoint: 'anthropic', model: 'claude-sonnet-5' },
          },
        ],
      },
    } as ServerRequest['config'];
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Agent Creator requires a matching model spec for the selected provider and model',
      }),
    );
    expect(createAgent).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects creation when the selected model spec is incompatible under enforcement', async () => {
    const createAgent = jest.fn();
    const { handler } = createAgentCreatorCreateHandlerTestDeps(createAgent);
    const req = createAgentCreatorRequest({
      provider: 'openAI',
      model: 'gpt-4o-mini',
      spec: 'claude-spec',
    });
    req.config = {
      ...req.config,
      modelSpecs: {
        enforce: true,
        list: [
          {
            name: 'claude-spec',
            label: 'Claude Spec',
            preset: { endpoint: 'anthropic', model: 'claude-sonnet-5' },
          },
        ],
      },
    } as ServerRequest['config'];
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Agent Creator selected model spec does not match the selected provider and model',
      }),
    );
    expect(createAgent).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('normalizes a compatible model spec into the created persistent Agent Creator', async () => {
    let createBody: unknown;
    const createAgent = jest.fn(async (request: ServerRequest) => {
      createBody = request.body;
      return { id: 'agent_creator', ...request.body };
    });
    const { handler } = createAgentCreatorCreateHandlerTestDeps(createAgent);
    const req = createAgentCreatorRequest({ provider: 'openAI', model: 'gpt-4o-mini' });
    req.config = {
      ...req.config,
      modelSpecs: {
        enforce: true,
        list: [
          {
            name: 'openai-mini',
            label: 'OpenAI Mini',
            preset: { endpoint: 'openAI', model: 'gpt-4o-mini' },
          },
        ],
      },
    } as ServerRequest['config'];
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(createBody).toMatchObject({
      provider: 'openAI',
      model: 'gpt-4o-mini',
      spec: 'openai-mini',
      instructions: createCanonicalAgentCreatorInstructions(),
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('createAgentCreatorAgentLookup', () => {
  it('requires an existing agent and view access before profile writes', async () => {
    const findAccessibleResources = jest.fn(async () => ['mongo-agent-id']);
    const getAgent = jest.fn(async () => ({ _id: { toString: () => 'mongo-agent-id' } }));
    const lookupCreatorAgent = createAgentCreatorAgentLookup({
      findAccessibleResources,
      withDeploymentSkillIds: (ids) => ids,
      getSkillDbMethods: () => ({ getSkillById: async () => null }),
      getAgent,
    });
    const req = createPublishRequest(spec());
    req.user = { ...req.user, tenantId: 'tenant-1' } as ServerRequest['user'];

    await expect(lookupCreatorAgent(req, 'agent_creator')).resolves.toEqual({
      id: 'agent_creator',
      accessible: true,
    });
    expect(getAgent).toHaveBeenCalledWith({ id: 'agent_creator', tenantId: 'tenant-1' });
    expect(findAccessibleResources).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'agent', requiredPermissions: 1 }),
    );
  });

  it('fails closed when the creator agent does not exist', async () => {
    const findAccessibleResources = jest.fn(async () => ['agent_creator']);
    const getAgent = jest.fn(async () => null);
    const lookupCreatorAgent = createAgentCreatorAgentLookup({
      findAccessibleResources,
      withDeploymentSkillIds: (ids) => ids,
      getSkillDbMethods: () => ({ getSkillById: async () => null }),
      getAgent,
    });

    await expect(
      lookupCreatorAgent(createPublishRequest(spec()), 'agent_creator'),
    ).resolves.toEqual({
      id: 'agent_creator',
      accessible: false,
    });
    expect(findAccessibleResources).not.toHaveBeenCalled();
  });
});

describe('createAgentCreatorPublishHandler', () => {
  it('returns 400 when creator is disabled and does not call createAgent', async () => {
    const createAgent = jest.fn();
    const { handler, recordPublication } = createPublishHandler(createAgent);
    const req = createPublishRequest(spec());
    req.config!.endpoints!.agents!.creator!.enabled = false;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: 'creator_disabled' })]),
      }),
    );
    expect(createAgent).not.toHaveBeenCalled();
    expect(recordPublication).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('does not call createAgent when skills include public-candidate ids', async () => {
    const createAgent = jest.fn();
    const { handler, recordPublication } = createPublishHandler(createAgent);
    const req = createPublishRequest(
      spec({
        skills: [{ id: 'public-candidate:github/example/research', source: 'selected' }],
      }),
    );
    req.config!.endpoints!.agents!.creator!.allowPublicSkillSearch = true;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: 'invalid_skill_source' })]),
      }),
    );
    expect(createAgent).not.toHaveBeenCalled();
    expect(recordPublication).not.toHaveBeenCalled();
  });

  it('returns 400 for inaccessible skills and does not call createAgent', async () => {
    const createAgent = jest.fn();
    const { handler, recordPublication } = createPublishHandler(createAgent);
    const req = createPublishRequest(spec({ skills: [{ id: 'blocked' }] }));
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        issues: expect.arrayContaining([expect.objectContaining({ code: 'skill_not_accessible' })]),
      }),
    );
    expect(createAgent).not.toHaveBeenCalled();
    expect(recordPublication).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('passes provenance-bearing body to createAgent, then records publication', async () => {
    let createBody: unknown;
    let createOptions: unknown;
    const createAgent = jest.fn((request: ServerRequest, _response: Response, options: object) => {
      createBody = request.body;
      createOptions = options;
      return Promise.resolve({ id: 'agent_created', ...request.body });
    });
    const { handler, recordPublication } = createPublishHandler(createAgent);
    const req = createPublishRequest(spec({ name: '  Research helper  ' }));
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(createBody).toMatchObject({
      name: 'Research helper',
      skills: ['skill-1'],
      skills_enabled: true,
      skills_scope: SkillsScope.selected,
      skill_authoring_enabled: false,
      creatorProvenance: {
        createdBy: 'user-1',
        source: 'agent_creator',
      },
    });
    expect(createOptions).toMatchObject({
      preparedAgentCreateData: { agentData: createBody },
    });
    expect(recordPublication).toHaveBeenCalledWith(
      expect.objectContaining({
        publicationId: expect.any(String),
        agentId: 'agent_created',
        createdBy: 'user-1',
        source: 'agent_creator',
        specSnapshot: expect.objectContaining({ name: '  Research helper  ' }),
        previewSnapshot: expect.objectContaining({
          name: 'Research helper',
          creatorProvenance: expect.objectContaining({ source: 'agent_creator' }),
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent_created',
        creatorProvenance: expect.objectContaining({ source: 'agent_creator' }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('persists the compatible model spec when publishing a child agent', async () => {
    let createBody: unknown;
    const createAgent = jest.fn((request: ServerRequest) => {
      createBody = request.body;
      return Promise.resolve({ id: 'agent_created', ...request.body });
    });
    const { handler } = createPublishHandler(createAgent);
    const req = createPublishRequest(spec({ spec: 'openai-mini' }));
    req.config = {
      ...req.config,
      modelSpecs: {
        enforce: true,
        list: [
          {
            name: 'openai-mini',
            label: 'OpenAI Mini',
            preset: { endpoint: 'openAI', model: 'gpt-4o-mini' },
          },
        ],
      },
    } as ServerRequest['config'];
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(createBody).toMatchObject({
      provider: 'openAI',
      model: 'gpt-4o-mini',
      spec: 'openai-mini',
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects publish when enforced model specs have no compatible spec', async () => {
    const createAgent = jest.fn();
    const { handler, recordPublication } = createPublishHandler(createAgent);
    const req = createPublishRequest(spec());
    req.config = {
      ...req.config,
      modelSpecs: {
        enforce: true,
        list: [
          {
            name: 'claude-spec',
            label: 'Claude Spec',
            preset: { endpoint: 'anthropic', model: 'claude-sonnet-5' },
          },
        ],
      },
    } as ServerRequest['config'];
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        valid: false,
        issues: expect.arrayContaining([expect.objectContaining({ path: 'spec' })]),
      }),
    );
    expect(createAgent).not.toHaveBeenCalled();
    expect(recordPublication).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('does not record publication when createAgent throws', async () => {
    const error = new Error('create failed');
    const createAgent = jest.fn(async () => {
      throw error;
    });
    const { handler, recordPublication } = createPublishHandler(createAgent);
    const originalBody = spec();
    const req = createPublishRequest(originalBody);
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(recordPublication).not.toHaveBeenCalled();
    expect(req.body).toBe(originalBody);
    expect(next).toHaveBeenCalledWith(error);
  });

  it('does not require SKILLS.CREATE for selected-skill-only publish', async () => {
    const createAgent = jest.fn((request: ServerRequest) =>
      Promise.resolve({ id: 'agent_created', ...request.body }),
    );
    const hasSkillCreatePermission = jest.fn(async () => false);
    const { handler } = createPublishHandler(createAgent, jest.fn(), { hasSkillCreatePermission });
    const req = createPublishRequest(spec());
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(hasSkillCreatePermission).not.toHaveBeenCalled();
    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('rejects drafted-skill publish without SKILLS.CREATE', async () => {
    const createAgent = jest.fn();
    const createSkill = jest.fn();
    const hasSkillCreatePermission = jest.fn(async () => false);
    const { handler } = createPublishHandler(createAgent, jest.fn(), {
      createSkill,
      hasSkillCreatePermission,
    });
    const req = createPublishRequest(
      spec({
        draftedSkills: [
          {
            name: 'Draft one',
            description: 'Draft skill',
            body: 'Use this draft skill.',
          },
        ],
      }),
    );
    req.config!.endpoints!.agents!.creator!.allowSkillAuthoring = true;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(hasSkillCreatePermission).toHaveBeenCalledWith({
      req,
      permissionType: PermissionTypes.SKILLS,
      permissions: [Permissions.USE, Permissions.CREATE],
    });
    expect(createSkill).not.toHaveBeenCalled();
    expect(createAgent).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('uses the normalized Mongo user id for authored skill owner ACL', async () => {
    const objectIdLike = { toString: () => '507f1f77bcf86cd799439011' };
    const createAgent = jest.fn((request: ServerRequest) =>
      Promise.resolve({ id: 'agent_created', ...request.body }),
    );
    const createSkill = jest.fn(async () => ({
      skill: { _id: { toString: () => 'created-skill-1' } },
    }));
    const { handler, grantPermission } = createPublishHandler(createAgent, jest.fn(), {
      createSkill,
    });
    const req = createPublishRequest(
      spec({
        draftedSkills: [
          {
            name: 'Draft one',
            description: 'Draft skill',
            body: 'Use this draft skill.',
          },
        ],
      }),
    );
    req.user = { ...req.user, id: 'external-user', _id: objectIdLike } as ServerRequest['user'];
    req.config!.endpoints!.agents!.creator!.allowSkillAuthoring = true;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(createSkill).toHaveBeenCalledWith(
      expect.objectContaining({ author: objectIdLike.toString() }),
    );
    expect(grantPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: objectIdLike.toString(),
        grantedBy: objectIdLike.toString(),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('creates private drafted skills and attaches their ids to the agent body', async () => {
    let createBody: unknown;
    const createAgent = jest.fn((request: ServerRequest) => {
      createBody = request.body;
      return Promise.resolve({ id: 'agent_created', ...request.body });
    });
    const createSkill = jest.fn(async () => ({
      skill: { _id: { toString: () => 'created-skill-1' } },
    }));
    const { handler, grantPermission } = createPublishHandler(createAgent, jest.fn(), {
      createSkill,
    });
    const req = createPublishRequest(
      spec({
        draftedSkills: [
          {
            name: 'Draft one',
            description: 'Draft skill',
            body: 'Use this draft skill.',
            allowedTools: ['web_search'],
          },
        ],
      }),
    );
    req.config!.endpoints!.agents!.creator!.allowSkillAuthoring = true;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(createSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Draft one',
        alwaysApply: false,
        frontmatter: expect.objectContaining({
          'always-apply': false,
          alwaysApply: false,
          'allowed-tools': ['web_search'],
        }),
        source: 'inline',
        sourceMetadata: { source: 'agent_creator' },
      }),
    );
    expect(grantPermission).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'skill', resourceId: 'created-skill-1' }),
    );
    expect(createBody).toMatchObject({
      skills: ['skill-1', 'created-skill-1'],
      skills_enabled: true,
      skill_authoring_enabled: false,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  it('cleans up created drafted skills when createAgent throws', async () => {
    const error = new Error('create failed');
    const createAgent = jest.fn(async () => {
      throw error;
    });
    const createSkill = jest.fn(async () => ({
      skill: { _id: { toString: () => 'created-skill-1' } },
    }));
    const deleteSkill = jest.fn(async () => ({ deleted: true }));
    const { handler } = createPublishHandler(createAgent, jest.fn(), { createSkill, deleteSkill });
    const req = createPublishRequest(
      spec({
        draftedSkills: [
          {
            name: 'Draft one',
            description: 'Draft skill',
            body: 'Use this draft skill.',
          },
        ],
      }),
    );
    req.config!.endpoints!.agents!.creator!.allowSkillAuthoring = true;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(deleteSkill).toHaveBeenCalledWith('created-skill-1');
    expect(next).toHaveBeenCalledWith(error);
  });

  it('cleans up earlier drafted skills when a later createSkill fails', async () => {
    const error = new Error('skill create failed');
    const createAgent = jest.fn();
    const createSkill = jest
      .fn()
      .mockResolvedValueOnce({ skill: { _id: { toString: () => 'created-skill-1' } } })
      .mockRejectedValueOnce(error);
    const deleteSkill = jest.fn(async () => ({ deleted: true }));
    const { handler } = createPublishHandler(createAgent, jest.fn(), { createSkill, deleteSkill });
    const req = createPublishRequest(
      spec({
        skills: [],
        draftedSkills: [
          {
            name: 'Draft one',
            description: 'Draft skill',
            body: 'Use this draft skill.',
          },
          {
            name: 'Draft two',
            description: 'Draft skill',
            body: 'Use this draft skill.',
          },
        ],
      }),
    );
    req.config!.endpoints!.agents!.creator!.allowSkillAuthoring = true;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(createAgent).not.toHaveBeenCalled();
    expect(deleteSkill).toHaveBeenCalledWith('created-skill-1');
    expect(next).toHaveBeenCalledWith(error);
  });

  it('cleans up created agent and drafted skills when publication recording fails', async () => {
    const error = new Error('publication failed');
    const createAgent = jest.fn((request: ServerRequest) =>
      Promise.resolve({ id: 'agent_created', ...request.body }),
    );
    const recordPublication = jest.fn(async () => {
      throw error;
    });
    const deleteAgent = jest.fn(async () => ({ deleted: true }));
    const createSkill = jest.fn(async () => ({
      skill: { _id: { toString: () => 'created-skill-1' } },
    }));
    const deleteSkill = jest.fn(async () => ({ deleted: true }));
    const { handler } = createPublishHandler(createAgent, recordPublication, {
      createSkill,
      deleteAgent,
      deleteSkill,
    });
    const originalBody = spec({
      draftedSkills: [
        {
          name: 'Draft one',
          description: 'Draft skill',
          body: 'Use this draft skill.',
        },
      ],
    });
    const req = createPublishRequest(originalBody);
    req.config!.endpoints!.agents!.creator!.allowSkillAuthoring = true;
    req.user = { ...req.user, tenantId: 'tenant-1' } as ServerRequest['user'];
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(createAgent).toHaveBeenCalledTimes(1);
    expect(recordPublication).toHaveBeenCalledTimes(1);
    expect(deleteAgent).toHaveBeenCalledWith({ id: 'agent_created', tenantId: 'tenant-1' });
    expect(deleteSkill).toHaveBeenCalledWith('created-skill-1');
    expect(res.status).not.toHaveBeenCalledWith(201);
    expect(req.body).toBe(originalBody);
    expect(next).toHaveBeenCalledWith(error);
  });

  it('rejects inaccessible creatorAgentId before creating the child agent', async () => {
    const createAgent = jest.fn();
    const rememberChild = jest.fn();
    const lookupCreatorAgent = jest.fn(async (_req: ServerRequest, id: string) => ({
      id,
      accessible: false,
    }));
    const { handler, recordPublication } = createPublishHandler(createAgent, jest.fn(), {
      lookupCreatorAgent,
      rememberChild,
    });
    const req = createPublishRequest({
      spec: spec(),
      creatorAgentId: 'agent_forbidden',
    } as unknown as AgentCreatorSpec);
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(lookupCreatorAgent).toHaveBeenCalledWith(req, 'agent_forbidden');
    expect(createAgent).not.toHaveBeenCalled();
    expect(recordPublication).not.toHaveBeenCalled();
    expect(rememberChild).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('remembers child only after verifying creatorAgentId accessibility', async () => {
    const createAgent = jest.fn((request: ServerRequest) =>
      Promise.resolve({ id: 'agent_created', ...request.body }),
    );
    const rememberChild = jest.fn(async () => ({ creatorAgentId: 'agent_creator' }));
    const lookupCreatorAgent = jest.fn(async (_req: ServerRequest, id: string) => ({
      id,
      accessible: true,
    }));
    const { handler } = createPublishHandler(createAgent, jest.fn(), {
      lookupCreatorAgent,
      rememberChild,
    });
    const req = createPublishRequest({
      spec: spec(),
      creatorAgentId: 'agent_creator',
    } as unknown as AgentCreatorSpec);
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res as Response, next);

    expect(lookupCreatorAgent).toHaveBeenCalledWith(req, 'agent_creator');
    expect(rememberChild).toHaveBeenCalledWith(
      expect.objectContaining({ creatorAgentId: 'agent_creator', createdBy: 'user-1' }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
