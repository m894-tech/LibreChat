import { createOutpaintService } from '../outpaint-service';

function makeStore(doc: any) {
  return {
    getDocument: jest.fn(async () => doc),
    withProjectWrite: jest.fn(async (_actor: string, _projectId: string, work: any) => work({})),
    createProposal: jest.fn(async (_actor: string, _docId: string, input: any) => ({
      id: 'proposal-1',
      ...input,
    })),
    connection: {
      collection: jest.fn(() => ({
        createIndex: jest.fn(async () => undefined),
        findOne: jest.fn(async () => null),
        insertOne: jest.fn(async () => ({}) as any),
        updateOne: jest.fn(async () => ({}) as any),
      })),
    },
  } as any;
}

function makeAssets(sourceBytes: Buffer) {
  return {
    getBytes: jest.fn(async () => ({ bytes: sourceBytes, mime: 'image/png' })),
    getVersion: jest.fn(async () => ({ projectId: 'proj-1', width: 2, height: 2 })),
    upload: jest.fn(async (_actor: string, _projectId: string, input: any) => ({
      id: 'asset-1',
      version: 1,
      ...input,
    })),
  } as any;
}

function makeBudget() {
  return {
    preflight: jest.fn(async () => undefined),
    reserve: jest.fn(async () => undefined),
    claimDispatch: jest.fn(async () => undefined),
    settle: jest.fn(async () => undefined),
  } as any;
}

function makeProvider(output: Buffer | Error) {
  return {
    inpaint: jest.fn(async () => {
      if (output instanceof Error) throw output;
      return output;
    }),
  } as any;
}

describe('createOutpaintService', () => {
  const actor = 'user-1';
  const documentId = 'doc-1';
  const projectId = 'proj-1';

  const baseDoc = {
    id: documentId,
    projectId,
    revision: 1,
    payload: {
      nodes: [
        {
          id: 'node-1',
          type: 'image',
          props: {
            assetId: 'asset-src',
            assetVersion: 1,
            x: 0,
            y: 0,
            width: 2,
            height: 2,
            rotation: 0,
          },
        },
      ],
    },
  };

  it('rejects invalid clientId', async () => {
    const store = makeStore(baseDoc);
    const assets = makeAssets(Buffer.from('x'));
    const budget = makeBudget();
    const provider = makeProvider(Buffer.from('y'));
    const service = await createOutpaintService({ store, assets, budget, provider });
    await expect(
      service.submit(actor, documentId, {
        clientId: 'bad id!',
        nodeId: 'node-1',
        expectedRevision: 1,
        prompt: 'test',
        left: 1,
        right: 0,
        top: 0,
        bottom: 0,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'outpaint_input' });
  });

  it('rejects empty prompt', async () => {
    const store = makeStore(baseDoc);
    const assets = makeAssets(Buffer.from('x'));
    const budget = makeBudget();
    const provider = makeProvider(Buffer.from('y'));
    const service = await createOutpaintService({ store, assets, budget, provider });
    await expect(
      service.submit(actor, documentId, {
        clientId: 'client-1',
        nodeId: 'node-1',
        expectedRevision: 1,
        prompt: '   ',
        left: 1,
        right: 0,
        top: 0,
        bottom: 0,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'outpaint_input' });
  });

  it('rejects prompt exceeding 2000 chars', async () => {
    const store = makeStore(baseDoc);
    const assets = makeAssets(Buffer.from('x'));
    const budget = makeBudget();
    const provider = makeProvider(Buffer.from('y'));
    const service = await createOutpaintService({ store, assets, budget, provider });
    await expect(
      service.submit(actor, documentId, {
        clientId: 'client-1',
        nodeId: 'node-1',
        expectedRevision: 1,
        prompt: 'p'.repeat(2001),
        left: 1,
        right: 0,
        top: 0,
        bottom: 0,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'outpaint_input' });
  });

  it('rejects revision mismatch', async () => {
    const store = makeStore(baseDoc);
    const assets = makeAssets(Buffer.from('x'));
    const budget = makeBudget();
    const provider = makeProvider(Buffer.from('y'));
    const service = await createOutpaintService({ store, assets, budget, provider });
    await expect(
      service.submit(actor, documentId, {
        clientId: 'client-1',
        nodeId: 'node-1',
        expectedRevision: 2,
        prompt: 'test',
        left: 1,
        right: 0,
        top: 0,
        bottom: 0,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'revision_mismatch' });
  });

  it('rejects cropped or rotated image', async () => {
    const doc = {
      ...baseDoc,
      payload: {
        nodes: [
          {
            id: 'node-1',
            type: 'image',
            props: {
              assetId: 'asset-src',
              assetVersion: 1,
              x: 0,
              y: 0,
              width: 2,
              height: 2,
              rotation: 90,
              crop: { x: 0, y: 0, width: 1, height: 1 },
            },
          },
        ],
      },
    };
    const store = makeStore(doc);
    const assets = makeAssets(Buffer.from('x'));
    const budget = makeBudget();
    const provider = makeProvider(Buffer.from('y'));
    const service = await createOutpaintService({ store, assets, budget, provider });
    await expect(
      service.submit(actor, documentId, {
        clientId: 'client-1',
        nodeId: 'node-1',
        expectedRevision: 1,
        prompt: 'test',
        left: 1,
        right: 0,
        top: 0,
        bottom: 0,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'outpaint_geometry' });
  });

  it('rejects locked node or ancestor', async () => {
    const doc = {
      ...baseDoc,
      payload: {
        nodes: [
          { id: 'parent-1', type: 'group', locked: true, props: {} },
          {
            id: 'node-1',
            type: 'image',
            parentId: 'parent-1',
            props: {
              assetId: 'asset-src',
              assetVersion: 1,
              x: 0,
              y: 0,
              width: 2,
              height: 2,
              rotation: 0,
            },
          },
        ],
      },
    };
    const store = makeStore(doc);
    const assets = makeAssets(Buffer.from('x'));
    const budget = makeBudget();
    const provider = makeProvider(Buffer.from('y'));
    const service = await createOutpaintService({ store, assets, budget, provider });
    await expect(
      service.submit(actor, documentId, {
        clientId: 'client-1',
        nodeId: 'node-1',
        expectedRevision: 1,
        prompt: 'test',
        left: 1,
        right: 0,
        top: 0,
        bottom: 0,
      }),
    ).rejects.toMatchObject({ status: 422, code: 'lock' });
  });
});
