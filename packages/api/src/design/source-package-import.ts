/**
 * Pure source-package ZIP parser.
 *
 * Consumes an exported archive and returns validated source JSON plus asset and
 * font buffers mapped to the original ZIP paths. This module never writes the
 * filesystem, never installs fonts, and never opens a network connection.
 * Decompression is streamed through yauzl (`lazyEntries` + `validateEntrySizes`)
 * with byte caps applied before buffering; JSZip.loadAsync is not used.
 */

import yauzl from 'yauzl';
import { createHash } from 'crypto';
import type { Entry, ZipFile } from 'yauzl';
import type { Readable } from 'stream';
import type { SourcePackageManifest, SourcePackageManifestFile } from './source-package';
import type { SourceImportResult } from './source-import';
import {
  SOURCE_PACKAGE_MANIFEST_FILENAME,
  SOURCE_PACKAGE_MAX_ASSETS,
  SOURCE_PACKAGE_MAX_COMPRESSED_BYTES,
  SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES,
  SOURCE_PACKAGE_PLACEHOLDER_PROJECT_ID,
  SOURCE_PACKAGE_SCHEMA_VERSION,
  SOURCE_PACKAGE_SOURCE_FILENAME,
} from './source-package';
import { DesignError, DesignErrorCodes } from './errors';
import { normalizeSourceImport } from './source-import';
import { validateDesignRaster } from './assets';

export const SOURCE_PACKAGE_MAX_ENTRIES: number = 500;

const SAFE_SEGMENT_RE: RegExp = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FONT_EXT_RE: RegExp = /\.(?:ttf|otf|woff2|woff)$/i;
const ASSET_PATH_RE: RegExp =
  /^assets\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})-v([1-9][0-9]*)\.(png|jpg|webp)$/;
const SHA256_RE: RegExp = /^[a-f0-9]{64}$/;
const ZIP_STORE: number = 0;
const ZIP_DEFLATE: number = 8;
const ZIP_UNIX_OS: number = 3;
const UNIX_S_IFMT: number = 0xf000;
const UNIX_S_IFLNK: number = 0xa000;
const UNIX_S_IFDIR: number = 0x4000;
const MANIFEST_ROOT_KEYS: ReadonlySet<string> = new Set(['schemaVersion', 'files']);
const MANIFEST_FILE_KEYS: ReadonlySet<string> = new Set(['sha256', 'size', 'mime']);
const EXT_TO_MIME: { [ext: string]: 'image/png' | 'image/jpeg' | 'image/webp' } = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

export type SourcePackageParsedAsset = {
  path: string;
  assetId: string;
  originalId: string;
  version: number;
  bytes: Buffer;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
};

export type SourcePackageParsedFont = {
  path: string;
  filename: string;
  bytes: Buffer;
  mime: string;
  licensePath: string;
  licenseText: string;
};

export type SourcePackageAssetMap = {
  [path: string]: SourcePackageParsedAsset;
};

export type SourcePackageFontMap = {
  [path: string]: SourcePackageParsedFont;
};

export type SourcePackageParseResult = {
  source: Record<string, unknown>;
  imported: SourceImportResult;
  assets: SourcePackageAssetMap;
  fonts: SourcePackageFontMap;
  manifest: SourcePackageManifest;
};

type ExtractedFiles = Map<string, Buffer>;

type ZipWalkState = {
  files: ExtractedFiles;
  names: Set<string>;
  totalDecompressed: number;
  totalCompressed: number;
  entriesSeen: number;
};

/**
 * Parse a source-package ZIP into validated source JSON and original-path
 * asset/font buffers. Authorization, persistence, and font installation are
 * the coordinator's job.
 */
export async function parseSourcePackage(bytes: unknown): Promise<SourcePackageParseResult> {
  const zipBytes: Buffer = requireZipBuffer(bytes);
  if (zipBytes.length > SOURCE_PACKAGE_MAX_COMPRESSED_BYTES) {
    failQuota('source package exceeds 50MiB');
  }

  const extracted: ExtractedFiles = await extractZip(zipBytes);
  const manifestBytes: Buffer | undefined = extracted.get(SOURCE_PACKAGE_MANIFEST_FILENAME);
  if (manifestBytes === undefined) {
    failSchema('source package is missing manifest.json');
  }

  const manifest: SourcePackageManifest = parseManifest(manifestBytes);
  assertFileSet(extracted, manifest);
  assertAllowedListedPaths(manifest);
  assertManifestIntegrity(extracted, manifest);

  const sourceBytes: Buffer | undefined = extracted.get(SOURCE_PACKAGE_SOURCE_FILENAME);
  if (sourceBytes === undefined) {
    failSchema('source package is missing source.json');
  }

  const source: Record<string, unknown> = parseSourceObject(sourceBytes);
  const imported: SourceImportResult = normalizeSourceImport(
    source,
    resolveTargetProjectId(source),
  );
  const assets: SourcePackageAssetMap = await parseAssets(extracted, manifest, imported);
  const fonts: SourcePackageFontMap = parseFonts(extracted, manifest);

  return { source, imported, assets, fonts, manifest };
}

function requireZipBuffer(bytes: unknown): Buffer {
  if (bytes == null) {
    failSchema('source package bytes are required');
  }
  if (!Buffer.isBuffer(bytes)) {
    failSchema('source package must be a zip buffer');
  }
  if (bytes.length === 0) {
    failSchema('source package is empty');
  }
  return bytes;
}

function extractZip(zipBytes: Buffer): Promise<ExtractedFiles> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      zipBytes,
      {
        lazyEntries: true,
        validateEntrySizes: true,
        strictFileNames: true,
        decodeStrings: true,
      },
      (openErr: Error | null, zipfile: ZipFile | undefined) => {
        if (openErr != null || zipfile == null) {
          reject(asSchemaError(openErr, 'source package is not a valid zip archive'));
          return;
        }

        if (zipfile.entryCount > SOURCE_PACKAGE_MAX_ENTRIES) {
          closeZip(zipfile);
          reject(
            new DesignError(
              429,
              DesignErrorCodes.QUOTA,
              `source package exceeds ${SOURCE_PACKAGE_MAX_ENTRIES} entries`,
            ),
          );
          return;
        }
        if (zipfile.entryCount < 1) {
          closeZip(zipfile);
          reject(new DesignError(422, DesignErrorCodes.SCHEMA, 'source package is empty'));
          return;
        }

        const state: ZipWalkState = {
          files: new Map<string, Buffer>(),
          names: new Set<string>(),
          totalDecompressed: 0,
          totalCompressed: 0,
          entriesSeen: 0,
        };
        let settled: boolean = false;

        const finish = (error: Error | null): void => {
          if (settled) {
            return;
          }
          settled = true;
          closeZip(zipfile);
          if (error != null) {
            reject(asZipWalkError(error));
            return;
          }
          resolve(state.files);
        };

        zipfile.on('error', (error: Error) => {
          finish(error);
        });
        zipfile.on('end', () => {
          finish(null);
        });
        zipfile.on('entry', (entry: Entry) => {
          if (settled) {
            return;
          }
          let skip: boolean = false;
          try {
            skip = acceptEntry(entry, state);
          } catch (error: unknown) {
            finish(asZipWalkError(error));
            return;
          }
          if (skip) {
            zipfile.readEntry();
            return;
          }

          zipfile.openReadStream(entry, (streamErr: Error | null, stream: Readable | undefined) => {
            if (settled) {
              return;
            }
            if (streamErr != null || stream == null) {
              finish(asSchemaError(streamErr, 'source package entry could not be read'));
              return;
            }
            readCappedEntry(stream, state, entry.fileName, finish, () => {
              if (!settled) {
                zipfile.readEntry();
              }
            });
          });
        });

        zipfile.readEntry();
      },
    );
  });
}

function acceptEntry(entry: Entry, state: ZipWalkState): boolean {
  state.entriesSeen += 1;
  if (state.entriesSeen > SOURCE_PACKAGE_MAX_ENTRIES) {
    failQuota(`source package exceeds ${SOURCE_PACKAGE_MAX_ENTRIES} entries`);
  }

  const name: string = entry.fileName;
  if (typeof name !== 'string' || name.length === 0) {
    failSchema('source package contains an unnamed entry');
  }
  if (state.names.has(name)) {
    failSchema(`source package contains duplicate path "${name}"`);
  }
  state.names.add(name);

  if (
    entry.isEncrypted() ||
    (entry.generalPurposeBitFlag & 0x1) !== 0 ||
    (entry.generalPurposeBitFlag & 0x40) !== 0
  ) {
    failSchema('source package contains encrypted entries');
  }
  if (entry.compressionMethod !== ZIP_STORE && entry.compressionMethod !== ZIP_DEFLATE) {
    failSchema('source package uses unsupported compression');
  }
  if (isSymlinkEntry(entry)) {
    failSchema(`source package contains a forbidden entry "${name}"`);
  }
  if (isDirectoryEntry(entry)) {
    const trimmed: string = name.endsWith('/') ? name.slice(0, -1) : name;
    if (trimmed.length > 0) {
      assertSafeZipPath(trimmed);
    }
    return true;
  }
  assertSafeZipPath(name);

  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0)
    failSchema('Invalid uncompressed entry size');
  if (entry.uncompressedSize > SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES - state.totalDecompressed)
    failQuota('source package exceeds 50MiB');
  if (name === 'source.json' && entry.uncompressedSize > 2 * 1024 * 1024)
    failQuota('source.json exceeds 2MiB');
  if (name === 'manifest.json' && entry.uncompressedSize > 1024 * 1024)
    failQuota('manifest.json exceeds 1MiB');
  const compressedSize: number = entry.compressedSize;
  if (!Number.isFinite(compressedSize) || compressedSize < 0) {
    failSchema(`source package entry "${name}" has an invalid compressed size`);
  }
  if (compressedSize > SOURCE_PACKAGE_MAX_COMPRESSED_BYTES) {
    failQuota('source package exceeds 50MiB');
  }
  state.totalCompressed += compressedSize;
  if (state.totalCompressed > SOURCE_PACKAGE_MAX_COMPRESSED_BYTES) {
    failQuota('source package exceeds 50MiB');
  }
  return false;
}

function readCappedEntry(
  stream: Readable,
  state: ZipWalkState,
  name: string,
  finish: (error: Error | null) => void,
  onDone: () => void,
): void {
  const remaining: number = SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES - state.totalDecompressed;
  if (remaining < 0) {
    stream.destroy();
    finish(new DesignError(429, DesignErrorCodes.QUOTA, 'source package exceeds 50MiB'));
    return;
  }

  const chunks: Buffer[] = [];
  let size: number = 0;
  let capped: boolean = false;

  stream.on('data', (chunk: Buffer | string) => {
    if (capped) {
      return;
    }
    const buf: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > remaining) {
      capped = true;
      stream.destroy();
      finish(new DesignError(429, DesignErrorCodes.QUOTA, 'source package exceeds 50MiB'));
      return;
    }
    chunks.push(buf);
  });
  stream.on('error', (error: Error) => {
    if (capped) {
      return;
    }
    finish(error);
  });
  stream.on('end', () => {
    if (capped) {
      return;
    }
    state.totalDecompressed += size;
    if (state.totalDecompressed > SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES) {
      finish(new DesignError(429, DesignErrorCodes.QUOTA, 'source package exceeds 50MiB'));
      return;
    }
    state.files.set(name, Buffer.concat(chunks, size));
    onDone();
  });
}

function isSymlinkEntry(entry: Entry): boolean {
  const os: number = (entry.versionMadeBy >> 8) & 0xff;
  if (os !== ZIP_UNIX_OS) {
    return false;
  }
  const mode: number = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & UNIX_S_IFMT) === UNIX_S_IFLNK;
}

function isDirectoryEntry(entry: Entry): boolean {
  if (entry.fileName.endsWith('/')) {
    return true;
  }
  const os: number = (entry.versionMadeBy >> 8) & 0xff;
  if (os !== ZIP_UNIX_OS) {
    return false;
  }
  const mode: number = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & UNIX_S_IFMT) === UNIX_S_IFDIR;
}

function parseManifest(bytes: Buffer): SourcePackageManifest {
  const parsed: unknown = parseJsonBytes(bytes, 'manifest.json');
  if (!isPlainObject(parsed)) {
    failSchema('manifest.json must be a JSON object');
  }
  for (const key of Object.keys(parsed)) {
    if (!MANIFEST_ROOT_KEYS.has(key)) {
      failSchema(`manifest has unknown field "${key}"`);
    }
  }
  if (parsed.schemaVersion !== SOURCE_PACKAGE_SCHEMA_VERSION) {
    failSchema('source package schemaVersion must be 1');
  }
  if (!isPlainObject(parsed.files)) {
    failSchema('manifest.files must be an object');
  }

  const files: { [path: string]: SourcePackageManifestFile } = {};
  for (const path of Object.keys(parsed.files)) {
    assertSafeZipPath(path);
    if (path === SOURCE_PACKAGE_MANIFEST_FILENAME) {
      failSchema('manifest.json must not list itself');
    }
    const raw: unknown = parsed.files[path];
    files[path] = parseManifestFile(path, raw);
  }

  const manifest: SourcePackageManifest = {
    schemaVersion: SOURCE_PACKAGE_SCHEMA_VERSION,
    files,
  };
  return manifest;
}

function parseManifestFile(path: string, raw: unknown): SourcePackageManifestFile {
  if (!isPlainObject(raw)) {
    failSchema(`manifest entry "${path}" must be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (!MANIFEST_FILE_KEYS.has(key)) {
      failSchema(`manifest entry "${path}" has unknown field "${key}"`);
    }
  }
  if (typeof raw.sha256 !== 'string' || !SHA256_RE.test(raw.sha256)) {
    failSchema(`manifest entry "${path}" sha256 is invalid`);
  }
  if (typeof raw.size !== 'number' || !Number.isInteger(raw.size) || raw.size < 0) {
    failSchema(`manifest entry "${path}" size is invalid`);
  }
  if (typeof raw.mime !== 'string' || raw.mime.length === 0) {
    failSchema(`manifest entry "${path}" mime is invalid`);
  }
  const file: SourcePackageManifestFile = {
    sha256: raw.sha256,
    size: raw.size,
    mime: raw.mime,
  };
  return file;
}

function assertAllowedListedPaths(manifest: SourcePackageManifest): void {
  if (!Object.prototype.hasOwnProperty.call(manifest.files, SOURCE_PACKAGE_SOURCE_FILENAME)) {
    failSchema('source package is missing source.json');
  }
  for (const listedPath of Object.keys(manifest.files)) {
    if (listedPath === SOURCE_PACKAGE_SOURCE_FILENAME) {
      continue;
    }
    if (listedPath.startsWith('assets/') || listedPath.startsWith('fonts/')) {
      continue;
    }
    failSchema(`source package contains unsupported file "${listedPath}"`);
  }
}

function assertFileSet(extracted: ExtractedFiles, manifest: SourcePackageManifest): void {
  const listed: Set<string> = new Set<string>(Object.keys(manifest.files));
  for (const name of extracted.keys()) {
    if (name === SOURCE_PACKAGE_MANIFEST_FILENAME) {
      continue;
    }
    if (!listed.has(name)) {
      failSchema(`source package contains unlisted file "${name}"`);
    }
  }
  for (const name of listed) {
    if (!extracted.has(name)) {
      failSchema(`source package is missing listed file "${name}"`);
    }
  }
}

function assertManifestIntegrity(extracted: ExtractedFiles, manifest: SourcePackageManifest): void {
  for (const path of Object.keys(manifest.files)) {
    const listed: SourcePackageManifestFile = manifest.files[path];
    const bytes: Buffer | undefined = extracted.get(path);
    if (bytes === undefined) {
      failSchema(`source package is missing listed file "${path}"`);
    }
    if (bytes.length !== listed.size) {
      failSchema(`source package file "${path}" size does not match the manifest`);
    }
    const digest: string = createHash('sha256').update(bytes).digest('hex');
    if (digest !== listed.sha256) {
      failSchema(`source package file "${path}" hash does not match the manifest`);
    }
  }
}

function parseSourceObject(bytes: Buffer): Record<string, unknown> {
  const parsed: unknown = parseJsonBytes(bytes, SOURCE_PACKAGE_SOURCE_FILENAME);
  if (!isPlainObject(parsed)) {
    failSchema('source.json must be a JSON object');
  }
  return parsed;
}

async function parseAssets(
  extracted: ExtractedFiles,
  manifest: SourcePackageManifest,
  imported: SourceImportResult,
): Promise<SourcePackageAssetMap> {
  const assets: SourcePackageAssetMap = {};
  const seenRefs: Set<string> = new Set<string>();
  let count: number = 0;

  for (const path of Object.keys(manifest.files)) {
    if (!path.startsWith('assets/')) {
      continue;
    }
    const match: RegExpExecArray | null = ASSET_PATH_RE.exec(path);
    if (match == null) {
      failSchema(`unsafe resource path "${path}"`);
    }
    const assetId: string = match[1];
    const version: number = Number(match[2]);
    const ext: string = match[3];
    const refKey: string = `${assetId}@${version}`;
    if (seenRefs.has(refKey)) {
      failSchema(`duplicate asset ${refKey}`);
    }
    seenRefs.add(refKey);
    count += 1;
    if (count > SOURCE_PACKAGE_MAX_ASSETS) {
      failQuota(`source package exceeds ${SOURCE_PACKAGE_MAX_ASSETS} assets`);
    }

    const expectedMime: 'image/png' | 'image/jpeg' | 'image/webp' | undefined = EXT_TO_MIME[ext];
    if (expectedMime === undefined) {
      failSchema(`asset "${path}" mime is not an allowed raster type`);
    }
    const listed: SourcePackageManifestFile = manifest.files[path];
    if (normalizeMime(listed.mime) !== expectedMime) {
      failSchema(`asset "${path}" mime does not match the filename`);
    }
    const bytes: Buffer | undefined = extracted.get(path);
    if (bytes === undefined) {
      failSchema(`source package is missing listed file "${path}"`);
    }

    let mime: 'image/png' | 'image/jpeg' | 'image/webp';
    try {
      const validated = await validateDesignRaster({
        bytes,
        mime: expectedMime,
        filename: path.split('/').pop() ?? path,
      });
      mime = validated.mime;
    } catch (error: unknown) {
      throw rasterError(error, path);
    }
    if (mime !== expectedMime) {
      failSchema(`asset "${path}" mime does not match the filename`);
    }

    assets[path] = {
      path,
      assetId,
      originalId: assetId,
      version,
      bytes,
      mime,
    };
  }

  const expectedRefs: Set<string> = new Set<string>();
  for (const ref of imported.assetRefs) {
    const key: string = `${ref.assetId}@${ref.version}`;
    if (expectedRefs.has(key)) {
      failSchema(`duplicate assetRef ${key}`);
    }
    expectedRefs.add(key);
    if (!seenRefs.has(key)) {
      failSchema(`source package is missing asset ${key}`);
    }
  }
  for (const key of seenRefs) {
    if (!expectedRefs.has(key)) {
      failSchema(`source package contains unreferenced asset ${key}`);
    }
  }

  return assets;
}

function parseFonts(
  extracted: ExtractedFiles,
  manifest: SourcePackageManifest,
): SourcePackageFontMap {
  const fontPaths: string[] = [];
  const licensePaths: Set<string> = new Set<string>();

  for (const path of Object.keys(manifest.files)) {
    if (!path.startsWith('fonts/')) {
      continue;
    }
    if (path.endsWith('.license')) {
      licensePaths.add(path);
      continue;
    }
    fontPaths.push(path);
  }

  const fonts: SourcePackageFontMap = {};
  for (const path of fontPaths) {
    const filename: string = path.slice('fonts/'.length);
    assertSafeFilename(filename, 'font filename');
    if (!FONT_EXT_RE.test(filename)) {
      failSchema(`unsafe font filename "${filename}"`);
    }
    const licensePath: string = `${path}.license`;
    if (!licensePaths.has(licensePath)) {
      failSchema(`font "${filename}" license is missing`);
    }
    licensePaths.delete(licensePath);

    const listed: SourcePackageManifestFile = manifest.files[path];
    const expectedMime: string = fontMime(filename);
    if (normalizeMime(listed.mime) !== expectedMime) {
      failSchema(`font "${filename}" mime does not match the filename`);
    }
    const licenseListed: SourcePackageManifestFile = manifest.files[licensePath];
    if (normalizeMime(licenseListed.mime) !== 'text/plain') {
      failSchema(`font "${filename}" license mime is invalid`);
    }

    const bytes: Buffer | undefined = extracted.get(path);
    const licenseBytes: Buffer | undefined = extracted.get(licensePath);
    if (bytes === undefined || bytes.length === 0) {
      failSchema(`font "${filename}" bytes are required`);
    }
    if (licenseBytes === undefined) {
      failSchema(`font "${filename}" license is missing`);
    }
    const licenseText: string = licenseBytes.toString('utf8');
    if (licenseText.trim().length === 0) {
      failSchema(`font "${filename}" license is empty`);
    }

    fonts[path] = {
      path,
      filename,
      bytes,
      mime: expectedMime,
      licensePath,
      licenseText,
    };
  }

  if (licensePaths.size > 0) {
    const extra: string = Array.from(licensePaths)[0];
    failSchema(`font license "${extra}" is unpaired`);
  }

  return fonts;
}

function parseJsonBytes(bytes: Buffer, label: string): unknown {
  const text: string = bytes.toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    failSchema(`${label} is not valid JSON`);
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
    zipPath.includes('//') ||
    /^[A-Za-z]:/.test(zipPath)
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

function rasterError(error: unknown, path: string): DesignError {
  if (error instanceof DesignError) {
    return error;
  }
  if (typeof error === 'object' && error !== null && 'status' in error && 'code' in error) {
    const statusRaw: unknown = (error as { status: unknown }).status;
    const codeRaw: unknown = (error as { code: unknown }).code;
    const messageRaw: unknown =
      'message' in error ? (error as { message: unknown }).message : undefined;
    const status: number =
      typeof statusRaw === 'number' && Number.isFinite(statusRaw) ? statusRaw : 422;
    const code: string =
      codeRaw === 'VALIDATION' || codeRaw === 'validation'
        ? DesignErrorCodes.SCHEMA
        : String(codeRaw);
    const message: string =
      typeof messageRaw === 'string' && messageRaw.length > 0
        ? messageRaw
        : `asset "${path}" is missing, corrupt, or mime-mismatched`;
    return new DesignError(status, code, message);
  }
  return new DesignError(
    422,
    DesignErrorCodes.SCHEMA,
    `asset "${path}" is missing, corrupt, or mime-mismatched`,
  );
}

function closeZip(zipfile: ZipFile): void {
  try {
    zipfile.close();
  } catch {
    /* zipfile.close() is best-effort while a stream is mid-flight. */
  }
}

function asZipWalkError(error: unknown): Error {
  if (error instanceof DesignError) {
    return error;
  }
  return asSchemaError(error instanceof Error ? error : null, 'source package zip is invalid');
}

function asSchemaError(error: Error | null, fallback: string): DesignError {
  if (error instanceof DesignError) {
    return error;
  }
  const message: string = error != null && error.message.length > 0 ? error.message : fallback;
  if (/encrypted/i.test(message)) {
    return new DesignError(
      422,
      DesignErrorCodes.SCHEMA,
      'source package contains encrypted entries',
    );
  }
  if (/unsupported compression/i.test(message)) {
    return new DesignError(
      422,
      DesignErrorCodes.SCHEMA,
      'source package uses unsupported compression',
    );
  }
  if (/absolute path|invalid relative path|invalid characters in fileName/i.test(message)) {
    return new DesignError(422, DesignErrorCodes.SCHEMA, `unsafe resource path`);
  }
  return new DesignError(422, DesignErrorCodes.SCHEMA, fallback);
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
