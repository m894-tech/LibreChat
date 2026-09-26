/**
 * Pure Refero/MCP reference-search response normalizer.
 *
 * Accepts arrays, kind envelopes, or MCP tool results with strict JSON text
 * content. Emits validated ReferenceRecord metadata only — no image bytes,
 * markdown fence stripping, network, or title invention from nested context.
 */

import type { ReferenceKind, ReferenceRecord } from './reference-workflow';
import {
  REFERENCE_ID_MAX,
  REFERENCE_KINDS,
  REFERENCE_MAX_RESULTS,
  REFERENCE_TITLE_MAX,
  REFERENCE_URL_MAX,
} from './reference-workflow';
import { DesignError } from './assets';

/** @public Max UTF-8 bytes allowed for a single MCP text content payload. */
export const REFERENCE_NORMALIZE_MAX_TEXT_BYTES: number = 500_000;

const CONTROL_CHAR_RE = /\p{Cc}/u;

const ID_ALIASES = ['id', 'uuid', 'style_id', 'screen_id', 'flow_id'] as const;
const TITLE_ALIASES = ['title', 'name'] as const;
const URL_ALIASES = ['source_url', 'page_url', 'url', 'refero_url'] as const;

type IdAlias = (typeof ID_ALIASES)[number];
type TitleAlias = (typeof TITLE_ALIASES)[number];
type UrlAlias = (typeof URL_ALIASES)[number];

interface RawReferenceCandidate {
  id?: unknown;
  uuid?: unknown;
  style_id?: unknown;
  screen_id?: unknown;
  flow_id?: unknown;
  title?: unknown;
  name?: unknown;
  source_url?: unknown;
  page_url?: unknown;
  url?: unknown;
  refero_url?: unknown;
}

interface SearchEnvelope {
  records?: unknown;
  results?: unknown;
  styles?: unknown;
  screens?: unknown;
  flows?: unknown;
}

interface McpContentItem {
  type?: unknown;
  text?: unknown;
}

interface McpToolResult {
  isError?: unknown;
  content?: unknown;
}

function isPlainObject(value: unknown): value is object {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isReferenceKind(value: unknown): value is ReferenceKind {
  return typeof value === 'string' && (REFERENCE_KINDS as readonly string[]).includes(value);
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

function readIdAlias(candidate: RawReferenceCandidate): string | null {
  for (let i = 0; i < ID_ALIASES.length; i += 1) {
    const key: IdAlias = ID_ALIASES[i];
    const value = candidate[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
      return String(value);
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
}

function readTitleAlias(candidate: RawReferenceCandidate): string | null {
  for (let i = 0; i < TITLE_ALIASES.length; i += 1) {
    const key: TitleAlias = TITLE_ALIASES[i];
    const value = candidate[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
}

function readUrlAlias(candidate: RawReferenceCandidate): string | null {
  for (let i = 0; i < URL_ALIASES.length; i += 1) {
    const key: UrlAlias = URL_ALIASES[i];
    const value = candidate[key];
    if (typeof value === 'string') {
      return value;
    }
  }
  return null;
}

function assertHttpsUrl(raw: string): string | null {
  if (raw.length < 1 || raw.length > REFERENCE_URL_MAX) {
    return null;
  }
  if (CONTROL_CHAR_RE.test(raw)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    return null;
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return null;
  }
  if (CONTROL_CHAR_RE.test(parsed.href)) {
    return null;
  }
  return parsed.toString();
}

function asCandidate(raw: unknown): RawReferenceCandidate | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  return raw as RawReferenceCandidate;
}

function normalizeOne(raw: unknown, kind: ReferenceKind): ReferenceRecord | null {
  const candidate = asCandidate(raw);
  if (candidate == null) {
    return null;
  }

  const idRaw = readIdAlias(candidate);
  if (idRaw == null) {
    return null;
  }
  const id = idRaw.trim();
  if (id.length < 1 || id.length > REFERENCE_ID_MAX) {
    return null;
  }

  // Refero screen records have no title. Use a transparent identifier label,
  // never invent content or turn site.name into a screenshot title.
  const titleRaw = readTitleAlias(candidate) ?? (kind === 'screens' ? 'Экран ' + id : null);
  if (titleRaw == null) {
    return null;
  }
  const title = titleRaw.trim();
  if (title.length < 1 || title.length > REFERENCE_TITLE_MAX) {
    return null;
  }

  const urlRaw = readUrlAlias(candidate);
  if (urlRaw == null) {
    return null;
  }
  const url = assertHttpsUrl(urlRaw.trim());
  if (url == null) {
    return null;
  }

  const record: ReferenceRecord = {
    id,
    kind,
    url,
    title,
  };
  return record;
}

function extractArrayFromEnvelope(value: unknown, kind: ReferenceKind): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (!isPlainObject(value)) {
    return null;
  }
  const envelope = value as SearchEnvelope;
  if (Array.isArray(envelope.records)) return envelope.records;
  if (kind === 'styles' && Array.isArray(envelope.styles)) {
    return envelope.styles;
  }
  if (kind === 'screens' && Array.isArray(envelope.screens)) {
    return envelope.screens;
  }
  if (kind === 'flows' && Array.isArray(envelope.flows)) {
    return envelope.flows;
  }
  if (Array.isArray(envelope.results)) {
    return envelope.results;
  }
  return null;
}

function parseStrictJsonText(text: string): unknown {
  if (utf8Bytes(text) > REFERENCE_NORMALIZE_MAX_TEXT_BYTES) {
    throw new DesignError(
      422,
      'VALIDATION',
      `reference search text exceeds ${REFERENCE_NORMALIZE_MAX_TEXT_BYTES} UTF-8 bytes`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DesignError(422, 'VALIDATION', 'reference search text is not strict JSON');
  }
}

function isMcpToolResult(value: object): value is McpToolResult {
  if (!Object.prototype.hasOwnProperty.call(value, 'content')) {
    return false;
  }
  const candidate = value as McpToolResult;
  return Array.isArray(candidate.content);
}

function unwrapMcpOrPayload(response: unknown, kind: ReferenceKind): unknown {
  if (!isPlainObject(response) || !isMcpToolResult(response)) {
    return response;
  }

  if (response.isError === true) {
    throw new DesignError(502, 'PROVIDER_ERROR', 'reference search tool returned isError');
  }

  const content = response.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const parsedPayloads: unknown[] = [];
  for (let i = 0; i < content.length; i += 1) {
    const item = content[i];
    if (!isPlainObject(item)) {
      continue;
    }
    const contentItem = item as McpContentItem;
    if (contentItem.type === 'image') {
      continue;
    }
    if (contentItem.type !== 'text') {
      continue;
    }
    if (typeof contentItem.text !== 'string') {
      throw new DesignError(422, 'VALIDATION', 'MCP text content must be a string');
    }
    parsedPayloads.push(parseStrictJsonText(contentItem.text));
  }

  if (parsedPayloads.length === 0) {
    return [];
  }
  if (parsedPayloads.length === 1) {
    return parsedPayloads[0];
  }

  const merged: unknown[] = [];
  for (let i = 0; i < parsedPayloads.length; i += 1) {
    const extracted = extractArrayFromEnvelope(parsedPayloads[i], kind);
    if (extracted == null) {
      throw new DesignError(
        422,
        'VALIDATION',
        'MCP text JSON must be an array or results envelope',
      );
    }
    for (let j = 0; j < extracted.length; j += 1) {
      merged.push(extracted[j]);
    }
  }
  return merged;
}

function collectRecords(items: readonly unknown[], kind: ReferenceKind): ReferenceRecord[] {
  const out: ReferenceRecord[] = [];
  for (let i = 0; i < items.length; i += 1) {
    if (out.length >= REFERENCE_MAX_RESULTS) {
      break;
    }
    const normalized = normalizeOne(items[i], kind);
    if (normalized == null)
      throw new DesignError(502, 'REFERENCE_SHAPE', 'Invalid reference metadata row');
    out.push(normalized);
  }
  return out;
}

/**
 * Normalize a Refero-style or MCP tool search response into validated records.
 *
 * @public
 */
export function normalizeReferenceSearch(
  response: unknown,
  kind: ReferenceKind,
): ReferenceRecord[] {
  if (!isReferenceKind(kind)) {
    throw new DesignError(422, 'VALIDATION', 'kind must be styles, screens, or flows');
  }
  if (response == null || response === false)
    throw new DesignError(
      502,
      'REFERENCE_SHAPE',
      'Reference provider returned no structured result',
    );
  if (
    isPlainObject(response) &&
    (('isError' in response && response.isError === true) ||
      ('error' in response && response.error))
  )
    throw new DesignError(502, 'PROVIDER_ERROR', 'Reference provider returned an error');
  let serialized: string;
  try {
    serialized = JSON.stringify(response);
  } catch {
    throw new DesignError(502, 'REFERENCE_SHAPE', 'Unserializable reference result');
  }
  if (typeof serialized !== 'string' || utf8Bytes(serialized) > REFERENCE_NORMALIZE_MAX_TEXT_BYTES)
    throw new DesignError(422, 'REFERENCE_SIZE', 'Reference response exceeds limit');

  const payload = unwrapMcpOrPayload(response, kind);
  const items = extractArrayFromEnvelope(payload, kind);
  if (items == null)
    throw new DesignError(502, 'REFERENCE_SHAPE', 'Unknown reference result envelope');
  return collectRecords(items, kind);
}
