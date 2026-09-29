import { randomUUID } from 'node:crypto';
import type {
  CreateOrchestrationRunRequest,
  OrchMode,
  OrchRunView,
  OrchestrationRun,
  OrchestrationRunNode,
  TAgentsEndpoint,
} from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import type { ServerRequest } from '~/types/http';

export type OrchestrationConfig = NonNullable<TAgentsEndpoint['orchestration']>;

export type OrchestrationRunMethods = {
  createOrchestrationRun: (
    run: Omit<OrchestrationRun, 'createdAt' | 'updatedAt'>,
  ) => Promise<OrchestrationRun>;
  getLatestOrchestrationRun: (query: {
    conversationId: string;
    userId: string;
    tenantId?: string;
  }) => Promise<OrchestrationRun | null>;
  cancelOrchestrationRun: (query: {
    runId: string;
    userId: string;
    tenantId?: string;
  }) => Promise<OrchestrationRun | null>;
  getConvoOwnership?: (
    userId: string,
    conversationId: string,
    tenantId?: string | null,
  ) => Promise<unknown | null>;
};

type OrchestrationResult = {
  status: number;
  body: OrchRunView | { error: string };
};

type OrchestrationOwner = {
  userId: string;
  tenantId?: string;
};

const DEFAULT_ALLOWED_MODES: Array<Exclude<OrchMode, 'off'>> = [
  'auto',
  'team',
  'm2',
  'm3',
  'compare',
];

const DEFAULT_ORCHESTRATION_CONFIG: OrchestrationConfig = {
  enabled: false,
  allowedModes: DEFAULT_ALLOWED_MODES,
  maxNodesPerRun: 16,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function resolveConfig(config: Partial<OrchestrationConfig> | undefined): OrchestrationConfig {
  return { ...DEFAULT_ORCHESTRATION_CONFIG, ...config };
}

function isAllowedMode(value: unknown): value is Exclude<OrchMode, 'off'> {
  return typeof value === 'string' && (DEFAULT_ALLOWED_MODES as string[]).includes(value);
}

function toView(run: OrchestrationRun): OrchRunView {
  return {
    runId: run.runId,
    conversationId: run.conversationId,
    requestedMode: run.requestedMode,
    resolvedMode: run.resolvedMode,
    scheduler: run.scheduler,
    state: run.state,
    nodes: run.nodes,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function parseCreateRequest(body: unknown): {
  request?: CreateOrchestrationRunRequest;
  error?: string;
} {
  if (!isRecord(body)) {
    return { error: 'Request body must be an object' };
  }
  if (typeof body.conversationId !== 'string' || body.conversationId.trim().length === 0) {
    return { error: 'conversationId must be a non-empty string' };
  }
  if (typeof body.mode !== 'string') {
    return { error: 'mode must be a string' };
  }
  return {
    request: {
      conversationId: body.conversationId.trim(),
      mode: body.mode as OrchMode,
    },
  };
}

export function planNodesForMode(
  mode: Exclude<OrchMode, 'off'>,
  options: { maxNodesPerRun: number } = {
    maxNodesPerRun: DEFAULT_ORCHESTRATION_CONFIG.maxNodesPerRun,
  },
): OrchestrationRunNode[] {
  const nodesByMode: Record<Exclude<OrchMode, 'off'>, OrchestrationRunNode[]> = {
    auto: [{ id: 'auto', state: 'pending', cls: 'auto' }],
    m2: [{ id: 'm2', state: 'pending', cls: 'm2' }],
    team: [
      { id: 'planner', state: 'pending', cls: 'planner' },
      { id: 'member-1', state: 'pending', cls: 'member', dependsOn: ['planner'] },
      { id: 'member-2', state: 'pending', cls: 'member', dependsOn: ['planner'] },
      { id: 'accept', state: 'pending', cls: 'acceptor', dependsOn: ['member-1', 'member-2'] },
    ],
    m3: [
      { id: 'planner', state: 'pending', cls: 'planner' },
      { id: 'worker', state: 'pending', cls: 'worker', dependsOn: ['planner'] },
      { id: 'reviewer', state: 'pending', cls: 'reviewer', dependsOn: ['worker'] },
    ],
    compare: [
      { id: 'candidate-a', state: 'pending', cls: 'candidate' },
      { id: 'candidate-b', state: 'pending', cls: 'candidate' },
    ],
  };
  return nodesByMode[mode].slice(0, options.maxNodesPerRun);
}

function getOwner(req: ServerRequest): OrchestrationOwner | null {
  const userId = req.user?.id;
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    return null;
  }
  const tenantId = typeof req.user?.tenantId === 'string' ? req.user.tenantId : undefined;
  return { userId: userId.trim(), ...(tenantId != null && { tenantId }) };
}

export async function createManualOrchestrationRun({
  body,
  config,
  owner,
  methods,
}: {
  body: unknown;
  config?: Partial<OrchestrationConfig>;
  owner: OrchestrationOwner;
  methods: Pick<OrchestrationRunMethods, 'createOrchestrationRun' | 'getConvoOwnership'>;
}): Promise<OrchestrationResult> {
  const resolvedConfig = resolveConfig(config);
  if (!resolvedConfig.enabled) {
    return { status: 403, body: { error: 'orchestration is disabled' } };
  }

  const parsed = parseCreateRequest(body);
  if (parsed.error != null || parsed.request == null) {
    return { status: 400, body: { error: parsed.error ?? 'invalid request' } };
  }
  if (parsed.request.mode === 'off' || !isAllowedMode(parsed.request.mode)) {
    return { status: 400, body: { error: 'mode is not supported' } };
  }
  if (!resolvedConfig.allowedModes.includes(parsed.request.mode)) {
    return { status: 403, body: { error: 'mode is not allowed' } };
  }

  const nodes = planNodesForMode(parsed.request.mode, {
    maxNodesPerRun: resolvedConfig.maxNodesPerRun,
  });
  if (nodes.length === 0) {
    return { status: 400, body: { error: 'mode produced no runnable nodes' } };
  }

  if (methods.getConvoOwnership != null) {
    const conversation = await methods.getConvoOwnership(
      owner.userId,
      parsed.request.conversationId,
      owner.tenantId ?? null,
    );
    if (conversation == null) {
      return { status: 404, body: { error: 'conversation not found' } };
    }
  }

  const run = await methods.createOrchestrationRun({
    runId: randomUUID(),
    conversationId: parsed.request.conversationId,
    userId: owner.userId,
    ...(owner.tenantId != null && { tenantId: owner.tenantId }),
    requestedMode: parsed.request.mode,
    resolvedMode: parsed.request.mode,
    scheduler: 'manual',
    state: 'pending',
    nodes,
  });
  return { status: 201, body: toView(run) };
}

export async function getLatestManualOrchestrationRun({
  conversationId,
  owner,
  methods,
}: {
  conversationId: string;
  owner: OrchestrationOwner;
  methods: Pick<OrchestrationRunMethods, 'getLatestOrchestrationRun'>;
}): Promise<OrchestrationResult> {
  const run = await methods.getLatestOrchestrationRun({
    conversationId,
    userId: owner.userId,
    ...(owner.tenantId != null && { tenantId: owner.tenantId }),
  });
  return run == null
    ? { status: 404, body: { error: 'not found' } }
    : { status: 200, body: toView(run) };
}

export async function cancelManualOrchestrationRun({
  runId,
  owner,
  methods,
}: {
  runId: string;
  owner: OrchestrationOwner;
  methods: Pick<OrchestrationRunMethods, 'cancelOrchestrationRun'>;
}): Promise<OrchestrationResult> {
  const run = await methods.cancelOrchestrationRun({
    runId,
    userId: owner.userId,
    ...(owner.tenantId != null && { tenantId: owner.tenantId }),
  });
  return run == null
    ? { status: 404, body: { error: 'not found' } }
    : { status: 200, body: toView(run) };
}

function getConversationIdParam(req: ServerRequest): string {
  const params = isRecord(req.params) ? req.params : {};
  const conversationId = params.conversationId;
  return typeof conversationId === 'string' ? conversationId : '';
}

function getRunIdParam(req: ServerRequest): string {
  const params = isRecord(req.params) ? req.params : {};
  const runId = params.runId;
  return typeof runId === 'string' ? runId : '';
}

export function createManualOrchestrationRunHandler(methods: OrchestrationRunMethods) {
  return async function manualOrchestrationRunHandler(
    req: ServerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const owner = getOwner(req);
      if (owner == null) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const result = await createManualOrchestrationRun({
        body: req.body,
        config: req.config?.endpoints?.agents?.orchestration,
        owner,
        methods,
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  };
}

export function createGetLatestOrchestrationRunHandler(methods: OrchestrationRunMethods) {
  return async function getLatestOrchestrationRunHandler(
    req: ServerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const owner = getOwner(req);
      if (owner == null) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const result = await getLatestManualOrchestrationRun({
        conversationId: getConversationIdParam(req),
        owner,
        methods,
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  };
}

export function createCancelOrchestrationRunHandler(methods: OrchestrationRunMethods) {
  return async function cancelOrchestrationRunHandler(
    req: ServerRequest,
    res: Response,
    next: NextFunction,
  ): Promise<Response | void> {
    try {
      const owner = getOwner(req);
      if (owner == null) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      const result = await cancelManualOrchestrationRun({
        runId: getRunIdParam(req),
        owner,
        methods,
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return next(error);
    }
  };
}
