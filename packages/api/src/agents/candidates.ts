import { AGENT_CREATOR_PUBLIC_CANDIDATE_ID_PREFIX, SkillsScope } from 'librechat-data-provider';
import type {
  AgentCreatorPublicSkillCandidate,
  AgentCreatorPublicSkillSearchRequest,
  AgentCreatorPublicSkillSearchResponse,
} from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import type { AgentCreatorConfig } from './creator';
import type { ServerRequest } from '~/types/http';

export type AgentCreatorPublicSkillProviderResult = {
  name: string;
  description?: string;
  provider?: string;
  repository?: string;
  path?: string;
  url?: string;
  /** Opaque provider-local identity used only to build a candidate id. */
  providerId: string;
};

export type AgentCreatorPublicSkillSearchProvider = (params: {
  query: string;
  limit: number;
}) => Promise<readonly AgentCreatorPublicSkillProviderResult[]>;

export type AgentCreatorPublicSkillSearchHandlerDeps = {
  searchPublicSkills: AgentCreatorPublicSkillSearchProvider;
};

const DEFAULT_CREATOR_CONFIG: AgentCreatorConfig = {
  enabled: false,
  allowPublicSkillSearch: false,
  allowSkillAuthoring: false,
  maxDraftSkills: 10,
  defaultSkillsScope: SkillsScope.selected,
};

export const AGENT_CREATOR_PUBLIC_SKILL_SEARCH_DEFAULT_LIMIT = 10;
export const AGENT_CREATOR_PUBLIC_SKILL_SEARCH_MAX_LIMIT = 25;

function resolveConfig(config: Partial<AgentCreatorConfig> | undefined): AgentCreatorConfig {
  return { ...DEFAULT_CREATOR_CONFIG, ...config };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function parseSearchRequest(input: unknown): {
  request?: AgentCreatorPublicSkillSearchRequest;
  error?: string;
} {
  if (!isRecord(input)) {
    return { error: 'Request body must be an object' };
  }

  if (typeof input.query !== 'string') {
    return { error: 'query must be a string' };
  }

  const query = input.query.trim();
  if (query.length === 0) {
    return { error: 'query must be a non-empty string' };
  }

  let limit = AGENT_CREATOR_PUBLIC_SKILL_SEARCH_DEFAULT_LIMIT;
  if (input.limit !== undefined) {
    if (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1) {
      return { error: 'limit must be a positive integer' };
    }
    limit = Math.min(input.limit, AGENT_CREATOR_PUBLIC_SKILL_SEARCH_MAX_LIMIT);
  }

  return { request: { query, limit } };
}

function normalizeCandidate(
  result: AgentCreatorPublicSkillProviderResult,
): AgentCreatorPublicSkillCandidate {
  const providerId = result.providerId.trim();
  return {
    id: `${AGENT_CREATOR_PUBLIC_CANDIDATE_ID_PREFIX}${providerId}`,
    name: result.name.trim(),
    ...(result.description != null && { description: result.description }),
    source: 'public',
    trusted: false,
    attachable: false,
    ...(result.provider != null && { provider: result.provider }),
    ...(result.repository != null && { repository: result.repository }),
    ...(result.path != null && { path: result.path }),
    ...(result.url != null && { url: result.url }),
  };
}

/**
 * Safe first provider: establishes the injection contract without performing
 * network fetches or returning attachable skills.
 */
export const noopAgentCreatorPublicSkillSearchProvider: AgentCreatorPublicSkillSearchProvider =
  async () => [];

export async function searchAgentCreatorPublicSkills({
  config: rawConfig,
  body,
  searchPublicSkills,
}: {
  config?: Partial<AgentCreatorConfig>;
  body: unknown;
  searchPublicSkills: AgentCreatorPublicSkillSearchProvider;
}): Promise<
  | { status: 200; body: AgentCreatorPublicSkillSearchResponse }
  | { status: 400 | 403; body: { error: string } }
> {
  const config = resolveConfig(rawConfig);
  if (config.enabled !== true || config.allowPublicSkillSearch !== true) {
    return { status: 403, body: { error: 'Agent Creator public skill search is disabled' } };
  }

  const parsed = parseSearchRequest(body);
  if (parsed.request == null) {
    return { status: 400, body: { error: parsed.error ?? 'Invalid request' } };
  }

  const results = await searchPublicSkills({
    query: parsed.request.query,
    limit: parsed.request.limit ?? AGENT_CREATOR_PUBLIC_SKILL_SEARCH_DEFAULT_LIMIT,
  });

  const candidates = results
    .filter((result) => result.providerId.trim().length > 0 && result.name.trim().length > 0)
    .slice(0, parsed.request.limit ?? AGENT_CREATOR_PUBLIC_SKILL_SEARCH_DEFAULT_LIMIT)
    .map(normalizeCandidate);

  return { status: 200, body: { candidates } };
}

export function createAgentCreatorPublicSkillSearchHandler(
  deps: AgentCreatorPublicSkillSearchHandlerDeps,
) {
  return async function searchAgentCreatorPublicSkillsHandler(
    req: ServerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const result = await searchAgentCreatorPublicSkills({
        config: req.config?.endpoints?.agents?.creator,
        body: req.body,
        searchPublicSkills: deps.searchPublicSkills,
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  };
}
