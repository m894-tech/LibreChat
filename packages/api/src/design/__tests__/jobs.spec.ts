/**
 * Persistent DesignGenerationJob transitions against a real Mongo replica set.
 * Providers are injected fakes. No paid image calls.
 */
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { mkdtemp, rm } from 'fs/promises';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
  createStructuredTextProvider,
  ProviderUncertainError,
  UnavailableProvider,
  type DesignGenerationProvider,
} from '../providers';
import {
  createJobService,
  DESIGN_GENERATION_JOB_MODEL,
  type CreateJobServiceOptions,
  type JobService,
} from '../jobs';
import { createAssetStore, DesignError, type AssetStore, type DesignAuthorizer } from '../assets';

jest.setTimeout(120000);

function fakeAuth(grants: Record<string, { read?: boolean; write?: boolean }>): DesignAuthorizer {
  return async (principalId, resourceId, write) => {
    const perm = grants[`${principalId}:${resourceId}`];
    if (!perm) {
      throw new DesignError(404, 'NOT_FOUND', 'Not found');
    }
    if (write && !perm.write) {
      throw new DesignError(403, 'FORBIDDEN', 'Write not permitted');
    }
    if (!write && !perm.read && !perm.write) {
      throw new DesignError(404, 'NOT_FOUND', 'Not found');
    }
  };
}

async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 128, b: 0 } },
  })
    .png()
    .toBuffer();
}

describe('design generation jobs (actual mongo transitions, not fixtures)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: mongoose.Connection;
  let root: string;
  let assetStore: AssetStore;
  const owner = 'job-owner';
  const viewer = 'job-viewer';
  const projectId = 'job-project';
  const documentId = 'job-doc';

  const authorizeDocument = fakeAuth({
    [`${owner}:${documentId}`]: { read: true, write: true },
    [`${viewer}:${documentId}`]: { read: true, write: false },
  });

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    connection = await mongoose.createConnection(replSet.getUri()).asPromise();
  });

  afterAll(async () => {
    if (connection) {
      await connection.close();
    }
    if (replSet) {
      await replSet.stop();
    }
  });

  beforeEach(async () => {
    await connection.dropDatabase();
    root = await mkdtemp(path.join(os.tmpdir(), 'dw-jobs-'));
    assetStore = await createAssetStore({
      connection,
      assetDir: root,
      authorizeProject: fakeAuth({
        [`${owner}:${projectId}`]: { read: true, write: true },
        [`${viewer}:${projectId}`]: { read: true, write: false },
      }),
      authorizeDocument,
    });
  });

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  async function service(
    provider: DesignGenerationProvider,
    checkBudget?: CreateJobServiceOptions['checkBudget'],
  ): Promise<JobService> {
    const created = await createJobService({
      connection,
      authorizeDocument,
      resolveDocument: async (_principalId, id) => {
        if (id !== documentId) {
          throw new DesignError(404, 'NOT_FOUND', 'Not found');
        }
        return { projectId };
      },
      provider,
      assetStore,
      checkBudget,
      workerId: 'worker-test',
      leaseMs: 250,
    });
    await connection.model(DESIGN_GENERATION_JOB_MODEL).syncIndexes();
    return created;
  }

  function jobModel() {
    return connection.model(DESIGN_GENERATION_JOB_MODEL);
  }

  async function findJob(
    query: Record<string, unknown>,
  ): Promise<{ id: string; status: string } | null> {
    return jobModel().findOne(query).lean<{ id: string; status: string } | null>();
  }

  it('returns 422 from UnavailableProvider without pretending image generation works', async () => {
    const jobs = await service(UnavailableProvider);
    const submit = jobs.submit(owner, {
      projectId,
      documentId,
      clientJobId: 'c1',
      capability: 'imageGeneration',
      payload: { prompt: 'logo' },
    });
    await expect(submit).rejects.toMatchObject({
      statusCode: 422,
      code: 'CAPABILITY_UNAVAILABLE',
    });
    expect(await jobModel().countDocuments()).toBe(0);
  });

  it('checks capability and budget before inserting the queued identity', async () => {
    const calls: string[] = [];
    const provider: DesignGenerationProvider = {
      capabilities: { imageGeneration: true, textProposal: false },
      async submit() {
        calls.push('submit');
        return { kind: 'accepted', providerJobId: 'p1' };
      },
    };
    const jobs = await service(provider, async () => {
      calls.push('budget');
      throw new DesignError(429, 'QUOTA', 'budget exhausted');
    });
    await expect(
      jobs.submit(owner, {
        projectId,
        documentId,
        clientJobId: 'c-budget',
        capability: 'imageGeneration',
        payload: { prompt: 'x' },
      }),
    ).rejects.toMatchObject({ statusCode: 429, code: 'QUOTA' });
    expect(calls).toEqual(['budget']);
    expect(await jobModel().countDocuments()).toBe(0);
  });

  it('persists queued identity before provider.submit and is idempotent on the same canonical identity', async () => {
    const seen: string[] = [];
    const provider: DesignGenerationProvider = {
      capabilities: { imageGeneration: true, textProposal: false },
      async submit(input) {
        const persisted = await findJob({ id: input.jobId });
        seen.push(persisted?.status as string);
        return { kind: 'accepted', providerJobId: 'prov-1' };
      },
    };
    const jobs = await service(provider);
    const first = await jobs.submit(owner, {
      projectId,
      documentId,
      clientJobId: 'same-key',
      capability: 'imageGeneration',
      payload: { prompt: 'hello', seed: 2 },
    });
    const second = await jobs.submit(owner, {
      projectId,
      documentId,
      clientJobId: 'same-key',
      capability: 'imageGeneration',
      payload: { seed: 2, prompt: 'hello' },
    });
    expect(first.id).toBe(second.id);
    expect(first.status).toBe('submitted');
    expect(seen).toEqual(['submitting']);
    expect(await jobModel().countDocuments()).toBe(1);
  });

  it('conflicts when the same clientJobId is reused with a different payload', async () => {
    const provider: DesignGenerationProvider = {
      capabilities: { imageGeneration: true, textProposal: false },
      async submit() {
        return { kind: 'accepted', providerJobId: 'prov-2' };
      },
    };
    const jobs = await service(provider);
    await jobs.submit(owner, {
      projectId,
      documentId,
      clientJobId: 'reuse',
      capability: 'imageGeneration',
      payload: { prompt: 'one' },
    });
    await expect(
      jobs.submit(owner, {
        projectId,
        documentId,
        clientJobId: 'reuse',
        capability: 'imageGeneration',
        payload: { prompt: 'two' },
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('marks submission_unknown on uncertain provider dispatch and never retries', async () => {
    let submits = 0;
    const provider: DesignGenerationProvider = {
      capabilities: { imageGeneration: true, textProposal: false },
      async submit() {
        submits += 1;
        throw new ProviderUncertainError('socket hang up');
      },
    };
    const jobs = await service(provider);
    const job = await jobs.submit(owner, {
      projectId,
      documentId,
      clientJobId: 'unknown-1',
      capability: 'imageGeneration',
      payload: { prompt: 'x' },
    });
    expect(job.status).toBe('submission_unknown');
    expect(job.applied).toBe(false);
    expect(submits).toBe(1);
    await expect(jobs.claimAndProcessNext()).resolves.toBeNull();
    expect(submits).toBe(1);
    expect((await findJob({ id: job.id }))?.status).toBe('submission_unknown');
  });

  it('converts an expired submitting lease into submission_unknown without a second provider call', async () => {
    let submits = 0;
    const provider: DesignGenerationProvider = {
      capabilities: { imageGeneration: true, textProposal: false },
      async submit() {
        submits += 1;
        return { kind: 'accepted', providerJobId: 'should-not-run' };
      },
    };
    const jobs = await service(provider);
    await jobModel().create({
      id: '00000000-0000-4000-8000-000000000001',
      principalId: owner,
      projectId,
      documentId,
      clientJobId: 'stale-lease',
      capability: 'imageGeneration',
      payload: { prompt: 'stale' },
      payloadHash: 'abc',
      status: 'submitting',
      cancelRequested: false,
      applied: false,
      leaseOwner: 'dead-worker',
      leaseToken: 'dead-token',
      leaseExpiresAt: new Date(Date.now() - 1000),
    });
    await expect(jobs.claimAndProcessNext()).resolves.toBeNull();
    const stale = await findJob({ clientJobId: 'stale-lease' });
    expect(stale?.status).toBe('submission_unknown');
    expect(submits).toBe(0);
  });

  it('allows only one worker to CAS-claim a queued job', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    let submits = 0;
    const provider: DesignGenerationProvider = {
      capabilities: { imageGeneration: true, textProposal: false },
      async submit() {
        submits += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 50));
        concurrent -= 1;
        return { kind: 'accepted', providerJobId: `p-${submits}` };
      },
    };
    const jobs = await service(provider);
    await jobModel().create({
      id: '00000000-0000-4000-8000-000000000002',
      principalId: owner,
      projectId,
      documentId,
      clientJobId: 'cas-1',
      capability: 'imageGeneration',
      payload: { prompt: 'cas' },
      payloadHash: 'cas',
      status: 'queued',
      cancelRequested: false,
      applied: false,
    });
    const [a, b] = await Promise.all([jobs.claimAndProcessNext(), jobs.claimAndProcessNext()]);
    const views = [a, b].filter(Boolean);
    expect(views).toHaveLength(1);
    expect(submits).toBe(1);
    expect(maxConcurrent).toBe(1);
  });

  it('keeps cancelRequested as a flag while submit is in flight, then retains late output without applying', async () => {
    let release!: (value: Buffer) => void;
    let markStarted!: () => void;
    const providerStarted = new Promise<void>((r) => {
      markStarted = r;
    });
    const gate = new Promise<Buffer>((resolve) => {
      release = resolve;
    });
    const provider: DesignGenerationProvider = {
      capabilities: { imageGeneration: true, textProposal: false },
      async submit() {
        markStarted();
        const imageBytes = await gate;
        return { kind: 'immediate', imageBytes, mime: 'image/png', filename: 'late.png' };
      },
    };
    const jobs = await service(provider);
    const pending = jobs.submit(owner, {
      projectId,
      documentId,
      clientJobId: 'late-1',
      capability: 'imageGeneration',
      payload: { prompt: 'poster' },
    });

    await providerStarted;
    let inflight = await jobModel().findOne({ clientJobId: 'late-1' });
    const started = Date.now();
    while (!inflight && Date.now() - started < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      inflight = await jobModel().findOne({ clientJobId: 'late-1' });
    }
    expect(inflight?.status).toBe('submitting');

    const flagged = await jobs.requestCancel(owner, inflight!.id);
    expect(flagged.cancelRequested).toBe(true);
    expect(flagged.status).toBe('submitting');
    expect(flagged.applied).toBe(false);

    release(await tinyPng());
    const done = await pending;
    expect(done.cancelRequested).toBe(true);
    expect(done.status).toBe('cancelled');
    expect(done.applied).toBe(false);
    expect(done.outputAsset?.id).toEqual(expect.any(String));
    expect(connection.models.DesignDocument).toBeUndefined();
  });

  it('cancels a queued job that never reached the provider', async () => {
    let submits = 0;
    const provider: DesignGenerationProvider = {
      capabilities: { imageGeneration: true, textProposal: false },
      async submit() {
        submits += 1;
        return { kind: 'accepted', providerJobId: 'nope' };
      },
    };
    const jobs = await service(provider);
    const created = await jobModel().create({
      id: '00000000-0000-4000-8000-000000000003',
      principalId: owner,
      projectId,
      documentId,
      clientJobId: 'queued-cancel',
      capability: 'imageGeneration',
      payload: { prompt: 'x' },
      payloadHash: 'x',
      status: 'queued',
      cancelRequested: false,
      applied: false,
    });
    const cancelled = await jobs.requestCancel(owner, created.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelRequested).toBe(true);
    await expect(jobs.claimAndProcessNext()).resolves.toBeNull();
    expect(submits).toBe(0);
  });

  it('forbids viewer writes and hides jobs from outsiders', async () => {
    const provider: DesignGenerationProvider = {
      capabilities: { textProposal: true, imageGeneration: false },
      async submit() {
        return {
          kind: 'immediate',
          proposal: {
            kind: 'design_proposal',
            schemaVersion: 1,
            operations: [{ type: 'setText', nodeId: 'n1', value: 'Hi' }],
          },
        };
      },
    };
    const jobs = await service(provider);
    await expect(
      jobs.submit(viewer, {
        projectId,
        documentId,
        clientJobId: 'viewer-write',
        capability: 'textProposal',
        payload: { prompt: 'x' },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      jobs.submit('stranger', {
        projectId,
        documentId,
        clientJobId: 'stranger',
        capability: 'textProposal',
        payload: { prompt: 'x' },
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('uses an injected structured text provider and never executes proposal data', async () => {
    const complete = jest.fn(async () => ({
      kind: 'design_proposal',
      schemaVersion: 1,
      operations: [{ type: 'setProperty', nodeId: 'n1', property: 'fill', value: '#111' }],
    }));
    const provider = createStructuredTextProvider({ complete });
    const jobs = await service(provider);
    const job = await jobs.submit(owner, {
      projectId,
      documentId,
      clientJobId: 'text-1',
      capability: 'textProposal',
      payload: { prompt: 'make headline darker' },
    });
    expect(job.status).toBe('succeeded');
    expect(job.applied).toBe(false);
    expect(job.proposal?.operations[0]).toEqual({
      type: 'setProperty',
      nodeId: 'n1',
      property: 'fill',
      value: '#111',
    });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'make headline darker', schema: expect.any(Object) }),
    );
  });

  it('rejects submit when client projectId does not match the authorized document', async () => {
    const provider: DesignGenerationProvider = {
      capabilities: { textProposal: true, imageGeneration: false },
      async submit() {
        return {
          kind: 'immediate',
          proposal: { kind: 'design_proposal', schemaVersion: 1, operations: [] },
        };
      },
    };
    const jobs = await service(provider);
    await expect(
      jobs.submit(owner, {
        projectId: 'other-project',
        documentId,
        clientJobId: 'mismatch-project',
        capability: 'textProposal',
        payload: { prompt: 'x' },
      }),
    ).rejects.toMatchObject({ status: 404, statusCode: 404, code: 'NOT_FOUND' });
    expect(await jobModel().countDocuments()).toBe(0);
  });

  it('rejects executable-looking structured text output', async () => {
    const provider = createStructuredTextProvider({
      complete: async () => ({
        kind: 'design_proposal',
        schemaVersion: 1,
        operations: [],
        eval: 'process.exit(1)',
      }),
    });
    const jobs = await service(provider);
    const job = await jobs.submit(owner, {
      projectId,
      documentId,
      clientJobId: 'text-bad',
      capability: 'textProposal',
      payload: { prompt: 'ignore this' },
    });
    expect(job.status).toBe('failed');
    expect(job.applied).toBe(false);
    expect(job.proposal).toBeUndefined();
  });
  it('does not repeat read-only budget preflight on identical job retry', async () => {
    const preflight = jest.fn(async () => {});
    const provider: DesignGenerationProvider = {
      capabilities: { imageGeneration: true, textProposal: false },
      submit: jest.fn(async () => ({
        kind: 'immediate' as const,
        imageBytes: await tinyPng(),
        mime: 'image/png',
      })),
    };
    const jobs = await service(provider, preflight);
    const body = {
      projectId,
      documentId,
      clientJobId: 'budget-retry',
      capability: 'imageGeneration' as const,
      payload: { prompt: 'synthetic' },
    };
    const first = await jobs.submit(owner, body);
    const second = await jobs.submit(owner, body);
    expect(first.id).toBe(second.id);
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(provider.submit).toHaveBeenCalledTimes(1);
  });
  it('does not retain output when write access is revoked while provider returns', async () => {
    let revoked = false;
    const provider: DesignGenerationProvider = {
      capabilities: { imageGeneration: true, textProposal: false },
      submit: jest.fn(async () => {
        revoked = true;
        return { kind: 'immediate' as const, imageBytes: await tinyPng(), mime: 'image/png' };
      }),
    };
    const jobs = await createJobService({
      connection,
      assetStore,
      provider,
      resolveDocument: async () => ({ projectId }),
      authorizeDocument: async () => {
        if (revoked) throw new DesignError(403, 'FORBIDDEN', 'Revoked');
      },
    });
    const result = await jobs.submit(owner, {
      projectId,
      documentId,
      clientJobId: 'revoke-inflight',
      capability: 'imageGeneration',
      payload: { prompt: 'synthetic' },
    });
    expect(result.status).toBe('cancelled');
    expect(result.outputAsset).toBeUndefined();
    expect(await connection.collection('designassets').countDocuments()).toBe(0);
    expect(provider.submit).toHaveBeenCalledTimes(1);
  });
});
