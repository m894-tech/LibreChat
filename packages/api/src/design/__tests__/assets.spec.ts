/**
 * DB / ACL tests for design asset metadata. Fake authorizer; real Mongo.
 */
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { mkdtemp, rm } from 'fs/promises';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
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

async function raster(format: 'png' | 'jpeg' | 'webp', width = 12, height = 10): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 12, g: 80, b: 200 } },
  });
  if (format === 'png') {
    return image.png().toBuffer();
  }
  if (format === 'jpeg') {
    return image.jpeg().toBuffer();
  }
  return image.webp().toBuffer();
}

describe('asset store db + acl (actual mongo)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: mongoose.Connection;
  let root: string;
  let store: AssetStore;

  const owner = 'owner-1';
  const viewer = 'viewer-1';
  const outsider = 'outsider-1';
  const projectId = 'proj-acl';
  const otherProject = 'proj-other';

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
    root = await mkdtemp(path.join(os.tmpdir(), 'dw-assets-db-'));
    store = await createAssetStore({
      connection,
      assetDir: root,
      authorizeProject: fakeAuth({
        [`${owner}:${projectId}`]: { read: true, write: true },
        [`${owner}:${otherProject}`]: { read: true, write: true },
        [`${viewer}:${projectId}`]: { read: true, write: false },
      }),
      authorizeDocument: fakeAuth({
        [`${owner}:doc-1`]: { read: true, write: true },
        [`${viewer}:doc-1`]: { read: true, write: false },
        [`${owner}:doc-other`]: { read: true, write: true },
      }),
    });
  });

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('persists mongoose metadata and returns bytes only after ACL', async () => {
    const bytes = await raster('png');
    const uploaded = await store.upload(owner, projectId, {
      bytes,
      mime: 'image/png',
      filename: 'logo.png',
    });
    const listed = await store.list(owner, projectId);
    expect(listed.map((row) => row.id)).toEqual([uploaded.id]);

    const fetched = await store.get(owner, uploaded.id);
    expect(fetched.checksum).toBe(uploaded.checksum);
    const versioned = await store.getVersion(owner, uploaded.id, 1);
    expect(versioned.version).toBe(1);

    const payload = await store.getBytes(owner, uploaded.id);
    expect(payload.bytes.equals(bytes)).toBe(true);
    expect(payload.mime).toBe('image/png');
    expect(JSON.stringify(payload)).not.toContain(root);
  });

  it('enforces outsider 404 and viewer write 403', async () => {
    const bytes = await raster('jpeg');
    await expect(
      store.upload(outsider, projectId, { bytes, mime: 'image/jpeg', filename: 'x.jpg' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    await expect(
      store.upload(viewer, projectId, { bytes, mime: 'image/jpeg', filename: 'x.jpg' }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    const asset = await store.upload(owner, projectId, {
      bytes,
      mime: 'image/jpeg',
      filename: 'x.jpg',
    });
    await expect(store.get(outsider, asset.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(store.getBytes(outsider, asset.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(store.getVersion(outsider, asset.id, 1)).rejects.toMatchObject({
      statusCode: 404,
    });

    const viewable = await store.get(viewer, asset.id);
    expect(viewable.id).toBe(asset.id);
    const downloaded = await store.getBytes(viewer, asset.id);
    expect(downloaded.bytes.equals(bytes)).toBe(true);
  });

  it('accepts jpeg/webp and rejects mime/magic mismatch', async () => {
    const jpeg = await raster('jpeg');
    const webp = await raster('webp');
    await expect(
      store.upload(owner, projectId, { bytes: jpeg, mime: 'image/png', filename: 'x.png' }),
    ).rejects.toMatchObject({ statusCode: 422 });
    const jpegAsset = await store.upload(owner, projectId, {
      bytes: jpeg,
      mime: 'image/jpeg',
      filename: 'x.jpg',
    });
    const webpAsset = await store.upload(owner, projectId, {
      bytes: webp,
      mime: 'image/webp',
      filename: 'x.webp',
    });
    expect(jpegAsset.mime).toBe('image/jpeg');
    expect(webpAsset.mime).toBe('image/webp');
  });

  it('rejects images over the 4096 dimension cap', async () => {
    const bytes = await raster('png', 4097, 16);
    await expect(
      store.upload(owner, projectId, { bytes, mime: 'image/png', filename: 'wide.png' }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION' });
  });

  it('binds refs to the authorized project/document and hides cross-project ids', async () => {
    const bytes = await raster('png');
    const asset = await store.upload(owner, projectId, {
      bytes,
      mime: 'image/png',
      filename: 'a.png',
    });
    const bound = await store.createBoundRef(owner, {
      documentId: 'doc-1',
      projectId,
      assetId: asset.id,
      version: 1,
    });
    expect(bound.id).toBe(asset.id);

    await expect(
      store.createBoundRef(owner, {
        documentId: 'doc-1',
        projectId: otherProject,
        assetId: asset.id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      store.createBoundRef(outsider, {
        documentId: 'doc-1',
        projectId,
        assetId: asset.id,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('does not expose a content-hash lookup API', async () => {
    expect(store).not.toHaveProperty('findByChecksum');
    expect(store).not.toHaveProperty('getByHash');
    expect(typeof (store as unknown as { getBytes: unknown }).getBytes).toBe('function');
    const bytes = await raster('png');
    const asset = await store.upload(owner, projectId, {
      bytes,
      mime: 'image/png',
      filename: 'a.png',
    });
    await expect(store.get(owner, asset.checksum as unknown as string)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('scopes list to the authorized project', async () => {
    const bytes = await raster('png');
    const a = await store.upload(owner, projectId, { bytes, mime: 'image/png', filename: 'a.png' });
    const b = await store.upload(owner, otherProject, {
      bytes,
      mime: 'image/png',
      filename: 'b.png',
    });
    const listed = await store.list(owner, projectId);
    expect(listed.map((row) => row.id)).toEqual([a.id]);
    expect(listed.map((row) => row.id)).not.toContain(b.id);
    await expect(store.list(viewer, otherProject)).rejects.toMatchObject({ statusCode: 404 });
  });
});
