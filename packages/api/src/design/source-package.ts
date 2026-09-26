/**
 * Pure source-package ZIP exporter.
 *
 * Builds a downloadable archive from a `getSource` wrapper. Asset bytes and
 * fonts are supplied by the caller (`loadAsset` is pre-authorized). This module
 * never reads the filesystem, never fetches URLs, and never parses ZIP input.
 */

import JSZip from 'jszip';
import { createHash } from 'crypto';
import type { AssetRef, DesignPayload, DesignSystemRef } from './types';
import { normalizeSourceImport, SOURCE_IMPORT_PLACEHOLDER_ID } from './source-import';
import { DesignError, DesignErrorCodes } from './errors';
import { sourceSystemResolver } from './source-systems';
import { validateDesignRaster } from './assets';
import { validateDocument } from './operations';

export const SOURCE_PACKAGE_SCHEMA_VERSION: 1 = 1;
export const SOURCE_PACKAGE_MAX_ASSETS: number = 200;
export const SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES: number = 50 * 1024 * 1024;
export const SOURCE_PACKAGE_MAX_COMPRESSED_BYTES: number = 50 * 1024 * 1024;
export const SOURCE_PACKAGE_PLACEHOLDER_PROJECT_ID: string = 'sourcepackage';
export const SOURCE_PACKAGE_SOURCE_FILENAME: string = 'source.json';
export const SOURCE_PACKAGE_MANIFEST_FILENAME: string = 'manifest.json';

const SAFE_SEGMENT_RE: RegExp = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FONT_EXT_RE: RegExp = /\.(?:ttf|otf|woff2|woff)$/i;
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export type SourcePackageAssetBytes = {
  bytes: Buffer;
  mime: string;
};

export type SourcePackageAssetLoader = (
  id: string,
  version: number,
) => Promise<SourcePackageAssetBytes>;

export type SourcePackageFontInput = {
  filename: string;
  bytes: Buffer;
  licenseText: string;
};

export type SourcePackageInput = {
  source: unknown;
  loadAsset: SourcePackageAssetLoader;
  fonts: Array<SourcePackageFontInput>;
};

export type SourcePackageManifestFile = {
  sha256: string;
  size: number;
  mime: string;
};

export type SourcePackageFileMap = {
  [path: string]: SourcePackageManifestFile;
};

export type SourcePackageManifest = {
  schemaVersion: 1;
  files: SourcePackageFileMap;
};

type PendingFile = {
  path: string;
  bytes: Buffer;
  mime: string;
};

/**
 * Pack a validated `getSource` wrapper, pinned asset versions, and licensed
 * fonts into a ZIP. Authorization for `loadAsset` is the caller's job.
 */
export async function buildSourcePackage(input: SourcePackageInput): Promise<Buffer> {
  if (!isPlainObject(input)) {
    failSchema('source package input must be an object');
  }
  if (typeof input.loadAsset !== 'function') {
    failSchema('loadAsset is required');
  }
  if (!Array.isArray(input.fonts)) {
    failSchema('fonts must be an array');
  }

  const sourceObject: Record<string, unknown> = cloneSourceObject(input.source);
  const targetProjectId: string = resolveTargetProjectId(sourceObject);
  const imported = normalizeSourceImport(input.source, targetProjectId);

  const candidate: {
    id: string;
    projectId: string;
    kind: 'canvas';
    schemaVersion: 1;
    title: string;
    revision: number;
    designSystem: DesignSystemRef;
    payload: DesignPayload;
    assetRefs: AssetRef[];
    archived: boolean;
  } = {
    id: SOURCE_IMPORT_PLACEHOLDER_ID,
    projectId: targetProjectId,
    kind: 'canvas',
    schemaVersion: 1,
    title: imported.document.title,
    revision: 1,
    designSystem: imported.document.designSystem,
    payload: imported.document.payload,
    assetRefs: imported.assetRefs,
    archived: false,
  };
  validateDocument(candidate, sourceSystemResolver(sourceObject).resolver);

  const assetRefs: AssetRef[] = uniqueAssetRefs(imported.assetRefs);
  if (assetRefs.length > SOURCE_PACKAGE_MAX_ASSETS) {
    failQuota(`source package exceeds ${SOURCE_PACKAGE_MAX_ASSETS} assets`);
  }

  const files: PendingFile[] = [];
  const names: Set<string> = new Set<string>();
  let uncompressed: number = 0;

  const sourceBytes: Buffer = Buffer.from(JSON.stringify(sourceObject), 'utf8');
  addFile(files, names, SOURCE_PACKAGE_SOURCE_FILENAME, sourceBytes, 'application/json', () => {
    uncompressed += sourceBytes.length;
    assertUncompressed(uncompressed);
  });

  for (const font of input.fonts) {
    const packed = packFont(font);
    addFile(files, names, packed.fontPath, packed.fontBytes, packed.fontMime, () => {
      uncompressed += packed.fontBytes.length;
      assertUncompressed(uncompressed);
    });
    addFile(files, names, packed.licensePath, packed.licenseBytes, 'text/plain', () => {
      uncompressed += packed.licenseBytes.length;
      assertUncompressed(uncompressed);
    });
  }

  for (const ref of assetRefs) {
    const loaded: SourcePackageAssetBytes = await input.loadAsset(ref.assetId, ref.version);
    const packed = await packAsset(ref, loaded);
    addFile(files, names, packed.path, packed.bytes, packed.mime, () => {
      uncompressed += packed.bytes.length;
      assertUncompressed(uncompressed);
    });
  }

  const manifest: SourcePackageManifest = {
    schemaVersion: SOURCE_PACKAGE_SCHEMA_VERSION,
    files: buildFileMap(files),
  };
  const manifestBytes: Buffer = Buffer.from(JSON.stringify(manifest), 'utf8');
  uncompressed += manifestBytes.length;
  assertUncompressed(uncompressed);
  if (names.has(SOURCE_PACKAGE_MANIFEST_FILENAME)) {
    failSchema(`duplicate resource name "${SOURCE_PACKAGE_MANIFEST_FILENAME}"`);
  }

  const zip: JSZip = new JSZip();
  zip.file(SOURCE_PACKAGE_MANIFEST_FILENAME, manifestBytes);
  for (const file of files) {
    zip.file(file.path, file.bytes, { createFolders: false });
  }

  const compressed: Buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const zipBytes: Buffer = Buffer.isBuffer(compressed) ? compressed : Buffer.from(compressed);
  if (zipBytes.length > SOURCE_PACKAGE_MAX_COMPRESSED_BYTES) {
    failQuota('source package exceeds compressed size limit');
  }
  return zipBytes;
}

function cloneSourceObject(source: unknown): Record<string, unknown> {
  const parsed: unknown = typeof source === 'string' ? parseJsonObject(source) : source;
  if (!isPlainObject(parsed)) {
    failSchema('source must be a JSON object');
  }
  return JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    failSchema('source is not valid JSON');
  }
}

function resolveTargetProjectId(source: Record<string, unknown>): string {
  if (typeof source.projectId === 'string' && source.projectId.length > 0) {
    return source.projectId;
  }
  const snapshot: unknown = source.snapshot;
  if (
    isPlainObject(snapshot) &&
    typeof snapshot.projectId === 'string' &&
    snapshot.projectId.length > 0
  ) {
    return snapshot.projectId;
  }
  return SOURCE_PACKAGE_PLACEHOLDER_PROJECT_ID;
}

function uniqueAssetRefs(refs: AssetRef[]): AssetRef[] {
  const seen: Set<string> = new Set<string>();
  const unique: AssetRef[] = [];
  for (const ref of refs) {
    const key: string = `${ref.assetId}@${ref.version}`;
    if (seen.has(key)) {
      failSchema(`duplicate assetRef ${key}`);
    }
    seen.add(key);
    unique.push({ assetId: ref.assetId, version: ref.version });
  }
  return unique;
}

function packFont(font: SourcePackageFontInput): {
  fontPath: string;
  fontBytes: Buffer;
  fontMime: string;
  licensePath: string;
  licenseBytes: Buffer;
} {
  if (!isPlainObject(font)) {
    failSchema('font entry must be an object');
  }
  const filename: string = assertSafeFilename(font.filename, 'font filename');
  if (!FONT_EXT_RE.test(filename)) {
    failSchema(`unsafe font filename "${filename}"`);
  }
  if (!Buffer.isBuffer(font.bytes) || font.bytes.length === 0) {
    failSchema(`font "${filename}" bytes are required`);
  }
  if (typeof font.licenseText !== 'string' || font.licenseText.trim().length === 0) {
    failSchema(`font "${filename}" license is empty`);
  }
  const licenseBytes: Buffer = Buffer.from(font.licenseText, 'utf8');
  if (licenseBytes.length === 0) {
    failSchema(`font "${filename}" license is empty`);
  }
  return {
    fontPath: `fonts/${filename}`,
    fontBytes: font.bytes,
    fontMime: fontMime(filename),
    licensePath: `fonts/${filename}.license`,
    licenseBytes,
  };
}

async function packAsset(
  ref: AssetRef,
  loaded: SourcePackageAssetBytes,
): Promise<{ path: string; bytes: Buffer; mime: string }> {
  assertSafeFilename(ref.assetId, 'asset id');
  if (!Number.isInteger(ref.version) || ref.version < 1) {
    failSchema('asset version is invalid');
  }
  if (loaded == null || typeof loaded !== 'object') {
    failSchema(`asset ${ref.assetId}@${ref.version} is missing`);
  }
  const bytes: unknown = loaded.bytes;
  const mime: unknown = loaded.mime;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    failSchema(`asset ${ref.assetId}@${ref.version} is missing or corrupt`);
  }
  if (typeof mime !== 'string' || mime.length === 0) {
    failSchema(`asset ${ref.assetId}@${ref.version} mime is required`);
  }

  let validatedMime: 'image/png' | 'image/jpeg' | 'image/webp';
  try {
    const claimedExt: string = MIME_TO_EXT[normalizeMime(mime)] ?? 'bin';
    const validated = await validateDesignRaster({
      bytes,
      mime,
      filename: `${ref.assetId}-v${ref.version}.${claimedExt}`,
    });
    validatedMime = validated.mime;
  } catch (error: unknown) {
    throw rasterError(error, ref);
  }

  const ext: string | undefined = MIME_TO_EXT[validatedMime];
  if (ext === undefined) {
    failSchema(`asset ${ref.assetId}@${ref.version} mime is not an allowed raster type`);
  }
  return {
    path: `assets/${ref.assetId}-v${ref.version}.${ext}`,
    bytes,
    mime: validatedMime,
  };
}

function rasterError(error: unknown, ref: AssetRef): DesignError {
  if (error instanceof DesignError) {
    return error;
  }
  if (typeof error === 'object' && error !== null && 'status' in error && 'code' in error) {
    const statusRaw: unknown = (error as { status: unknown }).status;
    const codeRaw: unknown = (error as { code: unknown }).code;
    const messageRaw: unknown = 'message' in error ? error.message : undefined;
    const status: number =
      typeof statusRaw === 'number' && Number.isFinite(statusRaw) ? statusRaw : 422;
    const code: string =
      codeRaw === 'VALIDATION' || codeRaw === 'validation'
        ? DesignErrorCodes.SCHEMA
        : String(codeRaw);
    const message: string =
      typeof messageRaw === 'string' && messageRaw.length > 0
        ? messageRaw
        : `asset ${ref.assetId}@${ref.version} is missing, corrupt, or mime-mismatched`;
    return new DesignError(status, code, message);
  }
  return new DesignError(
    422,
    DesignErrorCodes.SCHEMA,
    `asset ${ref.assetId}@${ref.version} is missing, corrupt, or mime-mismatched`,
  );
}

function addFile(
  files: PendingFile[],
  names: Set<string>,
  zipPath: string,
  bytes: Buffer,
  mime: string,
  account: () => void,
): void {
  assertSafeZipPath(zipPath);
  if (names.has(zipPath)) {
    failSchema(`duplicate resource name "${zipPath}"`);
  }
  names.add(zipPath);
  account();
  files.push({ path: zipPath, bytes, mime });
}

function buildFileMap(files: PendingFile[]): SourcePackageFileMap {
  const map: SourcePackageFileMap = {};
  for (const file of files) {
    map[file.path] = {
      sha256: createHash('sha256').update(file.bytes).digest('hex'),
      size: file.bytes.length,
      mime: file.mime,
    };
  }
  return map;
}

function assertSafeZipPath(zipPath: string): void {
  if (typeof zipPath !== 'string' || zipPath.length === 0) {
    failSchema('resource path is invalid');
  }
  if (
    zipPath.includes('\\') ||
    zipPath.includes('\0') ||
    zipPath.includes('\r') ||
    zipPath.includes('\n') ||
    zipPath.startsWith('/') ||
    zipPath.startsWith('./') ||
    zipPath.includes('//')
  ) {
    failSchema(`unsafe resource path "${zipPath}"`);
  }
  const segments: string[] = zipPath.split('/');
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      !SAFE_SEGMENT_RE.test(segment)
    ) {
      failSchema(`unsafe resource path "${zipPath}"`);
    }
  }
}

function assertSafeFilename(filename: string, label: string): string {
  if (typeof filename !== 'string' || filename.length === 0) {
    failSchema(`${label} is invalid`);
  }
  if (
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    filename.includes('..') ||
    filename === '.' ||
    filename === '..' ||
    !SAFE_SEGMENT_RE.test(filename)
  ) {
    failSchema(`unsafe ${label} "${filename}"`);
  }
  return filename;
}

function fontMime(filename: string): string {
  const lower: string = filename.toLowerCase();
  if (lower.endsWith('.woff2')) {
    return 'font/woff2';
  }
  if (lower.endsWith('.woff')) {
    return 'font/woff';
  }
  if (lower.endsWith('.otf')) {
    return 'font/otf';
  }
  if (lower.endsWith('.ttf')) {
    return 'font/ttf';
  }
  return 'application/octet-stream';
}

function normalizeMime(mime: string): string {
  const claimed: string = mime.toLowerCase().split(';')[0].trim();
  if (claimed === 'image/jpg') {
    return 'image/jpeg';
  }
  return claimed;
}

function assertUncompressed(total: number): void {
  if (total > SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES) {
    failQuota('source package exceeds 50MiB');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function failSchema(message: string): never {
  throw new DesignError(422, DesignErrorCodes.SCHEMA, message);
}

function failQuota(message: string): never {
  throw new DesignError(429, DesignErrorCodes.QUOTA, message);
}
