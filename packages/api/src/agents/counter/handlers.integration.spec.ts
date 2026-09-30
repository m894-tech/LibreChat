import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Constants, EModelEndpoint } from 'librechat-data-provider';
import { createMethods, createModels } from '@librechat/data-schemas';
import type { TTokenUsageEvent, TContextUsageEvent } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types';
import { buildLastCallMeasurement } from './measurement';
import { createContextUsageHandler } from './handlers';
import { aggregateEmittedUsage } from '../usage';

jest.mock('@librechat/data-schemas', () => {
  const actual = jest.requireActual('@librechat/data-schemas');
  return {
    ...actual,
    logger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() },
  };
});

let mongoServer: MongoMemoryServer;
let methods: ReturnType<typeof createMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
});

const ownerId = new mongoose.Types.ObjectId().toString();
const strangerId = new mongoose.Types.ObjectId().toString();
const conversationId = '3f6a9c2e-7d41-4b8e-9c1a-2e5b7d9f0a11';

const enabledConfig = {
  interfaceConfig: { contextCounterV2: true },
} as unknown as ServerRequest['config'];

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

function mockReq(
  query: Record<string, string>,
  userId: string | null = ownerId,
  config: ServerRequest['config'] = enabledConfig,
): ServerRequest {
  return {
    query,
    user: userId == null ? undefined : { id: userId },
    config,
  } as unknown as ServerRequest;
}

const snapshot: TContextUsageEvent = {
  runId: 'run-1',
  breakdown: {
    maxContextTokens: 128_000,
    instructionTokens: 10_000,
    systemMessageTokens: 0,
    dynamicInstructionTokens: 0,
    toolSchemaTokens: 0,
    summaryTokens: 0,
    toolCount: 0,
    messageCount: 2,
    messageTokens: 60_000,
    availableForMessages: 100_000,
  },
  contextBudget: 112_000,
};

/** One turn: two tool-loop primary calls, one subagent call — and every event delivered twice. */
const turnEvents: TTokenUsageEvent[] = [
  {
    input_tokens: 30_000,
    output_tokens: 200,
    provider: 'anthropic',
    model: 'claude',
    runId: 'run-1',
    seq: 1,
  },
  {
    input_tokens: 2_000,
    output_tokens: 100,
    provider: 'openAI',
    model: 'gpt-4.1-mini',
    usage_type: 'subagent',
    runId: 'resp-1:1',
    seq: 1,
  },
  {
    input_tokens: 72_000,
    output_tokens: 4_000,
    total_tokens: 76_000,
    input_token_details: { cache_read: 50_000, cache_creation: 10_000 },
    provider: 'anthropic',
    model: 'claude',
    runId: 'run-1',
    seq: 2,
  },
];
const redelivered = [...turnEvents, ...turnEvents];

/** Mirrors what `AgentClient.buildResponseMetadata` writes on the response message;
 *  the latest snapshot belongs to the run of the turn's final primary call. */
function responseMetadata(responseMessageId: string, events: TTokenUsageEvent[]) {
  const primaries = events.filter((event) => event.usage_type == null);
  const primaryRunId = primaries[primaries.length - 1]?.runId;
  return {
    usage: aggregateEmittedUsage(events),
    lastCall: buildLastCallMeasurement({
      conversationId,
      responseMessageId,
      usageEvents: events,
      snapshot: { ...snapshot, runId: primaryRunId },
      endpoint: EModelEndpoint.agents,
      agentId: 'agent_1',
      measuredAt: 1_700_000_000_000,
    }),
  };
}

async function seedConversation(userId: string) {
  await mongoose.models.Conversation.create({
    conversationId,
    user: userId,
    endpoint: EModelEndpoint.agents,
    title: 'usage',
  });
  const save = (params: Record<string, unknown>) =>
    methods.saveMessage({ userId }, { conversationId, ...params }, { context: 'test' });
  await save({
    messageId: 'u1',
    parentMessageId: Constants.NO_PARENT,
    isCreatedByUser: true,
    text: 'hi',
  });
  await save({
    messageId: 'a1',
    parentMessageId: 'u1',
    isCreatedByUser: false,
    text: 'first',
    metadata: responseMetadata('a1', redelivered),
  });
  await save({ messageId: 'u2', parentMessageId: 'a1', isCreatedByUser: true, text: 'more' });
  await save({
    messageId: 'a2',
    parentMessageId: 'u2',
    isCreatedByUser: false,
    text: 'second',
    metadata: responseMetadata('a2', [
      {
        input_tokens: 80_000,
        output_tokens: 500,
        provider: 'anthropic',
        model: 'claude',
        runId: 'run-2',
        seq: 1,
      },
    ]),
  });
  /** Sibling branch: an edit of u2 with its own, much larger response. */
  await save({ messageId: 'u2b', parentMessageId: 'a1', isCreatedByUser: true, text: 'edit' });
  await save({
    messageId: 'a2b',
    parentMessageId: 'u2b',
    isCreatedByUser: false,
    text: 'sibling',
    metadata: responseMetadata('a2b', [
      {
        input_tokens: 900_000,
        output_tokens: 9_000,
        provider: 'openAI',
        model: 'gpt-4.1',
        runId: 'run-3',
        seq: 1,
      },
    ]),
  });
}

function handler(overrides: Partial<Parameters<typeof createContextUsageHandler>[0]> = {}) {
  return createContextUsageHandler({
    getConvoOwnership: methods.getConvoOwnership,
    getMessages: methods.getMessages,
    now: () => 99,
    ...overrides,
  });
}

describe('GET /api/agents/context/usage — event → measurement → persisted read path', () => {
  it('returns the branch session usage and the immutable last call, deduplicating redelivered events (§10.13)', async () => {
    await seedConversation(ownerId);
    const res = mockRes();
    await handler()(mockReq({ conversationId, messageId: 'a2' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      version: 1,
      conversationId,
      branchLeafId: 'a2',
      sessionUsage: {
        scope: 'branch',
        complete: true,
        cacheSplittable: true,
        /** a1: 30 000 + (72 000 − 60 000 cache) + 2 000 subagent; a2: 80 000 */
        input: 30_000 + 12_000 + 2_000 + 80_000,
        output: 200 + 4_000 + 100 + 500,
        cacheRead: 50_000,
        cacheWrite: 10_000,
        calls: 4,
        auxiliary: { input: 2_000, output: 100, cacheRead: 0, cacheWrite: 0, calls: 1 },
        updatedAt: 99,
      },
      lastCall: {
        responseMessageId: 'a2',
        callId: 'run-2:1',
        source: 'provider',
        input: 80_000,
        output: 500,
        budget: { window: 128_000, reserve: 16_000, budget: 112_000 },
        configuration: {
          endpoint: 'agents',
          provider: 'anthropic',
          model: 'claude',
          agentId: 'agent_1',
        },
      },
    });
  });

  it('reads the same measurement and spend again after a reload (§10.12)', async () => {
    await seedConversation(ownerId);
    const first = mockRes();
    const second = mockRes();
    await handler()(mockReq({ conversationId, messageId: 'a2' }), first);
    await handler()(mockReq({ conversationId, messageId: 'a2' }), second);
    expect(second.body).toEqual(first.body);
  });

  it('accepts `messageId` as an alias of `leafId`', async () => {
    await seedConversation(ownerId);
    const byLeaf = mockRes();
    const byMessage = mockRes();
    await handler()(mockReq({ conversationId, leafId: 'a2' }), byLeaf);
    await handler()(mockReq({ conversationId, messageId: 'a2' }), byMessage);
    expect(byMessage.body).toEqual(byLeaf.body);
  });

  it('never folds the sibling branch into the requested one (§10.11)', async () => {
    await seedConversation(ownerId);
    const res = mockRes();
    await handler()(mockReq({ conversationId, messageId: 'a2b' }), res);
    expect(res.body).toMatchObject({
      branchLeafId: 'a2b',
      sessionUsage: { input: 30_000 + 12_000 + 2_000 + 900_000, calls: 4 },
      lastCall: { responseMessageId: 'a2b', input: 900_000, configuration: { provider: 'openAI' } },
    });
    /** The a1 measurement (72 000 with cache) is on both branches; a2's is on neither sibling. */
    const midBranch = mockRes();
    await handler()(mockReq({ conversationId, messageId: 'u2b' }), midBranch);
    expect(midBranch.body).toMatchObject({
      sessionUsage: { input: 44_000, calls: 3 },
      lastCall: { responseMessageId: 'a1', input: 72_000, cacheRead: 50_000, cacheWrite: 10_000 },
    });
  });

  it('keeps the previous measurement when the newest response carries no usage and marks the spend incomplete', async () => {
    await seedConversation(ownerId);
    await methods.saveMessage(
      { userId: ownerId },
      {
        conversationId,
        messageId: 'u3',
        parentMessageId: 'a2',
        isCreatedByUser: true,
        text: 'again',
      },
    );
    await methods.saveMessage(
      { userId: ownerId },
      {
        conversationId,
        messageId: 'a3',
        parentMessageId: 'u3',
        isCreatedByUser: false,
        text: 'stopped',
      },
    );
    const res = mockRes();
    await handler()(mockReq({ conversationId, messageId: 'a3' }), res);
    expect(res.body).toMatchObject({
      sessionUsage: { complete: false, input: 124_000 },
      lastCall: { responseMessageId: 'a2' },
    });
  });

  it('is invisible while the feature flag is off (§11)', async () => {
    await seedConversation(ownerId);
    const res = mockRes();
    await handler()(
      mockReq({ conversationId, messageId: 'a2' }, ownerId, {} as ServerRequest['config']),
      res,
    );
    expect(res.statusCode).toBe(404);
  });

  it('rejects unauthenticated and malformed requests', async () => {
    const anonymous = mockRes();
    await handler()(mockReq({ conversationId, messageId: 'a2' }, null), anonymous);
    expect(anonymous.statusCode).toBe(401);

    const malformed = mockRes();
    await handler()(mockReq({ conversationId }), malformed);
    expect(malformed.statusCode).toBe(400);
  });

  it("does not reveal another user's conversation or an unknown message", async () => {
    await seedConversation(ownerId);
    const stranger = mockRes();
    await handler()(mockReq({ conversationId, messageId: 'a2' }, strangerId), stranger);
    expect(stranger.statusCode).toBe(404);

    const unknownLeaf = mockRes();
    await handler()(mockReq({ conversationId, messageId: 'nope' }), unknownLeaf);
    expect(unknownLeaf.statusCode).toBe(404);
  });
});
