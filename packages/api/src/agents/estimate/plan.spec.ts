import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { Constants } from 'librechat-data-provider';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import type { ContextUsageEvent, SummarizeStartEvent, TokenCounter } from '@librechat/agents';
import type { TMessage, TContextEstimateRequest } from 'librechat-data-provider';
import type { BaseMessage } from '@langchain/core/messages';
import type { AppConfig } from '@librechat/data-schemas';
import type { EstimateAgentClient, EstimateAgent } from './estimate';
import type { ServerRequest } from '~/types/http';

jest.mock('winston', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  })),
  format: Object.assign(
    jest.fn((fn) => () => ({ transform: fn })),
    {
      combine: jest.fn(),
      colorize: jest.fn(),
      simple: jest.fn(),
      label: jest.fn(),
      timestamp: jest.fn(),
      printf: jest.fn(),
      errors: jest.fn(),
      splat: jest.fn(),
      json: jest.fn(),
    },
  ),
  addColors: jest.fn(),
  transports: {
    Console: jest.fn(),
    DailyRotateFile: jest.fn(),
    File: jest.fn(),
  },
}));

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

import { GraphEvents, FakeChatModel } from '@librechat/agents';
import { estimateNextRequest } from './estimate';
import { createRun } from '~/agents/run';

/**
 * Deterministic counter shared by both sides, mirroring the shape of the
 * real `createCachedTokenCounter` output: text length + framing.
 */
const charCounter: TokenCounter = (message: BaseMessage): number => {
  const content = message.content;
  if (typeof content === 'string') {
    return content.length + 3;
  }
  if (Array.isArray(content)) {
    let length = 3;
    for (const part of content) {
      if (typeof part === 'string') {
        length += part.length;
      } else if (typeof (part as { text?: unknown })?.text === 'string') {
        length += (part as { text: string }).text.length;
      }
    }
    return length;
  }
  return 3;
};

const addTool = tool(async ({ a, b }: { a: number; b: number }) => String(a + b), {
  name: 'add',
  description: 'Add two numbers',
  schema: z.object({ a: z.number(), b: z.number() }),
});

const MAX_CONTEXT_TOKENS = 900;
const OUTPUT_RESERVE = 100;

function makeAgent(overrides: Partial<EstimateAgent> = {}): EstimateAgent {
  return {
    id: 'agent_estimate',
    name: 'Estimate Agent',
    provider: 'openAI',
    endpoint: 'openAI',
    model: 'gpt-4o',
    instructions: 'You are a helpful assistant. Answer briefly.',
    tools: [addTool],
    model_parameters: { model: 'gpt-4o', maxOutputTokens: OUTPUT_RESERVE },
    maxContextTokens: MAX_CONTEXT_TOKENS,
    baseContextTokens: MAX_CONTEXT_TOKENS,
    toolContextMap: {},
    ...overrides,
  } as unknown as EstimateAgent;
}

/** A branch of alternating user/assistant rows; the last one is the draft. */
function makeBranch(turns: number, fill: number) {
  const rows: TMessage[] = [];
  const formatted: BaseMessage[] = [];
  const indexTokenCountMap: Record<string, number> = {};
  for (let i = 0; i < turns; i++) {
    const userId = `u${i}`;
    const userText = `question ${i} ${'q'.repeat(fill)}`;
    rows.push({
      messageId: userId,
      parentMessageId: i === 0 ? Constants.NO_PARENT : `a${i - 1}`,
      conversationId: 'c1',
      isCreatedByUser: true,
      text: userText,
      tokenCount: userText.length + 3,
    } as TMessage);
    formatted.push(
      new HumanMessage({ content: userText, additional_kwargs: { sourceMessageId: userId } }),
    );
    const assistantId = `a${i}`;
    const assistantText = `answer ${i} ${'a'.repeat(fill)}`;
    rows.push({
      messageId: assistantId,
      parentMessageId: userId,
      conversationId: 'c1',
      isCreatedByUser: false,
      text: assistantText,
      tokenCount: assistantText.length + 3,
    } as TMessage);
    formatted.push(
      new AIMessage({
        content: assistantText,
        additional_kwargs: { sourceMessageId: assistantId },
      }),
    );
  }
  const draftText = 'What is 2+2?';
  const draft = {
    messageId: 'draft',
    parentMessageId: `a${turns - 1}`,
    conversationId: 'c1',
    isCreatedByUser: true,
    text: draftText,
  } as TMessage;
  formatted.push(
    new HumanMessage({ content: draftText, additional_kwargs: { sourceMessageId: 'draft' } }),
  );
  formatted.forEach((message, index) => {
    indexTokenCountMap[String(index)] = charCounter(message);
  });
  return { rows, draft, draftText, formatted, indexTokenCountMap };
}

type Fixture = ReturnType<typeof makeBranch>;

function makeRequest(appConfig: AppConfig, requestedTools: string[] = []): ServerRequest {
  return {
    config: appConfig,
    user: { id: 'user_1' },
    body: { endpointOption: { agent: Promise.resolve({ tools: requestedTools }) } },
  } as unknown as ServerRequest;
}

function makeClient(
  req: ServerRequest,
  agent: EstimateAgent,
  fixture: Fixture,
): EstimateAgentClient {
  const { rows, draft, draftText, formatted, indexTokenCountMap } = fixture;
  return {
    options: { req, agent, attachments: [], resendFiles: true },
    agentConfigs: undefined,
    currentMessages: [...rows, draft],
    getEncoding: () => 'o200k_base',
    prepareTurnPrompt: async () => ({
      payload: [
        ...rows.map((row) => ({
          role: row.isCreatedByUser ? 'user' : 'assistant',
          content: [{ type: 'text', text: row.text }],
          messageId: row.messageId,
        })),
        { role: 'user', content: [{ type: 'text', text: draftText }], messageId: 'draft' },
      ],
      tokenCountMap: {},
      promptTokens: 0,
      parentMessageId: draft.messageId,
      userMessage: draft,
    }),
    prepareGraphInput: async () => ({
      initialMessages: formatted,
      indexTokenCountMap: { ...indexTokenCountMap },
      initialSessions: undefined,
      tokenCounter: charCounter,
      runSeeds: {},
    }),
  };
}

const appConfig = {
  summarization: { enabled: false },
  endpoints: { agents: { contextEstimate: { maxExcludedPreviews: 50 } } },
  interfaceConfig: { contextCounterV2: true },
} as unknown as AppConfig;

const body = (fixture: Fixture): TContextEstimateRequest => ({
  conversationId: 'c1',
  parentMessageId: fixture.draft.parentMessageId as string,
  revision: 3,
  text: fixture.draftText,
  files: [],
  ephemeralAgent: null,
});

/**
 * Send side: the real `createRun` → `Run.processStream` with a fake model.
 * The first `on_context_usage` is the plan the graph settled on before its
 * first model call — the number Send actually pays for.
 */
async function runSend(agent: EstimateAgent, fixture: Fixture, config: AppConfig) {
  const snapshots: ContextUsageEvent[] = [];
  const summarizeStarts: SummarizeStartEvent[] = [];
  const run = await createRun({
    agents: [agent],
    signal: new AbortController().signal,
    runId: 'send-run',
    conversationId: 'c1',
    messages: fixture.formatted,
    indexTokenCountMap: { ...fixture.indexTokenCountMap },
    tokenCounter: charCounter,
    summarizationConfig: config.summarization,
    appConfig: config,
    hitlCapable: true,
    customHandlers: {
      [GraphEvents.ON_CONTEXT_USAGE]: {
        handle: (_event: string, data: unknown) => {
          snapshots.push(data as ContextUsageEvent);
        },
      },
      [GraphEvents.ON_SUMMARIZE_START]: {
        handle: (_event: string, data: unknown) => {
          summarizeStarts.push(data as SummarizeStartEvent);
        },
      },
    },
  });
  run.Graph!.overrideModel = new FakeChatModel({ responses: ['The answer is 4.'] });
  await run.processStream(
    { messages: fixture.formatted },
    {
      configurable: { thread_id: 'estimate-thread', user_id: 'user_1' },
      streamMode: 'values',
      version: 'v2',
    },
  );
  return { snapshots, summarizeStarts };
}

describe('estimateNextRequest uses the same plan as Send (§6, §10.17/26/28)', () => {
  jest.setTimeout(60_000);

  it('matches the graph pre-invoke snapshot when the branch overflows and history is dropped', async () => {
    const fixture = makeBranch(6, 60);
    const agent = makeAgent();
    const { snapshots } = await runSend(agent, fixture, appConfig);
    expect(snapshots.length).toBeGreaterThan(0);
    const sendPlan = snapshots[0];
    expect(sendPlan.breakdown.messageCount).toBeLessThan(fixture.formatted.length);

    const req = makeRequest(appConfig);
    const client = makeClient(req, makeAgent(), fixture);
    const estimate = await estimateNextRequest({
      req,
      body: body(fixture),
      client,
      signal: new AbortController().signal,
    });

    expect(estimate.status).toBe('fresh');
    expect(estimate.source).toBe('server_estimate');
    expect(estimate.revision).toBe(3);
    expect(estimate.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(estimate.cache).toEqual({ read: null, write: null });
    expect(estimate.budget).toEqual({
      window: MAX_CONTEXT_TOKENS + OUTPUT_RESERVE,
      reserve: OUTPUT_RESERVE,
      inputLimit: null,
      budget: MAX_CONTEXT_TOKENS,
    });

    const occupiedTotal = Object.values(estimate.occupied).reduce((sum, v) => sum + v, 0);
    expect(occupiedTotal).toBe(sendPlan.contextBudget! - sendPlan.remainingContextTokens!);
    expect(estimate.occupied.systemPrompt).toBe(
      sendPlan.breakdown.systemMessageTokens + sendPlan.breakdown.toolSchemaTokens,
    );
    expect(estimate.occupied.mcpTools).toBe(0);
    expect(estimate.occupied.messages + estimate.occupied.toolCalls).toBe(
      sendPlan.breakdown.messageTokens,
    );

    expect(estimate.excluded).not.toBeNull();
    expect(estimate.excluded?.reason).toBe('over_budget');
    expect(estimate.excluded?.count).toBe(
      fixture.formatted.length - sendPlan.breakdown.messageCount,
    );
    expect(estimate.excluded?.messages.map((m) => m.messageId)).toEqual(
      fixture.rows.slice(0, estimate.excluded!.count).map((row) => row.messageId),
    );
    expect(estimate.excluded?.prePruneTokens).toBe(
      sendPlan.prePruneContextTokens! + sendPlan.effectiveInstructionTokens!,
    );
  });

  it('reports no exclusion and the same occupancy when everything fits', async () => {
    const fixture = makeBranch(2, 10);
    const { snapshots } = await runSend(makeAgent(), fixture, appConfig);
    const sendPlan = snapshots[0];
    expect(sendPlan.breakdown.messageCount).toBe(fixture.formatted.length);

    const req = makeRequest(appConfig);
    const estimate = await estimateNextRequest({
      req,
      body: body(fixture),
      client: makeClient(req, makeAgent(), fixture),
      signal: new AbortController().signal,
    });
    expect(estimate.excluded).toBeNull();
    const occupiedTotal = Object.values(estimate.occupied).reduce((sum, v) => sum + v, 0);
    expect(occupiedTotal).toBe(sendPlan.contextBudget! - sendPlan.remainingContextTokens!);
  });

  it('labels the over-budget prefix as summarized when Send would summarize it', async () => {
    const fixture = makeBranch(8, 300);
    const summarizingConfig = {
      ...appConfig,
      summarization: { enabled: true, provider: 'openAI', model: 'gpt-4o' },
    } as unknown as AppConfig;
    /** Summarization is only viable above the SDK minimum budget (1024); mirror a real window. */
    const agent = makeAgent({ maxContextTokens: 2000, baseContextTokens: 2000 });
    const req = makeRequest(summarizingConfig);
    const estimate = await estimateNextRequest({
      req,
      body: body(fixture),
      client: makeClient(req, agent, fixture),
      signal: new AbortController().signal,
    });
    expect(estimate.status).toBe('fresh');
    expect(estimate.excluded?.reason).toBe('summarized');
    expect(estimate.excluded?.count).toBeGreaterThan(0);
  });

  it('keeps over_budget when the window is too small for Send to summarize', async () => {
    const fixture = makeBranch(6, 60);
    const summarizingConfig = {
      ...appConfig,
      summarization: { enabled: true, provider: 'openAI', model: 'gpt-4o' },
    } as unknown as AppConfig;
    const req = makeRequest(summarizingConfig);
    const estimate = await estimateNextRequest({
      req,
      body: body(fixture),
      client: makeClient(req, makeAgent(), fixture),
      signal: new AbortController().signal,
    });
    expect(estimate.excluded?.reason).toBe('over_budget');
  });

  it('marks the estimate partial when a requested MCP tool has no loaded schema', async () => {
    const fixture = makeBranch(1, 5);
    const req = makeRequest(appConfig, [`search${Constants.mcp_delimiter}github`]);
    const estimate = await estimateNextRequest({
      req,
      body: body(fixture),
      client: makeClient(req, makeAgent(), fixture),
      signal: new AbortController().signal,
    });
    expect(estimate.status).toBe('partial');
    expect(estimate.incompleteReasons).toEqual(['tool_schemas_pending']);
  });

  it('marks the estimate partial when an attachment is not prepared yet', async () => {
    const fixture = makeBranch(1, 5);
    const req = makeRequest(appConfig);
    const estimate = await estimateNextRequest({
      req,
      body: { ...body(fixture), files: ['file-pending'] },
      client: makeClient(req, makeAgent(), fixture),
      signal: new AbortController().signal,
    });
    expect(estimate.status).toBe('partial');
    expect(estimate.incompleteReasons).toEqual(['attachment_pending']);
  });

  it('returns an error entry with the revision instead of throwing', async () => {
    const fixture = makeBranch(1, 5);
    const req = makeRequest(appConfig);
    const client = makeClient(req, makeAgent(), fixture);
    client.prepareGraphInput = async () => {
      throw new Error('boom');
    };
    const estimate = await estimateNextRequest({
      req,
      body: body(fixture),
      client,
      signal: new AbortController().signal,
    });
    expect(estimate.status).toBe('error');
    expect(estimate.errorCode).toBe('ESTIMATE_FAILED');
    expect(estimate.revision).toBe(3);
    expect(estimate.budget.budget).toBeNull();
  });
});
