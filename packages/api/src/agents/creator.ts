import { randomUUID } from 'node:crypto';
import {
  AccessRoleIds,
  AGENT_CREATOR_PUBLIC_CANDIDATE_ID_PREFIX,
  PermissionBits,
  Permissions,
  PermissionTypes,
  PrincipalType,
  removeNullishValues,
  ResourceType,
  SkillsScope as SkillScopes,
} from 'librechat-data-provider';
import type {
  Agent,
  AgentCreateParams,
  AgentCreatorAuthoredSkillDraft,
  AgentCreatorCreateRequest,
  AgentCreatorCreateResponse,
  AgentCreatorPreview,
  AgentCreatorProfile,
  AgentCreatorProvenance,
  AgentCreatorPublicationRecordInput,
  AgentCreatorSkillSpec,
  AgentCreatorSpec,
  AgentCreatorValidateResponse,
  AgentCreatorValidationIssue,
  SkillsScope,
  TAgentsEndpoint,
} from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';
import { normalizeToolResourceFiles } from './orphans';
import { parseSkillMarkdown } from '../skills/parse';
import { agentCreateSchema } from './validation';

export type AgentCreatorConfig = NonNullable<TAgentsEndpoint['creator']>;

export type AgentCreatorSkillLookupResult = {
  id: string;
  accessible: boolean;
};

export type AgentCreatorSkillLookup = (
  ids: readonly string[],
) => Promise<readonly AgentCreatorSkillLookupResult[]>;

export type ValidateAgentCreatorSpecParams = {
  config?: Partial<AgentCreatorConfig>;
  spec: unknown;
  lookupSkills: AgentCreatorSkillLookup;
};

export type AgentCreatorAccessibleResourceParams = {
  userId: string;
  role?: string;
  resourceType: ResourceType;
  requiredPermissions: PermissionBits;
};

export type AgentCreatorSkillDbMethods = {
  getSkillById: (id: string) => Promise<unknown | null | undefined>;
};

export type AgentCreatorCreatedSkill = {
  _id?: { toString(): string };
  id?: string;
};

export type AgentCreatorCreateSkillInput = {
  name: string;
  displayTitle?: string;
  description: string;
  body: string;
  frontmatter?: Record<string, unknown>;
  category?: string;
  alwaysApply: false;
  author: string;
  authorName: string;
  tenantId?: string;
  source: 'inline';
  sourceMetadata: { source: 'agent_creator' };
};

export type AgentCreatorCreateSkill = (data: AgentCreatorCreateSkillInput) => Promise<{
  skill: AgentCreatorCreatedSkill;
}>;

export type AgentCreatorDeleteSkill = (id: string) => Promise<unknown>;

export type AgentCreatorGrantPermission = (params: {
  principalType: PrincipalType;
  principalId: string;
  resourceType: ResourceType;
  resourceId: string;
  accessRoleId: AccessRoleIds;
  grantedBy: string;
}) => Promise<unknown>;

export type AgentCreatorSkillCreatePermission = (params: {
  req: ServerRequest;
  permissionType: PermissionTypes.SKILLS;
  permissions: [Permissions.USE, Permissions.CREATE];
}) => Promise<boolean>;

export type AgentCreatorHandlerDeps = {
  findAccessibleResources: (
    params: AgentCreatorAccessibleResourceParams,
  ) => Promise<readonly { toString(): string }[]>;
  withDeploymentSkillIds: (
    ids: readonly { toString(): string }[],
  ) => readonly { toString(): string }[] | Promise<readonly { toString(): string }[]>;
  getSkillDbMethods: () => AgentCreatorSkillDbMethods;
  getAgent?: AgentCreatorGetAgent;
};

export type AgentCreatorCreateAgentService = (
  req: ServerRequest,
  res: Response,
  options?: { preparedAgentCreateData?: PreparedAgentCreateData },
) => Promise<Agent | void>;

export type AgentCreatorLookupAgentRecord = {
  _id?: { toString(): string };
  id?: string;
};

export type AgentCreatorGetAgent = (search: {
  id: string;
  tenantId?: string;
}) => Promise<AgentCreatorLookupAgentRecord | null | undefined>;

export type AgentCreatorAgentLookupResult = {
  id: string;
  accessible: boolean;
};

export type AgentCreatorAgentLookup = (
  req: ServerRequest,
  id: string,
) => Promise<AgentCreatorAgentLookupResult>;

export type AgentCreatorRememberChild = (params: {
  creatorAgentId: string;
  createdBy: string;
  tenantId?: string;
  child: {
    agentId: string;
    name: string;
    publicationId: string;
    createdAt: string;
  };
}) => Promise<AgentCreatorProfile>;

export type AgentCreatorUpsertProfile = (profile: {
  creatorAgentId: string;
  createdBy: string;
  tenantId?: string;
  preferences?: {
    defaultProvider?: AgentCreatorCreateRequest['provider'];
    defaultModel?: string;
    defaultSkillsScope?: SkillsScope;
  };
}) => Promise<AgentCreatorProfile>;

export type AgentCreatorDeleteAgent = (search: {
  id: string;
  tenantId?: string;
}) => Promise<unknown>;

export type AgentCreatorPublishHandlerDeps = AgentCreatorHandlerDeps & {
  createAgent: AgentCreatorCreateAgentService;
  createSkill: AgentCreatorCreateSkill;
  deleteAgent: AgentCreatorDeleteAgent;
  deleteSkill: AgentCreatorDeleteSkill;
  grantPermission: AgentCreatorGrantPermission;
  hasSkillCreatePermission: AgentCreatorSkillCreatePermission;
  lookupCreatorAgent: AgentCreatorAgentLookup;
  recordPublication: (publication: AgentCreatorPublicationRecordInput) => Promise<unknown>;
  rememberChild?: AgentCreatorRememberChild;
};

export type AgentCreatorCreateHandlerDeps = {
  createAgent: AgentCreatorCreateAgentService;
  upsertProfile: AgentCreatorUpsertProfile;
};

type ParsedAgentCreatorSpec = {
  spec: AgentCreatorSpec;
  issues: AgentCreatorValidationIssue[];
};

const DEFAULT_CREATOR_CONFIG: AgentCreatorConfig = {
  enabled: false,
  allowPublicSkillSearch: false,
  allowSkillAuthoring: false,
  maxDraftSkills: 10,
  defaultSkillsScope: SkillScopes.selected,
};

const DEFAULT_MODEL_PARAMETERS: AgentCreatorSpec['model_parameters'] = {
  temperature: null,
  maxContextTokens: null,
  max_context_tokens: null,
  max_output_tokens: null,
  top_p: null,
  frequency_penalty: null,
  presence_penalty: null,
};

export const AGENT_CREATOR_NAME = 'Agent Creator';

export const AGENT_CREATOR_DESCRIPTION =
  'Dedicated Agent Creator that helps design, preview, validate, and safely publish reusable agents.';

export const AGENT_CREATOR_INSTRUCTIONS = `You are Agent Creator, a dedicated assistant for designing and safely publishing reusable LibreChat agents. Do not behave like a generic blank agent.

Your operating loop:
1. Start by asking concise clarifying questions when the user's goal, audience, tools, skills, model, memory needs, or safety constraints are ambiguous. Do not invent missing requirements silently.
2. Turn the answers into a draft agent spec with name, description, instructions, model/provider recommendation, model-parameter rationale, required tools, selected skills, memory scope, and child-agent relationships.
3. Recommend tools, skills, and models only when they fit the job. Explain tradeoffs briefly, prefer least-privilege tool access, and call out unsupported or risky requests.
4. Consider memory and preferences explicitly: remember the user's creator preferences, preserve the list of child agents you publish, and recommend whether each child agent should use shared user memory or agent-scoped memory.
5. Show a readable preview before any publish action, including instructions, tools, skills, model, memory behavior, and publish consequences.
6. Require explicit user confirmation before publishing, updating, or sharing any child agent. Validation is not confirmation.
7. Publish safely: avoid secrets in prompts, do not enable unnecessary tools or always-on skills, keep permissions private by default, and ask before making an agent available beyond the current user.
8. After publishing, summarize what was created, why the model/tools/skills were chosen, and what the user can test next.`;

export function createCanonicalAgentCreatorInstructions(): string {
  return AGENT_CREATOR_INSTRUCTIONS;
}

function issue(
  code: AgentCreatorValidationIssue['code'],
  message: string,
  path?: string,
): AgentCreatorValidationIssue {
  return path == null ? { code, message } : { code, message, path };
}

function resolveConfig(config: Partial<AgentCreatorConfig> | undefined): AgentCreatorConfig {
  return { ...DEFAULT_CREATOR_CONFIG, ...config };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function parseStringOrNull(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string') return value;
  return undefined;
}

type ModelSpecCandidate = {
  name?: string;
  preset?: {
    endpoint?: string | null;
    model?: string | null;
  } | null;
};

type ResolveRequiredModelSpecParams = {
  req: ServerRequest;
  provider: string;
  model: string;
  spec?: string | null;
};

function isCompatibleModelSpec(candidate: ModelSpecCandidate, provider: string, model: string): boolean {
  return candidate.preset?.endpoint === provider && candidate.preset.model === model;
}

function resolveRequiredModelSpec({
  req,
  provider,
  model,
  spec,
}: ResolveRequiredModelSpecParams): { spec?: string; error?: string } {
  const selectedSpec = typeof spec === 'string' && spec.trim().length > 0 ? spec.trim() : undefined;
  const modelSpecs = req.config?.modelSpecs;
  const specs = (modelSpecs?.list ?? []) as ModelSpecCandidate[];

  if (selectedSpec != null) {
    const matchedSpec = specs.find((candidate) => candidate.name === selectedSpec);
    if (matchedSpec == null) {
      return modelSpecs?.enforce === true
        ? { error: 'Agent Creator requires a selected model spec from the configured list' }
        : { spec: selectedSpec };
    }
    if (!isCompatibleModelSpec(matchedSpec, provider, model)) {
      return {
        error: 'Agent Creator selected model spec does not match the selected provider and model',
      };
    }
    return { spec: selectedSpec };
  }

  const compatibleSpec = specs.find((candidate) => isCompatibleModelSpec(candidate, provider, model));
  if (compatibleSpec?.name != null) {
    return { spec: compatibleSpec.name };
  }

  if (modelSpecs?.enforce === true) {
    return { error: 'Agent Creator requires a matching model spec for the selected provider and model' };
  }

  return {};
}

function parseSkill(
  value: unknown,
  index: number,
): {
  issue?: AgentCreatorValidationIssue;
  skill?: AgentCreatorSkillSpec;
} {
  if (!isRecord(value)) {
    return {
      issue: issue(
        'skill_not_selected',
        'Each selected skill must include a non-empty id',
        `skills.${index}`,
      ),
    };
  }

  const id = typeof value.id === 'string' ? value.id : '';
  const source = typeof value.source === 'string' ? value.source : undefined;
  return {
    skill: source == null ? { id } : { id, source: source as AgentCreatorSkillSpec['source'] },
  };
}

function isSkillFrontmatterValue(
  value: unknown,
): value is NonNullable<AgentCreatorAuthoredSkillDraft['frontmatter']>[string] {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isSkillFrontmatterValue);
  }
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(isSkillFrontmatterValue);
}

function parseFrontmatter(
  value: unknown,
  path: string,
): {
  frontmatter?: AgentCreatorAuthoredSkillDraft['frontmatter'];
  issue?: AgentCreatorValidationIssue;
} {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value) || !Object.values(value).every(isSkillFrontmatterValue)) {
    return {
      issue: issue('invalid_skill_draft', 'Draft skill frontmatter must be a JSON object', path),
    };
  }
  return { frontmatter: value as AgentCreatorAuthoredSkillDraft['frontmatter'] };
}

function parseOptionalString(
  value: unknown,
  path: string,
): {
  value?: string;
  issue?: AgentCreatorValidationIssue;
} {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'string') {
    return { issue: issue('invalid_skill_draft', 'Draft skill field must be a string', path) };
  }
  return { value };
}

function parseAllowedTools(
  value: unknown,
  path: string,
): {
  allowedTools?: string[];
  issue?: AgentCreatorValidationIssue;
} {
  if (value === undefined) {
    return {};
  }
  if (
    !Array.isArray(value) ||
    value.some((tool) => typeof tool !== 'string' || tool.trim().length === 0)
  ) {
    return {
      issue: issue(
        'invalid_skill_draft',
        'Draft skill allowedTools must be non-empty strings',
        path,
      ),
    };
  }
  return { allowedTools: Array.from(new Set(value.map((tool) => tool.trim()))) };
}

function parseAuthoredSkillDraft(
  value: unknown,
  index: number,
): {
  draft?: AgentCreatorAuthoredSkillDraft;
  issues: AgentCreatorValidationIssue[];
} {
  const issues: AgentCreatorValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      issues: [
        issue(
          'invalid_skill_draft',
          'Each drafted skill must be an object',
          `draftedSkills.${index}`,
        ),
      ],
    };
  }

  const name = typeof value.name === 'string' ? value.name : '';
  const description = typeof value.description === 'string' ? value.description : '';
  const body = typeof value.body === 'string' ? value.body : '';
  if (name.trim().length === 0) {
    issues.push(
      issue('invalid_skill_draft', 'Draft skill name is required', `draftedSkills.${index}.name`),
    );
  }
  if (description.trim().length === 0) {
    issues.push(
      issue(
        'invalid_skill_draft',
        'Draft skill description is required',
        `draftedSkills.${index}.description`,
      ),
    );
  }
  if (body.trim().length === 0) {
    issues.push(
      issue('invalid_skill_draft', 'Draft skill body is required', `draftedSkills.${index}.body`),
    );
  }

  const displayTitle = parseOptionalString(
    value.displayTitle,
    `draftedSkills.${index}.displayTitle`,
  );
  const category = parseOptionalString(value.category, `draftedSkills.${index}.category`);
  const frontmatter = parseFrontmatter(value.frontmatter, `draftedSkills.${index}.frontmatter`);
  const allowedTools = parseAllowedTools(value.allowedTools, `draftedSkills.${index}.allowedTools`);
  [displayTitle.issue, category.issue, frontmatter.issue, allowedTools.issue].forEach(
    (draftIssue) => {
      if (draftIssue != null) {
        issues.push(draftIssue);
      }
    },
  );

  if (value.alwaysApply === true) {
    issues.push(
      issue(
        'invalid_skill_draft',
        'Agent Creator authored skills cannot set alwaysApply',
        `draftedSkills.${index}.alwaysApply`,
      ),
    );
  }
  const bodyAlwaysApply = body.length > 0 ? parseSkillMarkdown(body).alwaysApply : undefined;
  if (bodyAlwaysApply === true) {
    issues.push(
      issue(
        'invalid_skill_draft',
        'Agent Creator authored skills cannot set always-apply body frontmatter',
        `draftedSkills.${index}.body`,
      ),
    );
  }
  if (
    frontmatter.frontmatter?.['always-apply'] === true ||
    frontmatter.frontmatter?.alwaysApply === true
  ) {
    issues.push(
      issue(
        'invalid_skill_draft',
        'Agent Creator authored skills cannot set always-apply frontmatter',
        `draftedSkills.${index}.frontmatter`,
      ),
    );
  }

  if (issues.length > 0) {
    return { issues };
  }

  return {
    issues: [],
    draft: {
      name: name.trim(),
      ...(displayTitle.value !== undefined && { displayTitle: displayTitle.value }),
      description: description.trim(),
      body,
      ...(frontmatter.frontmatter !== undefined && { frontmatter: frontmatter.frontmatter }),
      ...(category.value !== undefined && { category: category.value }),
      ...(allowedTools.allowedTools !== undefined && { allowedTools: allowedTools.allowedTools }),
    },
  };
}

function parseAgentCreatorSpec(input: unknown): ParsedAgentCreatorSpec {
  const issues: AgentCreatorValidationIssue[] = [];
  const body = isRecord(input) ? input : {};
  const rawSkills = body.skills;
  const rawDraftedSkills = body.draftedSkills;
  const skills: AgentCreatorSkillSpec[] = [];
  const draftedSkills: AgentCreatorAuthoredSkillDraft[] = [];

  if (!Array.isArray(rawSkills)) {
    issues.push(issue('skill_not_selected', 'Agent Creator requires a skills array', 'skills'));
  } else {
    rawSkills.forEach((rawSkill, index) => {
      const parsed = parseSkill(rawSkill, index);
      if (parsed.issue != null) {
        issues.push(parsed.issue);
        return;
      }
      if (parsed.skill != null) {
        skills.push(parsed.skill);
      }
    });
  }

  if (rawDraftedSkills !== undefined) {
    if (!Array.isArray(rawDraftedSkills)) {
      issues.push(issue('invalid_skill_draft', 'draftedSkills must be an array', 'draftedSkills'));
    } else {
      rawDraftedSkills.forEach((rawDraft, index) => {
        const parsed = parseAuthoredSkillDraft(rawDraft, index);
        issues.push(...parsed.issues);
        if (parsed.draft != null) {
          draftedSkills.push(parsed.draft);
        }
      });
    }
  }

  const name = typeof body.name === 'string' ? body.name : '';
  if (body.name !== undefined && typeof body.name !== 'string') {
    issues.push(issue('missing_required_field', 'Agent name is required', 'name'));
  }

  const provider = typeof body.provider === 'string' ? body.provider : '';
  if (body.provider !== undefined && typeof body.provider !== 'string') {
    issues.push(issue('missing_required_field', 'Agent provider is required', 'provider'));
  }

  const model = body.model === null || typeof body.model === 'string' ? body.model : null;
  const spec = parseStringOrNull(body.spec);
  const description = parseStringOrNull(body.description);
  const instructions = parseStringOrNull(body.instructions);
  const skillsScope =
    typeof body.skills_scope === 'string' ? (body.skills_scope as SkillsScope) : undefined;

  return {
    issues,
    spec: {
      name,
      ...(description !== undefined && { description }),
      ...(instructions !== undefined && { instructions }),
      provider,
      model,
      ...(spec !== undefined && { spec }),
      model_parameters: isRecord(body.model_parameters)
        ? ({
            ...DEFAULT_MODEL_PARAMETERS,
            ...body.model_parameters,
          } as AgentCreatorSpec['model_parameters'])
        : DEFAULT_MODEL_PARAMETERS,
      skills,
      ...(draftedSkills.length > 0 && { draftedSkills }),
      ...(skillsScope !== undefined && { skills_scope: skillsScope }),
    },
  };
}

function getSkillIds(skills: readonly AgentCreatorSkillSpec[]): string[] {
  return Array.from(new Set(skills.map((skill) => skill.id.trim()).filter((id) => id.length > 0)));
}

function validateRequiredFields(spec: AgentCreatorSpec): AgentCreatorValidationIssue[] {
  const issues: AgentCreatorValidationIssue[] = [];
  if (spec.name.trim().length === 0) {
    issues.push(issue('missing_required_field', 'Agent name is required', 'name'));
  }
  if (spec.provider == null || String(spec.provider).trim().length === 0) {
    issues.push(issue('missing_required_field', 'Agent provider is required', 'provider'));
  }
  if (spec.model == null || String(spec.model).trim().length === 0) {
    issues.push(issue('missing_required_field', 'Agent model is required', 'model'));
  }
  return issues;
}

function isPublicCandidateSkillId(id: string): boolean {
  return id.trim().startsWith(AGENT_CREATOR_PUBLIC_CANDIDATE_ID_PREFIX);
}

function validateSkillSources(
  skills: readonly AgentCreatorSkillSpec[],
): AgentCreatorValidationIssue[] {
  return skills.flatMap((skill, index) => {
    const issues: AgentCreatorValidationIssue[] = [];
    if (isPublicCandidateSkillId(skill.id)) {
      issues.push(
        issue(
          'invalid_skill_source',
          'Public skill candidates are untrusted metadata and cannot be attached',
          `skills.${index}.id`,
        ),
      );
    }

    const source = skill.source ?? 'selected';
    if (source !== 'selected') {
      issues.push(
        issue(
          'invalid_skill_source',
          'Agent Creator skills[] only accepts existing selected skills',
          `skills.${index}.source`,
        ),
      );
    }

    return issues;
  });
}

function validateSkillScope(scope: SkillsScope | undefined): AgentCreatorValidationIssue[] {
  if (scope == null || scope === SkillScopes.selected) {
    return [];
  }
  return [
    issue(
      'unsupported_skills_scope',
      'R0 Agent Creator only supports selected skill scope',
      'skills_scope',
    ),
  ];
}

function validateSkillAuthoring(
  drafts: readonly AgentCreatorAuthoredSkillDraft[] | undefined,
  config: AgentCreatorConfig,
): AgentCreatorValidationIssue[] {
  if ((drafts?.length ?? 0) === 0 || config.allowSkillAuthoring === true) {
    return [];
  }
  return [
    issue('skill_authoring_disabled', 'Agent Creator skill authoring is disabled', 'draftedSkills'),
  ];
}

function buildPreview(spec: AgentCreatorSpec, skillIds: string[]): AgentCreatorPreview {
  return {
    name: spec.name.trim(),
    description: spec.description ?? null,
    instructions: spec.instructions ?? null,
    provider: spec.provider,
    model: spec.model,
    spec: spec.spec ?? null,
    model_parameters: spec.model_parameters,
    skills: skillIds,
    skills_enabled: skillIds.length + (spec.draftedSkills?.length ?? 0) > 0,
    skills_scope: SkillScopes.selected,
    skill_authoring_enabled: (spec.draftedSkills?.length ?? 0) > 0,
  } satisfies AgentCreatorPreview;
}

export async function validateAgentCreatorSpec({
  config: rawConfig,
  spec: rawSpec,
  lookupSkills,
}: ValidateAgentCreatorSpecParams): Promise<AgentCreatorValidateResponse> {
  const config = resolveConfig(rawConfig);
  const parsed = parseAgentCreatorSpec(rawSpec);
  const spec = parsed.spec;
  const issues: AgentCreatorValidationIssue[] = [...parsed.issues];

  if (config.enabled !== true) {
    issues.push(issue('creator_disabled', 'Agent Creator is disabled'));
  }

  issues.push(...validateRequiredFields(spec));
  issues.push(...validateSkillSources(spec.skills));
  issues.push(...validateSkillScope(spec.skills_scope));
  issues.push(...validateSkillAuthoring(spec.draftedSkills, config));

  const requestedSkillCount = spec.skills.length + (spec.draftedSkills?.length ?? 0);
  if (requestedSkillCount > config.maxDraftSkills) {
    issues.push(
      issue(
        'skill_count_exceeded',
        `Agent Creator drafts may include at most ${config.maxDraftSkills} skills`,
        'skills',
      ),
    );
  }

  const skillIds = getSkillIds(spec.skills);
  if (skillIds.length !== spec.skills.length) {
    issues.push(
      issue('skill_not_selected', 'Each selected skill must include a non-empty id', 'skills'),
    );
  }

  const lookupIds = skillIds.filter((id) => !isPublicCandidateSkillId(id));
  if (lookupIds.length > 0) {
    const results = await lookupSkills(lookupIds);
    const resultById = new Map(results.map((result) => [result.id, result]));
    lookupIds.forEach((id) => {
      const result = resultById.get(id);
      if (result == null) {
        issues.push(issue('skill_not_found', `Selected skill does not exist: ${id}`, 'skills'));
        return;
      }
      if (result.accessible !== true) {
        issues.push(
          issue('skill_not_accessible', `Selected skill is not accessible: ${id}`, 'skills'),
        );
      }
    });
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return {
    valid: true,
    issues: [],
    preview: buildPreview(spec, skillIds),
  };
}

export type PrepareAgentCreateDataParams = {
  body: ServerRequest['body'];
  creatorProvenance?: AgentCreatorProvenance;
};

export type PreparedAgentCreateData = {
  tools: string[];
  agentData: Omit<Agent, 'tools'>;
};

export function prepareAgentCreateData({
  body,
  creatorProvenance,
}: PrepareAgentCreateDataParams): PreparedAgentCreateData {
  const bodyRecord = body as Partial<AgentCreateParams> & Pick<Agent, 'tool_resources'>;
  normalizeToolResourceFiles(bodyRecord.tool_resources);
  const validatedData = agentCreateSchema.parse(body);
  const { tools = [], ...agentData } = removeNullishValues(validatedData, true);
  const preparedAgentData = agentData as Omit<Agent, 'tools'>;
  return {
    tools,
    agentData:
      creatorProvenance == null ? preparedAgentData : { ...preparedAgentData, creatorProvenance },
  };
}

export function createAgentCreatorSkillLookup({
  findAccessibleResources,
  withDeploymentSkillIds,
  getSkillDbMethods,
}: AgentCreatorHandlerDeps) {
  return async function lookupCreatorSkills(
    req: ServerRequest,
    ids: readonly string[],
  ): Promise<readonly AgentCreatorSkillLookupResult[]> {
    const user = req.user;
    if (user == null) {
      return ids.map((id) => ({ id, accessible: false }));
    }
    const accessibleResources = await findAccessibleResources({
      userId: user.id,
      role: user.role,
      resourceType: ResourceType.SKILL,
      requiredPermissions: PermissionBits.VIEW,
    });
    const accessibleSkillIds = new Set(
      (await withDeploymentSkillIds(accessibleResources)).map((id) => id.toString()),
    );
    const skillDbMethods = getSkillDbMethods();
    return Promise.all(
      ids.map(async (id) => {
        const skill = await skillDbMethods.getSkillById(id);
        return { id, accessible: skill != null && accessibleSkillIds.has(id) };
      }),
    );
  };
}

export function createAgentCreatorAgentLookup({
  findAccessibleResources,
  getAgent,
}: AgentCreatorHandlerDeps): AgentCreatorAgentLookup {
  return async function lookupCreatorAgent(req: ServerRequest, id: string) {
    const user = req.user;
    if (user == null) {
      return { id, accessible: false };
    }
    const existingAgent = await getAgent?.({ id, tenantId: user.tenantId });
    if (existingAgent == null) {
      return { id, accessible: false };
    }
    const accessibleResources = await findAccessibleResources({
      userId: user.id,
      role: user.role,
      resourceType: ResourceType.AGENT,
      requiredPermissions: PermissionBits.VIEW,
    });
    return {
      id,
      accessible: accessibleResources.some(
        (resourceId) =>
          resourceId.toString() === id || resourceId.toString() === existingAgent._id?.toString(),
      ),
    };
  };
}

function getAgentCreatorPublishSpec(body: ServerRequest['body']): {
  spec: AgentCreatorSpec | unknown;
  creatorAgentId?: string;
} {
  const candidate = body as unknown;
  if (!isRecord(candidate) || !isRecord(candidate.spec)) {
    return { spec: body };
  }
  return {
    spec: candidate.spec,
    creatorAgentId:
      typeof candidate.creatorAgentId === 'string' ? candidate.creatorAgentId : undefined,
  };
}

export function createAgentCreatorCreateHandler({
  createAgent,
  upsertProfile,
}: AgentCreatorCreateHandlerDeps) {
  return async function createAgentCreator(
    req: ServerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const config = resolveConfig(req.config?.endpoints?.agents?.creator);
      if (!config.enabled) {
        return res.status(400).json({ error: 'Agent Creator is disabled' });
      }

      const userId = req.user?.id;
      if (userId == null) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const body = req.body as unknown;
      if (!isRecord(body) || typeof body.provider !== 'string' || typeof body.model !== 'string') {
        return res.status(400).json({ error: 'Agent Creator requires provider and model' });
      }

      const requestBody = body as AgentCreatorCreateRequest;
      const modelSpecResolution = resolveRequiredModelSpec({
        req,
        provider: requestBody.provider,
        model: requestBody.model,
        spec: requestBody.spec,
      });
      if (modelSpecResolution.error != null) {
        return res.status(400).json({ error: modelSpecResolution.error });
      }

      const originalBody = req.body;
      const createBody: AgentCreateParams = {
        name: AGENT_CREATOR_NAME,
        description: AGENT_CREATOR_DESCRIPTION,
        instructions: createCanonicalAgentCreatorInstructions(),
        provider: requestBody.provider,
        model: requestBody.model,
        ...(modelSpecResolution.spec != null && { spec: modelSpecResolution.spec }),
        model_parameters: DEFAULT_MODEL_PARAMETERS,
        tools: [],
        skills: [],
        skills_enabled: false,
        skill_authoring_enabled: config.allowSkillAuthoring,
        skills_scope: config.defaultSkillsScope,
        memory_scope: 'agent',
      };
      req.body = createBody as ServerRequest['body'];
      try {
        const agent = await createAgent(req, res);
        if (agent == null) {
          return;
        }
        const profile = await upsertProfile({
          creatorAgentId: agent.id,
          createdBy: userId,
          tenantId: req.user?.tenantId,
          preferences: {
            defaultProvider: requestBody.provider,
            defaultModel: requestBody.model,
            defaultSkillsScope: config.defaultSkillsScope,
          },
        });
        return res.status(201).json({ agent, profile } satisfies AgentCreatorCreateResponse);
      } finally {
        req.body = originalBody;
      }
    } catch (error) {
      return next(error);
    }
  };
}

export function createAgentCreatorValidateHandler(deps: AgentCreatorHandlerDeps) {
  const lookupSkills = createAgentCreatorSkillLookup(deps);
  return async function validateAgentCreator(
    req: ServerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const result = await validateAgentCreatorSpec({
        config: req.config?.endpoints?.agents?.creator,
        spec: req.body,
        lookupSkills: (ids) => lookupSkills(req, ids),
      });
      return res.status(result.valid ? 200 : 400).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

function getCreatedSkillId(skill: AgentCreatorCreatedSkill): string {
  return skill.id ?? skill._id?.toString() ?? '';
}

function toDraftSkillFrontmatter(draft: AgentCreatorAuthoredSkillDraft): Record<string, unknown> {
  return {
    ...(draft.frontmatter ?? {}),
    ...(draft.allowedTools !== undefined && { 'allowed-tools': draft.allowedTools }),
    'always-apply': false,
    alwaysApply: false,
  };
}

async function cleanupDraftSkills(
  deleteSkill: AgentCreatorDeleteSkill,
  skillIds: readonly string[],
) {
  await Promise.allSettled(skillIds.map((id) => deleteSkill(id)));
}

async function createAuthoredDraftSkills({
  drafts,
  req,
  createSkill,
  deleteSkill,
  grantPermission,
}: {
  drafts: readonly AgentCreatorAuthoredSkillDraft[];
  req: ServerRequest;
  createSkill: AgentCreatorCreateSkill;
  deleteSkill: AgentCreatorDeleteSkill;
  grantPermission: AgentCreatorGrantPermission;
}): Promise<string[]> {
  const user = req.user;
  if (user?.id == null) {
    throw new Error('Authenticated user is required to create Agent Creator skills');
  }
  const authorName = user.name ?? user.username ?? 'Unknown';
  const authorId = String(user._id ?? user.id);
  const createdSkillIds: string[] = [];

  try {
    for (const draft of drafts) {
      const result = await createSkill({
        name: draft.name,
        displayTitle: draft.displayTitle,
        description: draft.description,
        body: draft.body,
        frontmatter: toDraftSkillFrontmatter(draft),
        category: draft.category,
        alwaysApply: false,
        author: authorId,
        authorName,
        tenantId: user.tenantId,
        source: 'inline',
        sourceMetadata: { source: 'agent_creator' },
      });
      const skillId = getCreatedSkillId(result.skill);
      if (skillId.length === 0) {
        throw new Error('Created Agent Creator skill did not return an id');
      }
      createdSkillIds.push(skillId);
      await grantPermission({
        principalType: PrincipalType.USER,
        principalId: authorId,
        resourceType: ResourceType.SKILL,
        resourceId: skillId,
        accessRoleId: AccessRoleIds.SKILL_OWNER,
        grantedBy: authorId,
      });
    }
  } catch (error) {
    await cleanupDraftSkills(deleteSkill, createdSkillIds);
    throw error;
  }

  return createdSkillIds;
}

export function createAgentCreatorPublishHandler({
  createAgent,
  createSkill,
  deleteAgent,
  deleteSkill,
  grantPermission,
  hasSkillCreatePermission,
  lookupCreatorAgent,
  recordPublication,
  rememberChild,
  ...deps
}: AgentCreatorPublishHandlerDeps) {
  const lookupSkills = createAgentCreatorSkillLookup(deps);
  return async function publishAgentCreator(
    req: ServerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const publishRequest = getAgentCreatorPublishSpec(req.body);
      const result = await validateAgentCreatorSpec({
        config: req.config?.endpoints?.agents?.creator,
        spec: publishRequest.spec,
        lookupSkills: (ids) => lookupSkills(req, ids),
      });
      if (!result.valid || result.preview == null) {
        return res.status(400).json(result);
      }

      const userId = req.user?.id;
      if (userId == null) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const createdAt = new Date().toISOString();
      if (publishRequest.creatorAgentId != null && rememberChild != null) {
        const creatorAgent = await lookupCreatorAgent(req, publishRequest.creatorAgentId);
        if (!creatorAgent.accessible) {
          return res.status(403).json({ error: 'Creator agent is not accessible' });
        }
      }
      const publicationId = randomUUID();
      const creatorProvenance: AgentCreatorProvenance = {
        publicationId,
        createdBy: userId,
        createdAt,
        source: 'agent_creator',
      };
      const originalBody = req.body;
      const parsedSpec = parseAgentCreatorSpec(publishRequest.spec).spec;
      const draftedSkills = parsedSpec.draftedSkills ?? [];
      if (
        draftedSkills.length > 0 &&
        !(await hasSkillCreatePermission({
          req,
          permissionType: PermissionTypes.SKILLS,
          permissions: [Permissions.USE, Permissions.CREATE],
        }))
      ) {
        return res
          .status(403)
          .json({ error: 'Skill creation permission is required for drafted skills' });
      }
      const createdSkillIds = await createAuthoredDraftSkills({
        drafts: draftedSkills,
        req,
        createSkill,
        deleteSkill,
        grantPermission,
      });
      const modelSpecResolution = resolveRequiredModelSpec({
        req,
        provider: parsedSpec.provider,
        model: parsedSpec.model ?? '',
        spec: parsedSpec.spec ?? undefined,
      });
      if (modelSpecResolution.error != null) {
        await cleanupDraftSkills(deleteSkill, createdSkillIds);
        return res.status(400).json({
          valid: false,
          issues: [issue('missing_required_field', modelSpecResolution.error, 'spec')],
        });
      }
      const finalSkillIds = [...(result.preview.skills ?? []), ...createdSkillIds];
      const createBody: AgentCreateParams = {
        ...result.preview,
        provider: parsedSpec.provider,
        model: parsedSpec.model,
        ...(modelSpecResolution.spec != null && { spec: modelSpecResolution.spec }),
        skills: finalSkillIds,
        skills_enabled: finalSkillIds.length > 0,
        skill_authoring_enabled: false,
      };
      const preparedAgentCreateData = prepareAgentCreateData({
        body: createBody as ServerRequest['body'],
        creatorProvenance,
      });
      req.body = preparedAgentCreateData.agentData as ServerRequest['body'];
      let agent: Agent | void;
      try {
        try {
          agent = await createAgent(req, res, { preparedAgentCreateData });
        } catch (error) {
          await cleanupDraftSkills(deleteSkill, createdSkillIds);
          throw error;
        }
        if (agent == null) {
          await cleanupDraftSkills(deleteSkill, createdSkillIds);
          return;
        }
        try {
          await recordPublication({
            publicationId,
            agentId: agent.id,
            createdBy: userId,
            createdAt,
            source: 'agent_creator',
            specSnapshot: parsedSpec,
            previewSnapshot: preparedAgentCreateData.agentData,
          });
          if (publishRequest.creatorAgentId != null && rememberChild != null) {
            await rememberChild({
              creatorAgentId: publishRequest.creatorAgentId,
              createdBy: userId,
              tenantId: req.user?.tenantId,
              child: {
                agentId: agent.id,
                name: agent.name ?? preparedAgentCreateData.agentData.name ?? agent.id,
                publicationId,
                createdAt,
              },
            });
          }
        } catch (error) {
          await Promise.allSettled([
            deleteAgent({ id: agent.id, tenantId: req.user?.tenantId }),
            cleanupDraftSkills(deleteSkill, createdSkillIds),
          ]);
          throw error;
        }
        return res.status(201).json(agent);
      } finally {
        req.body = originalBody;
      }
    } catch (error) {
      return next(error);
    }
  };
}
