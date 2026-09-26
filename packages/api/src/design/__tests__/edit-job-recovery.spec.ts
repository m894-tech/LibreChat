import { recoverEditJob } from '../edit-job-recovery';

describe('recoverEditJob', () => {
  const actor = 'user-1';
  const documentId = 'doc-1';

  function makeRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'job-1',
      actor,
      documentId,
      clientId: 'client-1',
      status: 'running',
      createdAt: new Date(),
      ...overrides,
    } as any;
  }

  function makeCollections(row: any, proposal: any = null) {
    const rows = {
      findOne: jest.fn(async () => row),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    } as any;
    const proposals = {
      findOne: jest.fn(async () => proposal),
    } as any;
    return { rows, proposals };
  }

  it('returns terminal rows unchanged', async () => {
    for (const status of ['succeeded', 'failed', 'cancelled']) {
      const row = makeRow({ status });
      const { rows, proposals } = makeCollections(row);
      const result = await recoverEditJob(rows, proposals, row, 'inpaint');
      expect(result).toBe(row);
      expect(rows.updateOne).not.toHaveBeenCalled();
      expect(proposals.findOne).not.toHaveBeenCalled();
    }
  });

  it('re-associates a matching proposal for running / submission_unknown rows', async () => {
    const row = makeRow({ status: 'running' });
    const proposal = { _id: 'job-inpaint-job-1', documentId, authorId: actor };
    const updatedRow = { ...row, status: 'succeeded', proposalId: 'job-inpaint-job-1' };
    const rows = {
      findOne: jest.fn(async () => updatedRow),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    } as any;
    const proposals = {
      findOne: jest.fn(async () => proposal),
    } as any;
    const result = await recoverEditJob(rows, proposals, row, 'inpaint');
    expect(rows.updateOne).toHaveBeenCalledWith(
      { id: 'job-1', actor, status: { $in: ['running', 'submission_unknown'] } },
      { $set: { status: 'succeeded', proposalId: 'job-inpaint-job-1' } },
    );
    expect(result.status).toBe('succeeded');
    expect(result.proposalId).toBe('job-inpaint-job-1');
  });

  it('marks a stale running row as submission_unknown after 120s without a proposal', async () => {
    const old = new Date(Date.now() - 121_000);
    const row = makeRow({ status: 'running', createdAt: old });
    const { rows, proposals } = makeCollections(row, null);
    const result = await recoverEditJob(rows, proposals, row, 'outpaint');
    expect(rows.updateOne).not.toHaveBeenCalled();
    expect(result.status).toBe('submission_unknown');
    expect(result.id).toBe('job-1');
  });

  it('leaves a fresh running row untouched when no proposal exists', async () => {
    const fresh = new Date(Date.now() - 30_000);
    const row = makeRow({ status: 'running', createdAt: fresh });
    const { rows, proposals } = makeCollections(row, null);
    const result = await recoverEditJob(rows, proposals, row, 'inpaint');
    expect(rows.updateOne).not.toHaveBeenCalled();
    expect(result.status).toBe('running');
  });

  it('does not mutate a submission_unknown row when no proposal exists', async () => {
    const old = new Date(Date.now() - 200_000);
    const row = makeRow({ status: 'submission_unknown', createdAt: old });
    const { rows, proposals } = makeCollections(row, null);
    const result = await recoverEditJob(rows, proposals, row, 'outpaint');
    expect(rows.updateOne).not.toHaveBeenCalled();
    expect(result.status).toBe('submission_unknown');
  });
});
