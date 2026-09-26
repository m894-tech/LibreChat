import path from 'path';
import { constants } from 'fs';
import { Schema } from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { mkdir, open, lstat, readdir, realpath, rename, rm, unlink } from 'fs/promises';
import type { Connection, Model, ClientSession } from 'mongoose';

export const MAX_ASSET_BYTES: number = 10 * 1024 * 1024;
export const MAX_ASSET_DIMENSION = 4096;
export const DESIGN_ASSET_MODEL = 'DesignAsset';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type DesignPrincipal = string | { id: string };

export type DesignAuthorizer = (
  principalId: string,
  resourceId: string,
  write: boolean,
) => Promise<void>;

export class DesignError extends Error {
  readonly status: number;
  readonly statusCode: number;
  readonly code: string;
  readonly body: { code: string; message: string };

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DesignError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
    this.body = { code, message };
  }
}

export interface AssetView {
  id: string;
  projectId: string;
  version: number;
  mime: string;
  size: number;
  width: number;
  height: number;
  checksum: string;
}

export interface AssetBytes {
  id: string;
  version: number;
  mime: string;
  filename: string;
  size: number;
  bytes: Buffer;
}

export interface UploadAssetInput {
  bytes: Buffer;
  mime: string;
  filename: string;
}

export interface CreateAssetStoreOptions {
  /** Production must fence authorization and metadata insert in same Mongo transaction. */
  withProjectWrite?: <T>(
    principalId: string,
    projectId: string,
    work: (session: ClientSession) => Promise<T>,
  ) => Promise<T>;
  connection: Connection;
  assetDir: string;
  authorizeProject: DesignAuthorizer;
  authorizeDocument: DesignAuthorizer;
  /**
   * Stable store identity. Must survive process restart. When omitted,
   * hashed from database name + resolved assetDir.
   */
  instanceId?: string;
}

export interface AssetStore {
  readonly instanceId: string;
  readonly assetDir: string;
  upload(
    principal: DesignPrincipal,
    projectId: string,
    input: UploadAssetInput,
  ): Promise<AssetView>;
  uploadInSession(
    principal: DesignPrincipal,
    projectId: string,
    input: UploadAssetInput,
    session: ClientSession,
  ): Promise<AssetView>;
  cleanupUncommitted(ids: readonly string[]): Promise<void>;
  list(principal: DesignPrincipal, projectId: string): Promise<AssetView[]>;
  get(principal: DesignPrincipal, id: string): Promise<AssetView>;
  getVersion(principal: DesignPrincipal, id: string, version: number): Promise<AssetView>;
  getBytes(principal: DesignPrincipal, id: string, version?: number): Promise<AssetBytes>;
  createBoundRef(
    principal: DesignPrincipal,
    input: { documentId: string; projectId: string; assetId: string; version?: number },
  ): Promise<AssetView>;
  putJobOutput(input: {
    projectId: string;
    bytes: Buffer;
    mime: string;
    filename?: string;
    createdBy: string;
    jobId: string;
  }): Promise<AssetView>;
}

interface DesignAssetDoc {
  id: string;
  instanceId: string;
  projectId: string;
  version: number;
  mime: string;
  size: number;
  width: number;
  height: number;
  checksum: string;
  originalFilename: string;
  storageKey: string;
  createdBy: string;
  sourceJobId?: string;
}

let sharpLoader: Promise<typeof import('sharp') | null> | undefined;

async function loadSharp(): Promise<typeof import('sharp') | null> {
  if (!sharpLoader) {
    sharpLoader = import('sharp')
      .then((mod) => mod.default ?? (mod as unknown as typeof import('sharp')))
      .catch(() => null);
  }
  return sharpLoader;
}

export function principalId(principal: DesignPrincipal): string {
  if (typeof principal === 'string') {
    if (!principal.trim()) {
      throw new DesignError(422, 'VALIDATION', 'principal is required');
    }
    return principal;
  }
  if (!principal?.id?.trim()) {
    throw new DesignError(422, 'VALIDATION', 'principal is required');
  }
  return principal.id;
}

function requireId(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DesignError(422, 'VALIDATION', `${label} is required`);
  }
  if (value.includes('/') || value.includes('\\') || value.includes('\0')) {
    throw new DesignError(422, 'VALIDATION', `${label} is invalid`);
  }
  if (value === '.' || value === '..') {
    throw new DesignError(422, 'VALIDATION', `${label} is invalid`);
  }
  return value;
}

function displayFilename(filename: string): string {
  const trimmed = typeof filename === 'string' ? filename : '';
  const base = trimmed.replace(/\\/g, '/').split('/').pop() || 'upload';
  const cleaned = base.replace(/[\0\r\n]/g, '').slice(0, 255);
  return cleaned || 'upload';
}

function sniffRasterMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function looksLikeSvgOrXml(bytes: Buffer): boolean {
  const head = bytes
    .subarray(0, 512)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
  return (
    head.startsWith('<svg') ||
    head.startsWith('<?xml') ||
    head.includes('<svg') ||
    head.startsWith('<!doctype svg')
  );
}

function normalizeClaimedMime(mime: string): string {
  const claimed = (mime || '').toLowerCase().split(';')[0].trim();
  if (claimed === 'image/jpg') {
    return 'image/jpeg';
  }
  return claimed;
}

export async function validateDesignRaster(input: {
  bytes: Buffer;
  mime: string;
  filename?: string;
}): Promise<{ mime: 'image/png' | 'image/jpeg' | 'image/webp'; width: number; height: number }> {
  const bytes = input.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new DesignError(422, 'VALIDATION', 'Asset bytes are required');
  }
  if (bytes.length > MAX_ASSET_BYTES) {
    throw new DesignError(422, 'VALIDATION', 'Asset exceeds 10 MiB limit');
  }

  const filename = displayFilename(input.filename || 'upload').toLowerCase();
  if (filename.endsWith('.svg') || filename.endsWith('.svgz')) {
    throw new DesignError(422, 'VALIDATION', 'SVG uploads are not allowed');
  }

  const claimed = normalizeClaimedMime(input.mime);
  if (claimed === 'image/svg+xml' || claimed === 'image/svg') {
    throw new DesignError(422, 'VALIDATION', 'SVG uploads are not allowed');
  }
  if (!ALLOWED_MIME.has(claimed)) {
    throw new DesignError(422, 'VALIDATION', 'Only PNG, JPEG, and WebP uploads are allowed');
  }
  if (looksLikeSvgOrXml(bytes)) {
    throw new DesignError(422, 'VALIDATION', 'SVG uploads are not allowed');
  }

  const sniffed = sniffRasterMime(bytes);
  if (!sniffed) {
    throw new DesignError(422, 'VALIDATION', 'File magic does not match PNG, JPEG, or WebP');
  }
  if (sniffed !== claimed) {
    throw new DesignError(422, 'VALIDATION', 'Declared MIME does not match file bytes');
  }

  const sharp = await loadSharp();
  if (!sharp) {
    throw new DesignError(422, 'VALIDATION', 'Image inspection is unavailable');
  }

  let metadata: { format?: string; width?: number; height?: number };
  try {
    metadata = await sharp(bytes, {
      failOn: 'error',
      sequentialRead: true,
      unlimited: false,
    }).metadata();
  } catch {
    throw new DesignError(422, 'VALIDATION', 'Image bytes could not be decoded');
  }

  const formatToMime: Record<string, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    webp: 'image/webp',
  };
  const decodedMime = metadata.format ? formatToMime[metadata.format] : undefined;
  if (!decodedMime || decodedMime !== sniffed) {
    throw new DesignError(422, 'VALIDATION', 'Decoded image format is not an allowed raster type');
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new DesignError(422, 'VALIDATION', 'Image dimensions are invalid');
  }
  if (width > MAX_ASSET_DIMENSION || height > MAX_ASSET_DIMENSION) {
    throw new DesignError(422, 'VALIDATION', 'Image exceeds 4096px dimension cap');
  }

  return { mime: sniffed, width, height };
}

function toView(doc: DesignAssetDoc): AssetView {
  return {
    id: doc.id,
    projectId: doc.projectId,
    version: doc.version,
    mime: doc.mime,
    size: doc.size,
    width: doc.width,
    height: doc.height,
    checksum: doc.checksum,
  };
}

function assertInside(root: string, candidate: string): string {
  const resolved = path.resolve(candidate);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new DesignError(422, 'VALIDATION', 'Invalid storage path');
  }
  return resolved;
}

async function assertNotSymlink(target: string): Promise<void> {
  const stats = await lstat(target);
  if (stats.isSymbolicLink()) {
    throw new DesignError(422, 'VALIDATION', 'Symlink rejected');
  }
}

async function writeExclusive(filePath: string, bytes: Buffer): Promise<void> {
  const handle = await open(
    filePath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    let entries: import('fs').Dirent[];
    try {
      entries = await readdir(dir, { encoding: 'utf8', withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await walk(full);
      } else {
        out.push(path.relative(root, full));
      }
    }
  };
  await walk(root);
  return out;
}

function assetSchema() {
  const schema = new Schema<DesignAssetDoc>(
    {
      id: { type: String, required: true, unique: true },
      instanceId: { type: String, required: true, index: true },
      projectId: { type: String, required: true, index: true },
      version: { type: Number, required: true, min: 1 },
      mime: { type: String, required: true },
      size: { type: Number, required: true },
      width: { type: Number, required: true },
      height: { type: Number, required: true },
      checksum: { type: String, required: true },
      originalFilename: { type: String, required: true },
      storageKey: { type: String, required: true },
      createdBy: { type: String, required: true },
      sourceJobId: { type: String, required: false },
    },
    {
      collection: 'designassets',
      timestamps: true,
      minimize: true,
      id: false,
    },
  );
  schema.index({ instanceId: 1, projectId: 1, id: 1 });
  schema.index({ instanceId: 1, id: 1, version: 1 }, { unique: true });
  schema.set('toJSON', {
    transform: (_doc, ret) => {
      const row = ret as { storageKey?: unknown; _id?: unknown; __v?: unknown };
      delete row.storageKey;
      delete row._id;
      delete row.__v;
      return row;
    },
  });
  return schema;
}

function getAssetModel(connection: Connection): Model<DesignAssetDoc> {
  return (
    (connection.models[DESIGN_ASSET_MODEL] as Model<DesignAssetDoc> | undefined) ??
    connection.model<DesignAssetDoc>(DESIGN_ASSET_MODEL, assetSchema())
  );
}

export async function createAssetStore(options: CreateAssetStoreOptions): Promise<AssetStore> {
  if (!options?.connection) {
    throw new DesignError(422, 'VALIDATION', 'Mongo connection is required');
  }
  if (!options.assetDir || typeof options.assetDir !== 'string') {
    throw new DesignError(422, 'VALIDATION', 'assetDir is required');
  }
  if (
    typeof options.authorizeProject !== 'function' ||
    typeof options.authorizeDocument !== 'function'
  ) {
    throw new DesignError(422, 'VALIDATION', 'authorizer callbacks are required');
  }

  await mkdir(options.assetDir, { recursive: true, mode: 0o700 });
  const resolvedRoot = await realpath(options.assetDir);
  const assetsRoot = path.join(resolvedRoot, 'assets');
  const quarantineRoot = path.join(resolvedRoot, 'quarantine');
  await mkdir(assetsRoot, { recursive: true, mode: 0o700 });
  await mkdir(quarantineRoot, { recursive: true, mode: 0o700 });
  await assertNotSymlink(resolvedRoot);
  await assertNotSymlink(assetsRoot);
  await assertNotSymlink(quarantineRoot);

  const dbName = options.connection.name || options.connection.db?.databaseName || 'design';
  const instanceId =
    options.instanceId?.trim() ||
    createHash('sha256').update(`${dbName}:${resolvedRoot}`).digest('hex');
  const Asset = getAssetModel(options.connection);

  const resolveStoredFile = async (storageKey: string): Promise<string> => {
    const absolute = assertInside(resolvedRoot, path.join(resolvedRoot, storageKey));
    await assertNotSymlink(absolute);
    return absolute;
  };

  const persistValidated = async (input: {
    projectId: string;
    bytes: Buffer;
    mime: string;
    filename: string;
    createdBy: string;
    sourceJobId?: string;
    session?: ClientSession;
  }): Promise<AssetView> => {
    const validated = await validateDesignRaster({
      bytes: input.bytes,
      mime: input.mime,
      filename: input.filename,
    });
    const id = randomUUID();
    const version = 1;
    const checksum = createHash('sha256').update(input.bytes).digest('hex');
    const storageKey = path.join('assets', id, `v${version}`);
    const quarantinePath = path.join(quarantineRoot, randomUUID());
    const finalDir = path.join(assetsRoot, id);
    const finalPath = path.join(finalDir, `v${version}`);

    assertInside(quarantineRoot, quarantinePath);
    assertInside(assetsRoot, finalDir);
    assertInside(assetsRoot, finalPath);
    assertInside(resolvedRoot, await realpath(assetsRoot));
    assertInside(resolvedRoot, await realpath(quarantineRoot));

    let moved = false;
    try {
      await writeExclusive(quarantinePath, input.bytes);
      await mkdir(finalDir, { recursive: true, mode: 0o700 });
      await assertNotSymlink(finalDir);
      assertInside(resolvedRoot, await realpath(finalDir));
      await rename(quarantinePath, finalPath);
      moved = true;
      await assertNotSymlink(finalPath);
      assertInside(resolvedRoot, await realpath(finalPath));

      try {
        const metadata = {
          id,
          instanceId,
          projectId: input.projectId,
          version,
          mime: validated.mime,
          size: input.bytes.length,
          width: validated.width,
          height: validated.height,
          checksum,
          originalFilename: displayFilename(input.filename),
          storageKey,
          createdBy: input.createdBy,
          sourceJobId: input.sourceJobId,
        };
        const save = async (session?: ClientSession) => {
          await options.authorizeProject(input.createdBy, input.projectId, true);
          const [created] = await Asset.create([metadata], session ? { session } : {});
          return toView(created);
        };
        if (input.session) return await save(input.session);
        if (options.withProjectWrite)
          return await options.withProjectWrite(input.createdBy, input.projectId, save);
        return await save();
      } catch (metadataError) {
        // Commit acknowledgement can be lost after metadata commits. Never erase
        // file bytes unless a successful read proves the metadata absent.
        throw metadataError;
      }
    } catch (error) {
      await unlink(quarantinePath).catch(() => undefined);
      if (moved) {
        let definitelyAbsent = false;
        try {
          definitelyAbsent = !(await Asset.exists({ id, instanceId }));
        } catch {
          /* retain private bytes on DB uncertainty */
        }
        if (definitelyAbsent) {
          await unlink(finalPath).catch(() => undefined);
          await rm(finalDir, { recursive: true, force: true }).catch(() => undefined);
        }
      }
      throw error;
    }
  };

  const loadDoc = async (id: string, version?: number): Promise<DesignAssetDoc> => {
    const query: Record<string, unknown> = { instanceId, id: requireId(id, 'asset id') };
    if (version != null) {
      if (!Number.isInteger(version) || version < 1) {
        throw new DesignError(422, 'VALIDATION', 'version is invalid');
      }
      query.version = version;
    }
    const doc = await Asset.findOne(query).sort({ version: -1 }).lean<DesignAssetDoc>();
    if (!doc) {
      throw new DesignError(404, 'NOT_FOUND', 'Not found');
    }
    return doc;
  };

  const authorizeAssetRead = async (principal: DesignPrincipal, doc: DesignAssetDoc) => {
    await options.authorizeProject(principalId(principal), doc.projectId, false);
  };

  return {
    instanceId,
    async uploadInSession(principal, projectId, input, session) {
      const actor = principalId(principal);
      const project = requireId(projectId, 'projectId');
      if (!session.inTransaction())
        throw new DesignError(422, 'VALIDATION', 'Active import transaction required');
      await options.authorizeProject(actor, project, true);
      return persistValidated({
        projectId: project,
        createdBy: actor,
        bytes: input.bytes,
        mime: input.mime,
        filename: input.filename,
        session,
      });
    },
    async cleanupUncommitted(ids) {
      // Only coordinator-created random IDs; preserve files if Mongo outcome is uncertain.
      for (const id of ids) {
        requireId(id, 'assetId');
        if (await Asset.exists({ id, instanceId })) continue;
        const directory = assertInside(assetsRoot, path.join(assetsRoot, id));
        await assertNotSymlink(directory).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        await rm(directory, { recursive: true, force: true });
      }
    },
    assetDir: resolvedRoot,

    async upload(principal, projectId, input) {
      const actor = principalId(principal);
      const project = requireId(projectId, 'projectId');
      await options.authorizeProject(actor, project, true);
      if (input == null || typeof input !== 'object') {
        throw new DesignError(422, 'VALIDATION', 'Upload payload is required');
      }
      const { bytes, mime, filename } = input;
      if (typeof mime !== 'string' || typeof filename !== 'string') {
        throw new DesignError(422, 'VALIDATION', 'mime and filename are required');
      }
      return persistValidated({
        projectId: project,
        bytes,
        mime,
        filename,
        createdBy: actor,
      });
    },

    async list(principal, projectId) {
      const actor = principalId(principal);
      const project = requireId(projectId, 'projectId');
      await options.authorizeProject(actor, project, false);
      const docs = await Asset.find({ instanceId, projectId: project })
        .sort({ createdAt: -1 })
        .lean<DesignAssetDoc[]>();
      return docs.map(toView);
    },

    async get(principal, id) {
      const doc = await loadDoc(id);
      await authorizeAssetRead(principal, doc);
      return toView(doc);
    },

    async getVersion(principal, id, version) {
      const doc = await loadDoc(id, version);
      await authorizeAssetRead(principal, doc);
      return toView(doc);
    },

    async getBytes(principal, id, version) {
      const doc = await loadDoc(id, version);
      await authorizeAssetRead(principal, doc);
      const filePath = await resolveStoredFile(doc.storageKey);
      const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const bytes = await handle.readFile();
        const checksum = createHash('sha256').update(bytes).digest('hex');
        if (checksum !== doc.checksum) {
          throw new DesignError(422, 'VALIDATION', 'Stored asset failed integrity check');
        }
        return {
          id: doc.id,
          version: doc.version,
          mime: doc.mime,
          filename: doc.originalFilename,
          size: bytes.length,
          bytes,
        };
      } finally {
        await handle.close();
      }
    },

    async createBoundRef(principal, input) {
      const actor = principalId(principal);
      const documentId = requireId(input.documentId, 'documentId');
      const project = requireId(input.projectId, 'projectId');
      await options.authorizeDocument(actor, documentId, false);
      await options.authorizeProject(actor, project, false);
      const doc = await loadDoc(input.assetId, input.version);
      if (doc.projectId !== project) {
        throw new DesignError(404, 'NOT_FOUND', 'Not found');
      }
      await authorizeAssetRead(principal, doc);
      return toView(doc);
    },

    async putJobOutput(input) {
      const project = requireId(input.projectId, 'projectId');
      const createdBy = requireId(input.createdBy, 'createdBy');
      const jobId = requireId(input.jobId, 'jobId');
      return persistValidated({
        projectId: project,
        bytes: input.bytes,
        mime: input.mime,
        filename: input.filename || 'job-output',
        createdBy,
        sourceJobId: jobId,
      });
    },
  };
}

export async function listAssetDirFiles(assetDir: string): Promise<string[]> {
  return listRelativeFiles(assetDir);
}
