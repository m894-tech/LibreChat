import { randomUUID } from 'node:crypto';
import { logger } from '@librechat/data-schemas';
import { Constants, isEphemeralAgentId } from 'librechat-data-provider';
import type {
  TFile,
  TMessage,
  TContextConfiguration,
  TContextEstimateRequest,
  TContextIncompleteReason,
  TContextNextRequestEstimate,
} from 'librechat-data-provider';
import type { Run, IState, ContextUsageEvent } from '@librechat/agents';
import type { BaseMessage } from '@langchain/core/messages';
import type { EstimateSourceMessage } from './compose';
import type { EncodingName } from '~/utils/tokenizer';
import type { ServerRequest } from '~/types/http';
import { composeEstimateError, composeNextRequestEstimate } from './compose';
import { buildContextFingerprint, hashText, hashValue } from './fingerprint';
import { resolveRequestTenantId } from '~/middleware/tenant';
import { createMCPRuntimeRequestBody } from '~/mcp/request';
import { resolveContextEstimateConfig } from './config';
import { countFormattedMessageTokens } from '../client';
import { getSafeErrorMetadata } from '~/utils/errors';
import { createRun } from '../run';

type CreateRunParams = Parameters<typeof createRun>[0];
type RunAgent = CreateRunParams['agents'][number];
type RunGraph = NonNullable<Run<IState>['Graph']>;
/** The SDK's per-agent context; not exported from the root barrel, so derived from `Run`. */
export type EstimateAgentContext =
  RunGraph['agentContexts'] extends Map<string, infer Context> ? Context : never;
type ToolSurface = {
  toolDefinitions?: EstimateAgentContext['toolDefinitions'];
  toolRegistry?: EstimateAgentContext['toolRegistry'];
  tools?: EstimateAgentContext['tools'];
};

/** Fields of the initialized primary agent the estimate reads beyond `RunAgent`. */
export type EstimateAgent = RunAgent & {
  baseContextTokens?: number;
  requestAttachments?: TFile[];
  resendFiles?: boolean;
  manualSkillPrimes?: Array<{ name: string }>;
  alwaysApplySkillPrimes?: Array<{ name: string }>;
};

/** What `BaseClient.prepareTurnPrompt` resolves to (the JS client is duck-typed here). */
export type EstimateTurnPrompt = {
  payload: Array<Record<string, unknown>>;
  tokenCountMap: Record<string, number>;
  promptTokens: number;
  parentMessageId: string;
  userMessage: TMessage;
};

/** What `AgentClient.prepareGraphInput` resolves to. */
export type EstimateGraphInput = Pick<
  CreateRunParams,
  'indexTokenCountMap' | 'initialSessions' | 'tokenCounter'
> & {
  initialMessages: BaseMessage[];
  continuationSummary?: CreateRunParams['initialSummary'];
  continuationCompactionSemanticIndex?: CreateRunParams['compactionSemanticIndex'];
  runSeeds: Pick<CreateRunParams, 'calibrationRatio' | 'fadingTier' | 'fadingTiers'>;
};

export type EstimateTurnOptions = {
  user: string | null;
  conversationId?: string;
  parentMessageId: string;
  abortController: AbortController;
  /** Marks the turn as a dry run for subclasses that want to skip side channels. */
  isEstimate: true;
};

/**
 * The slice of `AgentClient` the dry run drives. Both methods are the exact
 * functions `sendMessage` → `chatCompletion` run before any model call, so the
 * estimate cannot diverge from Send's plan by construction.
 */
export interface EstimateAgentClient {
  options: {
    req: ServerRequest;
    agent: EstimateAgent;
    attachments?: unknown;
    resendFiles?: boolean;
    subagentTasks?: CreateRunParams['subagentTasks'];
    mcpRequestBody?: CreateRunParams['requestBody'];
  };
  agentConfigs?: Map<string, RunAgent>;
  currentMessages: TMessage[];
  prepareTurnPrompt(text: string, opts: EstimateTurnOptions): Promise<EstimateTurnPrompt>;
  prepareGraphInput(payload: EstimateTurnPrompt['payload']): Promise<EstimateGraphInput>;
  getEncoding(): EncodingName;
}

export type EstimateNextRequestParams = {
  req: ServerRequest;
  body: TContextEstimateRequest;
  client: EstimateAgentClient;
  signal: AbortSignal;
  /** Injectable for tests; defaults to the real `createRun`. */
  createRunFn?: typeof createRun;
  now?: () => number;
};

/** Identity of the local counting method; part of the fingerprint (§7 «версия tokenizer»). */
export const TOKEN_COUNTING_METHOD_VERSION = 1;

export function describeCountingMethod(encoding: EncodingName): string {
  const correction = encoding === 'claude' ? ':claude-corrected' : '';
  return `ai-tokenizer:${encoding}${correction}:v${TOKEN_COUNTING_METHOD_VERSION}`;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** R and W as `initializeAgent` resolved them: `baseContextTokens = W − R`. */
export function resolveAgentWindow(agent: EstimateAgent): {
  window: number | null;
  reserve: number;
} {
  const llm = (agent.model_parameters ?? {}) as Record<string, unknown>;
  const reserve = Math.round(
    toNumber(llm.maxOutputTokens) || toNumber(llm.maxTokens) || toNumber(llm.max_tokens),
  );
  const base = toNumber(agent.baseContextTokens);
  if (base > 0) {
    return { window: base + reserve, reserve };
  }
  const effective = toNumber(agent.maxContextTokens);
  return { window: effective > 0 ? effective + reserve : null, reserve };
}

function resolveConfiguration(agent: EstimateAgent, encoding: EncodingName): TContextConfiguration {
  const llm = (agent.model_parameters ?? {}) as Record<string, unknown>;
  const model = typeof llm.model === 'string' ? llm.model : (agent.model ?? undefined);
  return {
    endpoint: agent.endpoint ?? undefined,
    provider: agent.provider,
    model,
    agentId: isEphemeralAgentId(agent.id) ? null : agent.id,
    countingMethod: describeCountingMethod(encoding),
  };
}

function requestedFileIds(files: TContextEstimateRequest['files']): string[] {
  if (!Array.isArray(files)) {
    return [];
  }
  return files
    .map((file) => (file as Partial<TFile> | undefined)?.file_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/**
 * §4/§10.16: a file the client attached but the server has not finished
 * processing (not hydrated yet, or a text-delivered document without its
 * extracted text) makes the estimate incomplete rather than silently smaller.
 */
export function detectPendingAttachments(
  requestedIds: readonly string[],
  resolved: unknown,
): boolean {
  if (requestedIds.length === 0) {
    return false;
  }
  if (!Array.isArray(resolved)) {
    return true;
  }
  const byId = new Map<string, Partial<TFile> & { llmDeliveryPath?: string; source?: string }>();
  for (const file of resolved as Array<Partial<TFile> & { llmDeliveryPath?: string }>) {
    if (typeof file?.file_id === 'string') {
      byId.set(file.file_id, file);
    }
  }
  for (const id of requestedIds) {
    const file = byId.get(id);
    if (file == null) {
      return true;
    }
    const textDelivery = file.llmDeliveryPath === 'text' || file.source === 'text';
    if (textDelivery && (typeof file.text !== 'string' || file.text.length === 0)) {
      return true;
    }
  }
  return false;
}

/** MCP tools the agent lists but the loader produced no schema for (server down / not connected). */
export function detectPendingToolSchemas(
  requestedTools: readonly unknown[] | undefined,
  context: ToolSurface,
): boolean {
  const mcpRequested = (requestedTools ?? []).filter(
    (name): name is string => typeof name === 'string' && name.includes(Constants.mcp_delimiter),
  );
  if (mcpRequested.length === 0) {
    return false;
  }
  const loaded = new Set<string>();
  for (const def of context.toolDefinitions ?? []) {
    loaded.add(def.name);
  }
  for (const name of context.toolRegistry?.keys() ?? []) {
    loaded.add(name);
  }
  for (const tool of context.tools ?? []) {
    const name = (tool as { name?: unknown }).name;
    if (typeof name === 'string') {
      loaded.add(name);
    }
  }
  return !mcpRequested.some((name) => loaded.has(name));
}

function collectToolIds(context: EstimateAgentContext): string[] {
  const ids = new Set<string>();
  for (const def of context.toolDefinitions ?? []) {
    ids.add(def.name);
  }
  for (const tool of [...(context.tools ?? []), ...(context.graphTools ?? [])]) {
    const name = (tool as { name?: unknown }).name;
    if (typeof name === 'string') {
      ids.add(name);
    }
  }
  return [...ids];
}

function toSourceMessages(messages: readonly TMessage[], draftId: string): EstimateSourceMessage[] {
  return messages
    .filter((message) => message.messageId !== draftId)
    .map((message) => ({
      messageId: message.messageId,
      isCreatedByUser: message.isCreatedByUser,
      role: (message as TMessage & { role?: string }).role,
      text: message.text,
      content: message.content,
      tokenCount: message.tokenCount ?? undefined,
      createdAt: message.createdAt ?? undefined,
    }));
}

/** Raw tokens the draft's attachments (images, inline file context) add beyond its text. */
export function countDraftAttachmentTokens(
  draftPayload: Record<string, unknown> | undefined,
  draftText: string,
  encoding: EncodingName,
  hasAttachments: boolean,
): number {
  if (!hasAttachments || draftPayload == null) {
    return 0;
  }
  const full = countFormattedMessageTokens(draftPayload, encoding);
  const textOnly = countFormattedMessageTokens(
    { role: 'user', content: [{ type: 'text', text: draftText }] },
    encoding,
  );
  return Math.max(0, full - textOnly);
}

/**
 * §6 dry run of the next request. Runs Send's own plan — `prepareTurnPrompt`
 * (branch, files, `buildMessages`), `prepareGraphInput` (`formatAgentMessages`,
 * skill primes, token map), `createRun` (the exact `AgentInputs` the graph
 * would start from) — and then asks the SDK's `AgentContext.projectContextUsage`
 * for the pruned plan, which is the same `createPruneMessages` + budget math
 * the graph applies before its first model call. No model, tool, compression
 * or paid tokenizer is ever invoked; nothing is persisted.
 */
export async function estimateNextRequest(
  params: EstimateNextRequestParams,
): Promise<TContextNextRequestEstimate> {
  const { req, body, client, signal } = params;
  const now = params.now ?? Date.now;
  const createRunFn = params.createRunFn ?? createRun;
  const agent = client.options.agent;
  const encoding = client.getEncoding();
  const configuration = resolveConfiguration(agent, encoding);
  const branchLeafId = body.parentMessageId || Constants.NO_PARENT;
  const identity = {
    conversationId: body.conversationId ?? Constants.NEW_CONVO,
    branchLeafId,
  };
  const revision = Number.isFinite(body.revision) ? Number(body.revision) : 0;
  const draftText = typeof body.text === 'string' ? body.text : '';
  const fileIds = requestedFileIds(body.files);
  const config = resolveContextEstimateConfig(req.config);

  try {
    const abortController = new AbortController();
    signal.addEventListener('abort', () => abortController.abort(), { once: true });

    const turn = await client.prepareTurnPrompt(draftText, {
      user: req.user?.id ?? null,
      conversationId: body.conversationId ?? undefined,
      parentMessageId: branchLeafId,
      abortController,
      isEstimate: true,
    });
    const graph = await client.prepareGraphInput(turn.payload);
    const agents: RunAgent[] = [agent, ...(client.agentConfigs?.values() ?? [])];
    const runId = `estimate-${randomUUID()}`;
    const conversationId =
      body.conversationId ?? turn.userMessage.conversationId ?? Constants.NEW_CONVO;
    const run = await createRunFn({
      agents,
      signal,
      runId,
      conversationId,
      messages: graph.initialMessages,
      indexTokenCountMap: graph.indexTokenCountMap,
      initialSummary: graph.continuationSummary,
      compactionSemanticIndex: graph.continuationCompactionSemanticIndex,
      initialSessions: graph.initialSessions,
      tokenCounter: graph.tokenCounter,
      calibrationRatio: graph.runSeeds.calibrationRatio,
      fadingTier: graph.runSeeds.fadingTier,
      fadingTiers: graph.runSeeds.fadingTiers,
      summarizationConfig: req.config?.summarization,
      appConfig: req.config,
      user: req.user,
      tenantId: resolveRequestTenantId(req),
      requestBody:
        client.options.mcpRequestBody ??
        createMCPRuntimeRequestBody({
          messageId: runId,
          conversationId,
          parentMessageId: turn.parentMessageId,
        }),
      hitlCapable: true,
      subagentTasks: client.options.subagentTasks,
      streaming: false,
      streamUsage: false,
      centralTraceExportEnabled: false,
    });

    const context = run.Graph?.agentContexts.get(agent.id);
    if (context == null) {
      throw new Error(`Agent context not found for ${agent.id}`);
    }
    await context.tokenCalculationPromise;
    const usage: ContextUsageEvent | null = context.projectContextUsage(graph.initialMessages, {
      runId,
      agentId: agent.id,
      calibrationRatio: graph.runSeeds.calibrationRatio,
      indexTokenCountMap: graph.indexTokenCountMap,
    });

    const incompleteReasons: TContextIncompleteReason[] = [];
    if (detectPendingAttachments(fileIds, client.options.attachments)) {
      incompleteReasons.push('attachment_pending');
    }
    const requestedAgent = await Promise.resolve(req.body?.endpointOption?.agent).catch(
      () => undefined,
    );
    if (
      detectPendingToolSchemas(
        (requestedAgent as { tools?: unknown[] } | undefined)?.tools,
        context,
      )
    ) {
      incompleteReasons.push('tool_schemas_pending');
    }

    const { window, reserve } = resolveAgentWindow(agent);
    const sourceMessages = toSourceMessages(client.currentMessages, turn.userMessage.messageId);
    const fingerprint = buildContextFingerprint({
      configuration,
      window,
      reserve,
      inputLimit: null,
      instructionsHash: hashText(
        [context.instructions ?? '', context.additionalInstructions ?? ''].join('\n---\n'),
      ),
      toolIds: collectToolIds(context),
      skillIds: [
        ...(agent.manualSkillPrimes ?? []).map((skill) => skill.name),
        ...(agent.alwaysApplySkillPrimes ?? []).map((skill) => skill.name),
      ],
      assemblySettingsHash: hashValue({
        maxContextTokens: context.maxContextTokens,
        summarizationEnabled: context.summarizationEnabled,
        reserveRatio: context.summarizationConfig?.reserveRatio,
        contextPruning: context.contextPruningConfig,
        maxToolResultChars: context.maxToolResultChars,
        useLegacyContent: context.useLegacyContent,
        resendFiles: client.options.resendFiles,
      }),
      branchLeafId,
      historyRevision: hashValue(
        sourceMessages.map((message) => [
          message.messageId,
          message.tokenCount ?? null,
          (message as { updatedAt?: unknown }).updatedAt ?? null,
        ]),
      ),
      draftHash: hashText(draftText),
      attachmentIds: fileIds,
      summaryRevision: hashText(graph.continuationSummary?.text),
    });

    const draftPayload = turn.payload[turn.payload.length - 1];
    return composeNextRequestEstimate({
      identity,
      revision,
      fingerprint,
      computedAt: now(),
      configuration,
      window,
      outputReserve: reserve,
      usage,
      formattedMessages: graph.initialMessages,
      sourceMessages,
      draftAttachmentTokens: countDraftAttachmentTokens(
        draftPayload,
        draftText,
        encoding,
        fileIds.length > 0,
      ),
      summarizationEnabled: context.summarizationEnabled === true,
      incompleteReasons,
      maxExcludedPreviews: config.maxExcludedPreviews,
    });
  } catch (error) {
    logger.error('[contextEstimate] dry run failed', getSafeErrorMetadata(error));
    return composeEstimateError({
      identity,
      revision,
      computedAt: now(),
      configuration,
      errorCode: signal.aborted ? 'ESTIMATE_ABORTED' : 'ESTIMATE_FAILED',
    });
  }
}
