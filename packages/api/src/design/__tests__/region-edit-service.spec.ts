import sharp from 'sharp';
import { createRegionEditProposal } from '../region-edit-service';

async function grayPng(width: number, height: number, fill: number): Promise<Buffer> {
  const data = Buffer.alloc(width * height, fill);
  return sharp(data, { raw: { width, height, channels: 1 } })
    .toColourspace('b-w')
    .png()
    .toBuffer();
}

function makeStore(doc: any) {
  return {
    getDocument: jest.fn(async () => doc),
    withProjectWrite: jest.fn(async (_actor: string, _projectId: string, work: any) => work({})),
    createProposal: jest.fn(async (_actor: string, _docId: string, input: any) => ({
      id: 'proposal-1',
      ...input,
    })),
  } as any;
}

function makeAssets(sourceBytes: Buffer, candidateBytes: Buffer) {
  return {
    getBytes: jest.fn(async (_actor: string, assetId: string) => {
      if (assetId === 'asset-src') return { bytes: sourceBytes, mime: 'image/png' };
      if (assetId === 'asset-cand') return { bytes: candidateBytes, mime: 'image/png' };
      throw new Error('not found');
    }),
    getVersion: jest.fn(async (_actor: string, assetId: string) => {
      if (assetId === 'asset-src') return { projectId: 'proj-1', width: 2, height: 2 };
      if (assetId === 'asset-cand') return { projectId: 'proj-1', width: 2, height: 2 };
      throw new Error('not found');
    }),
    upload: jest.fn(async (_actor: string, _projectId: string, input: any) => ({
      id: 'asset-new',
      version: 1,
      ...input,
    })),
  } as any;
}

describe('createRegionEditProposal', () => {
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
          props: { assetId: 'asset-src', assetVersion: 1 },
        },
      ],
    },
  };

  it('rejects revision mismatch', async () => {
    const store = makeStore(baseDoc);
    const assets = makeAssets(Buffer.from('x'), Buffer.from('y'));
    const mask = await grayPng(2, 2, 255);
    await expect(
      createRegionEditProposal(
        {
          actor,
          documentId,
          nodeId: 'node-1',
          expectedRevision: 2,
          candidateAssetId: 'asset-cand',
          candidateVersion: 1,
          mask,
        },
        store,
        assets,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'revision_mismatch' });
  });

  it('rejects non-image node', async () => {
    const doc = {
      ...baseDoc,
      payload: { nodes: [{ id: 'node-1', type: 'text', props: {} }] },
    };
    const store = makeStore(doc);
    const assets = makeAssets(Buffer.from('x'), Buffer.from('y'));
    const mask = await grayPng(2, 2, 255);
    await expect(
      createRegionEditProposal(
        {
          actor,
          documentId,
          nodeId: 'node-1',
          expectedRevision: 1,
          candidateAssetId: 'asset-cand',
          candidateVersion: 1,
          mask,
        },
        store,
        assets,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'region_node' });
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
            props: { assetId: 'asset-src', assetVersion: 1 },
          },
        ],
      },
    };
    const store = makeStore(doc);
    const assets = makeAssets(Buffer.from('x'), Buffer.from('y'));
    const mask = await grayPng(2, 2, 255);
    await expect(
      createRegionEditProposal(
        {
          actor,
          documentId,
          nodeId: 'node-1',
          expectedRevision: 1,
          candidateAssetId: 'asset-cand',
          candidateVersion: 1,
          mask,
        },
        store,
        assets,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'lock' });
  });

  it('rejects empty mask (no selection)', async () => {
    const store = makeStore(baseDoc);
    const assets = makeAssets(Buffer.from('x'), Buffer.from('y'));
    const mask = await grayPng(2, 2, 0);
    await expect(
      createRegionEditProposal(
        {
          actor,
          documentId,
          nodeId: 'node-1',
          expectedRevision: 1,
          candidateAssetId: 'asset-cand',
          candidateVersion: 1,
          mask,
        },
        store,
        assets,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'region_mask' });
  });

  it('rejects candidate from another project', async () => {
    const store = makeStore(baseDoc);
    const assets = {
      getBytes: jest.fn(async () => ({ bytes: Buffer.from('x'), mime: 'image/png' })),
      getVersion: jest.fn(async () => ({ projectId: 'other-project', width: 2, height: 2 })),
      upload: jest.fn(),
    } as any;
    const mask = await grayPng(2, 2, 255);
    await expect(
      createRegionEditProposal(
        {
          actor,
          documentId,
          nodeId: 'node-1',
          expectedRevision: 1,
          candidateAssetId: 'asset-cand',
          candidateVersion: 1,
          mask,
        },
        store,
        assets,
      ),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });

  it('rejects oversized mask', async () => {
    const store = makeStore(baseDoc);
    const assets = makeAssets(Buffer.from('x'), Buffer.from('y'));
    const mask = Buffer.alloc(10 * 1024 * 1024 + 1, 0xff);
    await expect(
      createRegionEditProposal(
        {
          actor,
          documentId,
          nodeId: 'node-1',
          expectedRevision: 1,
          candidateAssetId: 'asset-cand',
          candidateVersion: 1,
          mask,
        },
        store,
        assets,
      ),
    ).rejects.toMatchObject({ status: 422, code: 'region_mask' });
  });
});
