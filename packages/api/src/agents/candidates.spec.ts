import { AGENT_CREATOR_PUBLIC_CANDIDATE_ID_PREFIX } from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';
import {
  AGENT_CREATOR_PUBLIC_SKILL_SEARCH_MAX_LIMIT,
  createAgentCreatorPublicSkillSearchHandler,
  searchAgentCreatorPublicSkills,
} from './candidates';

function createMockResponse(): Response {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
}

describe('searchAgentCreatorPublicSkills', () => {
  it('rejects when creator public skill search is disabled', async () => {
    const searchPublicSkills = jest.fn();
    const result = await searchAgentCreatorPublicSkills({
      config: { enabled: true, allowPublicSkillSearch: false },
      body: { query: 'research' },
      searchPublicSkills,
    });

    expect(result.status).toBe(403);
    expect(searchPublicSkills).not.toHaveBeenCalled();
  });

  it('rejects an empty query without calling the provider', async () => {
    const searchPublicSkills = jest.fn();
    const result = await searchAgentCreatorPublicSkills({
      config: { enabled: true, allowPublicSkillSearch: true },
      body: { query: '   ' },
      searchPublicSkills,
    });

    expect(result.status).toBe(400);
    expect(searchPublicSkills).not.toHaveBeenCalled();
  });

  it('caps limit and normalizes provider results as untrusted non-attachable candidates', async () => {
    const searchPublicSkills = jest.fn(async () => [
      {
        providerId: 'github/example/research',
        name: ' Research helper ',
        description: 'Public candidate description',
        provider: 'github',
        repository: 'example/skills',
        path: 'research/SKILL.md',
        url: 'https://example.test/research',
        body: 'SECRET_BODY_SHOULD_NOT_LEAK',
        raw: { nested: true },
      },
    ]);

    const result = await searchAgentCreatorPublicSkills({
      config: { enabled: true, allowPublicSkillSearch: true },
      body: { query: 'research', limit: 100 },
      searchPublicSkills,
    });

    expect(searchPublicSkills).toHaveBeenCalledWith({
      query: 'research',
      limit: AGENT_CREATOR_PUBLIC_SKILL_SEARCH_MAX_LIMIT,
    });
    expect(result).toEqual({
      status: 200,
      body: {
        candidates: [
          {
            id: `${AGENT_CREATOR_PUBLIC_CANDIDATE_ID_PREFIX}github/example/research`,
            name: 'Research helper',
            description: 'Public candidate description',
            source: 'public',
            trusted: false,
            attachable: false,
            provider: 'github',
            repository: 'example/skills',
            path: 'research/SKILL.md',
            url: 'https://example.test/research',
          },
        ],
      },
    });
    expect(JSON.stringify(result.body)).not.toContain('SECRET_BODY_SHOULD_NOT_LEAK');
    expect(JSON.stringify(result.body)).not.toContain('nested');
  });

  it('calls the provider only when enabled and returns empty candidates from a noop provider', async () => {
    const searchPublicSkills = jest.fn(async () => []);
    const result = await searchAgentCreatorPublicSkills({
      config: { enabled: true, allowPublicSkillSearch: true },
      body: { query: 'research' },
      searchPublicSkills,
    });

    expect(searchPublicSkills).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 200, body: { candidates: [] } });
  });
});

describe('createAgentCreatorPublicSkillSearchHandler', () => {
  it('returns the search result status and body', async () => {
    const handler = createAgentCreatorPublicSkillSearchHandler({
      searchPublicSkills: async () => [],
    });
    const req = {
      body: { query: 'research' },
      config: {
        endpoints: {
          agents: {
            creator: {
              enabled: true,
              allowPublicSkillSearch: true,
            },
          },
        },
      },
    } as unknown as ServerRequest;
    const res = createMockResponse();
    const next = jest.fn() as NextFunction;

    await handler(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ candidates: [] });
    expect(next).not.toHaveBeenCalled();
  });
});
