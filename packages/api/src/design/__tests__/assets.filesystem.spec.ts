/**
 * Filesystem tests for design asset storage.
 * These assertions inspect the private on-disk tree. Mongo is used only
 * as metadata; ACL is a fake in-process authorizer.
 */
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdtemp, rm, symlink, writeFile, lstat, readdir } from 'fs/promises';
import {
  createAssetStore,
  DesignError,
  listAssetDirFiles,
  MAX_ASSET_BYTES,
  type AssetStore,
  type DesignAuthorizer,
} from '../assets';

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

async function raster(format: 'png' | 'jpeg' | 'webp', width = 8, height = 8): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 20, b: 20 } },
  });
  if (format === 'png') {
    return image.png().toBuffer();
  }
  if (format === 'jpeg') {
    return image.jpeg({ quality: 80 }).toBuffer();
  }
  return image.webp().toBuffer();
}

describe('asset store filesystem (actual mongo + disk)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: mongoose.Connection;
  let root: string;
  let store: AssetStore;
  const owner = 'user-owner';
  const projectId = 'project-1';

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
    root = await mkdtemp(path.join(os.tmpdir(), 'dw-assets-fs-'));
    store = await createAssetStore({
      connection,
      assetDir: root,
      authorizeProject: fakeAuth({ [`${owner}:${projectId}`]: { read: true, write: true } }),
      authorizeDocument: fakeAuth({ [`${owner}:doc-1`]: { read: true, write: true } }),
    });
  });

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes an immutable file under the private instance dir and omits the path from the client body', async () => {
    const bytes = await raster('png');
    const asset = await store.upload(owner, projectId, {
      bytes,
      mime: 'image/png',
      filename: 'hero.png',
    });

    expect(asset).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        projectId,
        version: 1,
        mime: 'image/png',
        size: bytes.length,
        width: 8,
        height: 8,
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(asset)).not.toContain(root);
    expect(asset).not.toHaveProperty('storageKey');
    expect(asset).not.toHaveProperty('path');
    expect(asset).not.toHaveProperty('filepath');

    const files = await listAssetDirFiles(root);
    expect(files.some((rel) => rel.replace(/\\/g, '/').endsWith(`assets/${asset.id}/v1`))).toBe(
      true,
    );
    expect(files.every((rel) => !rel.replace(/\\/g, '/').startsWith('quarantine/'))).toBe(true);
  });

  it('never uses the uploaded filename as a filesystem path (traversal)', async () => {
    const bytes = await raster('png');
    const asset = await store.upload(owner, projectId, {
      bytes,
      mime: 'image/png',
      filename: '../../etc/passwd.png',
    });
    const files = await listAssetDirFiles(root);
    expect(files.join('\n')).not.toMatch(/etc\/passwd/);
    expect(files.some((rel) => rel.includes(asset.id))).toBe(true);
  });

  it('rejects a swapped assets directory symlink and does not write outside the instance dir', async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'dw-assets-outside-'));
    const assetsDir = path.join(root, 'assets');
    await rm(assetsDir, { recursive: true, force: true });
    await symlink(outside, assetsDir);

    const bytes = await raster('png');
    await expect(
      store.upload(owner, projectId, { bytes, mime: 'image/png', filename: 'x.png' }),
    ).rejects.toBeInstanceOf(DesignError);

    const outsideFiles = await readdir(outside);
    expect(outsideFiles).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });

  it('cleans quarantine and does not leave an exposed file when metadata persist fails', async () => {
    const Asset = connection.models.DesignAsset;
    const original = Asset.create.bind(Asset);
    Asset.create = (async () => {
      throw new Error('metadata write failed');
    }) as typeof Asset.create;

    try {
      const bytes = await raster('png');
      await expect(
        store.upload(owner, projectId, { bytes, mime: 'image/png', filename: 'x.png' }),
      ).rejects.toThrow(/metadata write failed/);
      const files = await listAssetDirFiles(root);
      expect(files.filter((rel) => rel.startsWith('assets/'))).toEqual([]);
      expect(files.filter((rel) => rel.startsWith('quarantine/'))).toEqual([]);
    } finally {
      Asset.create = original;
    }
  });

  it('cleans quarantine after SVG rejection', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    await expect(
      store.upload(owner, projectId, { bytes: svg, mime: 'image/svg+xml', filename: 'x.svg' }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'VALIDATION' });
    const files = await listAssetDirFiles(root);
    expect(files).toEqual([]);
  });

  it('rejects oversize payloads before they land on disk', async () => {
    const bytes = Buffer.alloc(MAX_ASSET_BYTES + 1, 1);
    bytes[0] = 0x89;
    bytes[1] = 0x50;
    await expect(
      store.upload(owner, projectId, { bytes, mime: 'image/png', filename: 'big.png' }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(await listAssetDirFiles(root)).toEqual([]);
  });

  it('keeps two store instances in separate private directories', async () => {
    const otherRoot = await mkdtemp(path.join(os.tmpdir(), 'dw-assets-fs-b-'));
    const other = await createAssetStore({
      connection,
      assetDir: otherRoot,
      authorizeProject: fakeAuth({ [`${owner}:${projectId}`]: { read: true, write: true } }),
      authorizeDocument: fakeAuth({ [`${owner}:doc-1`]: { read: true, write: true } }),
    });
    const bytes = await raster('png');
    const a = await store.upload(owner, projectId, { bytes, mime: 'image/png', filename: 'a.png' });
    const b = await other.upload(owner, projectId, { bytes, mime: 'image/png', filename: 'b.png' });

    const filesA = await listAssetDirFiles(root);
    const filesB = await listAssetDirFiles(otherRoot);
    expect(filesA.join('\n')).toContain(a.id);
    expect(filesA.join('\n')).not.toContain(b.id);
    expect(filesB.join('\n')).toContain(b.id);
    expect(filesB.join('\n')).not.toContain(a.id);
    await rm(otherRoot, { recursive: true, force: true });
  });

  it('refuses to follow a symlink at the stored file when reading bytes', async () => {
    const bytes = await raster('png');
    const asset = await store.upload(owner, projectId, {
      bytes,
      mime: 'image/png',
      filename: 'a.png',
    });
    const stored = path.join(root, 'assets', asset.id, 'v1');
    const stats = await lstat(stored);
    expect(stats.isSymbolicLink()).toBe(false);

    const decoy = path.join(root, 'decoy');
    await writeFile(decoy, 'not-an-image');
    await rm(stored);
    await symlink(decoy, stored);
    await expect(store.getBytes(owner, asset.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('creates directories with private mode and does not mkdir via client-supplied segments', async () => {
    const bytes = await raster('png');
    await store.upload(owner, projectId, {
      bytes,
      mime: 'image/png',
      filename: 'nested/../../ok.png',
    });
    const entries = await readdir(root);
    expect(entries.sort()).toEqual(['assets', 'quarantine'].sort());
  });

  it('reopens with a stable instance id and still reads previously stored files', async () => {
    const bytes = await raster('png');
    const uploaded = await store.upload(owner, projectId, {
      bytes,
      mime: 'image/png',
      filename: 'persist.png',
    });
    const reopened = await createAssetStore({
      connection,
      assetDir: root,
      authorizeProject: fakeAuth({ [`${owner}:${projectId}`]: { read: true, write: true } }),
      authorizeDocument: fakeAuth({ [`${owner}:doc-1`]: { read: true, write: true } }),
    });
    expect(reopened.instanceId).toBe(store.instanceId);
    const fetched = await reopened.get(owner, uploaded.id);
    expect(fetched).toEqual(uploaded);
    const payload = await reopened.getBytes(owner, uploaded.id);
    expect(payload.bytes.equals(bytes)).toBe(true);
  });
});
