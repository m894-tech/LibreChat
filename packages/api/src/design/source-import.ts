/**
 * Pure source-import normalizer.
 *
 * Accepts the current `getSource` wrapper (JSON string or plain object) and
 * returns a `CreateDocumentInput`-shaped payload. The imported document id is
 * assigned later by the store. Asset refs are returned separately so the
 * coordinator can ACL-check them in the same project transaction — this module
 * never fetches or copies asset bytes.
 */

import type { AssetRef, DesignPayload, DesignSystemRef } from './types';
import { DesignError, DesignErrorCodes } from './errors';
import { sourceSystemResolver } from './source-systems';
import { validateDocument } from './operations';
import { FORBIDDEN_KEYS } from './types';

export const SOURCE_IMPORT_MAX_BYTES: number = 2 * 1024 * 1024;
export const SOURCE_IMPORT_PLACEHOLDER_ID: string = 'sourceimport';
export const SOURCE_IMPORT_FORMAT: 'source' = 'source';

const FORBIDDEN_KEY_SET: ReadonlySet<string> = new Set<string>(FORBIDDEN_KEYS);
const MAX_WALK_DEPTH: number = 64;
const WRAPPER_KEYS: ReadonlySet<string> = new Set([
  'customSystems',
  'documentId',
  'revision',
  'format',
  'snapshot',
  'projectId',
]);
const SNAPSHOT_KEYS: ReadonlySet<string> = new Set([
  'title',
  'kind',
  'schemaVersion',
  'designSystem',
  'payload',
  'assetRefs',
  'archived',
  'id',
  'projectId',
  'revision',
]);

export type SourceImportSnapshot = {
  title: string;
  kind: 'canvas';
  schemaVersion: 1;
  designSystem: DesignSystemRef;
  payload: DesignPayload;
  assetRefs: AssetRef[];
  archived?: boolean;
  id?: string;
  projectId?: string;
  revision?: number;
};

export type SourceImportEnvelope = {
  documentId: string;
  revision: number;
  format: 'source';
  snapshot: SourceImportSnapshot;
  projectId?: string;
};

export type SourceImportDocumentInput = {
  title: string;
  kind: 'canvas';
  payload: DesignPayload;
  designSystem: DesignSystemRef;
};

export type SourceImportResult = {
  document: SourceImportDocumentInput;
  assetRefs: AssetRef[];
};

export function normalizeSourceImport(input: unknown, targetProjectId: string): SourceImportResult {
  if (typeof targetProjectId !== 'string' || targetProjectId.length === 0) {
    failSchema('targetProjectId is required');
  }

  const parsed: unknown = parseSourceInput(input);
  assertJsonSafe(parsed, 'source', 0);
  const envelope: SourceImportEnvelope = parseEnvelope(parsed);
  const snapshot: SourceImportSnapshot = envelope.snapshot;

  if (snapshot.schemaVersion !== 1) {
    failSchema('source import schemaVersion must be 1');
  }
  if (snapshot.kind !== 'canvas') {
    failSchema('source import kind must be "canvas"');
  }

  const assetRefs: AssetRef[] = cloneJson(snapshot.assetRefs);
  const sourceProjectId: string | undefined = readOptionalProjectId(parsed);
  if (
    assetRefs.length > 0 &&
    sourceProjectId !== undefined &&
    sourceProjectId !== targetProjectId
  ) {
    throw new DesignError(
      403,
      DesignErrorCodes.FORBIDDEN,
      'source import with asset refs must stay in the same project',
    );
  }

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
    title: snapshot.title,
    revision: 1,
    designSystem: cloneJson(snapshot.designSystem),
    payload: cloneJson(snapshot.payload),
    assetRefs,
    archived: false,
  };

  validateDocument(candidate, sourceSystemResolver(parsed).resolver);

  const result: SourceImportResult = {
    document: {
      title: candidate.title,
      kind: 'canvas',
      payload: cloneJson(candidate.payload),
      designSystem: cloneJson(candidate.designSystem),
    },
    assetRefs: cloneJson(candidate.assetRefs),
  };
  return result;
}

function parseSourceInput(input: unknown): unknown {
  if (typeof input === 'string') {
    rejectNonJsonText(input);
    assertUtf8Cap(input);
    const parsed: unknown = parseJsonText(input);
    assertJsonSafe(parsed, 'source', 0);
    return parsed;
  }

  if (isBinary(input)) {
    failSchema('binary, zip, and non-JSON sources are not supported');
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    failSchema('source import must be a JSON object');
  }
  if (!isPlainObject(input)) {
    failSchema('source import must be a plain object');
  }

  assertJsonSafe(input, 'source', 0);
  const serialized: string = serializeJson(input);
  assertUtf8Cap(serialized);
  return parseJsonText(serialized);
}

function parseJsonText(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    failSchema('source import is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    failSchema('source import must be a JSON object');
  }
  return parsed;
}

function serializeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    failSchema('source import is not valid JSON');
  }
}

function rejectNonJsonText(text: string): void {
  const trimmed: string = text.replace(/^\uFEFF/, '').trim();
  if (trimmed.length === 0) {
    failSchema('source import must be a JSON object');
  }
  if (trimmed.startsWith('PK')) {
    failSchema('zip archives are not supported');
  }
  if (/^(?:https?:|javascript:|data:|file:|blob:|vbscript:)/i.test(trimmed)) {
    failSchema('URL sources are not supported');
  }
  if (
    /^(?:function\b|class\b|module\.exports\b|export\s|import\s)/.test(trimmed) ||
    trimmed.startsWith('#!') ||
    !trimmed.startsWith('{')
  ) {
    failSchema('source import must be a JSON object');
  }
}

function parseEnvelope(raw: unknown): SourceImportEnvelope {
  if (!isPlainObject(raw)) {
    failSchema('source import must be a JSON object');
  }
  assertNoForbiddenKeys(raw, 'source');
  for (const key of Object.keys(raw)) {
    if (!WRAPPER_KEYS.has(key)) {
      failSchema(`source has unknown field "${key}"`);
    }
  }
  if (raw.format !== SOURCE_IMPORT_FORMAT) {
    failSchema('source import format must be "source"');
  }
  if (typeof raw.documentId !== 'string' || raw.documentId.length === 0) {
    failSchema('source documentId is required');
  }
  if (typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || raw.revision < 1) {
    failSchema('source revision is required');
  }
  if (!isPlainObject(raw.snapshot)) {
    failSchema('source snapshot must be a plain object');
  }
  assertNoForbiddenKeys(raw.snapshot, 'snapshot');
  for (const key of Object.keys(raw.snapshot)) {
    if (!SNAPSHOT_KEYS.has(key)) {
      failSchema(`snapshot has unknown field "${key}"`);
    }
  }
  if (raw.snapshot.schemaVersion !== 1) {
    failSchema('source import schemaVersion must be 1');
  }
  if (typeof raw.snapshot.title !== 'string') {
    failSchema('snapshot.title must be a string');
  }
  if (raw.snapshot.kind !== 'canvas') {
    failSchema('snapshot.kind must be "canvas"');
  }
  if (!isPlainObject(raw.snapshot.designSystem)) {
    failSchema('snapshot.designSystem must be a plain object');
  }
  if (!isPlainObject(raw.snapshot.payload)) {
    failSchema('snapshot.payload must be a plain object');
  }
  if (!Array.isArray(raw.snapshot.assetRefs)) {
    failSchema('snapshot.assetRefs must be an array');
  }

  const envelope: SourceImportEnvelope = {
    documentId: raw.documentId,
    revision: raw.revision,
    format: 'source',
    snapshot: {
      title: raw.snapshot.title,
      kind: 'canvas',
      schemaVersion: 1,
      designSystem: raw.snapshot.designSystem as unknown as DesignSystemRef,
      payload: raw.snapshot.payload as unknown as DesignPayload,
      assetRefs: raw.snapshot.assetRefs as unknown as AssetRef[],
      ...(typeof raw.snapshot.archived === 'boolean' ? { archived: raw.snapshot.archived } : {}),
      ...(typeof raw.snapshot.id === 'string' ? { id: raw.snapshot.id } : {}),
      ...(typeof raw.snapshot.projectId === 'string' ? { projectId: raw.snapshot.projectId } : {}),
      ...(typeof raw.snapshot.revision === 'number' ? { revision: raw.snapshot.revision } : {}),
    },
  };
  if (typeof raw.projectId === 'string') {
    envelope.projectId = raw.projectId;
  }
  return envelope;
}

function readOptionalProjectId(raw: unknown): string | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const fromWrapper: string | undefined =
    typeof raw.projectId === 'string' && raw.projectId.length > 0 ? raw.projectId : undefined;
  const snapshot: unknown = raw.snapshot;
  const fromSnapshot: string | undefined =
    isPlainObject(snapshot) &&
    typeof snapshot.projectId === 'string' &&
    snapshot.projectId.length > 0
      ? snapshot.projectId
      : undefined;
  if (fromWrapper !== undefined && fromSnapshot !== undefined && fromWrapper !== fromSnapshot) {
    throw new DesignError(403, DesignErrorCodes.FORBIDDEN, 'source import projectId mismatch');
  }
  return fromSnapshot ?? fromWrapper;
}

function assertJsonSafe(value: unknown, label: string, depth: number): void {
  if (depth > MAX_WALK_DEPTH) {
    failSchema(`${label} nesting exceeds limit`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      failSchema(`${label} must be a finite JSON number`);
    }
    return;
  }
  if (typeof value !== 'object') {
    failSchema(`${label} contains a non-JSON value`);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertJsonSafe(value[index], `${label}[${index}]`, depth + 1);
    }
    return;
  }
  if (!isPlainObject(value)) {
    failSchema(`${label} must be a plain object`);
  }
  assertNoForbiddenKeys(value, label);
  for (const key of Object.keys(value)) {
    assertJsonSafe(value[key], `${label}.${key}`, depth + 1);
  }
}

function assertNoForbiddenKeys(value: Record<string, unknown>, label: string): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEY_SET.has(key)) {
      failSchema(`${label} contains forbidden key "${key}"`);
    }
  }
}

function assertUtf8Cap(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > SOURCE_IMPORT_MAX_BYTES) {
    throw new DesignError(429, DesignErrorCodes.QUOTA, 'source import exceeds 2MiB');
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isBinary(value: unknown): boolean {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return true;
  }
  return (
    typeof ArrayBuffer !== 'undefined' &&
    (value instanceof ArrayBuffer || ArrayBuffer.isView(value as ArrayBufferView))
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function failSchema(message: string): never {
  throw new DesignError(422, DesignErrorCodes.SCHEMA, message);
}
