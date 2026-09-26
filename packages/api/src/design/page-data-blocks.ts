/**
 * Registered page data-block validators (pure module).
 *
 * Separate from page-document schema. Validates allowlisted table / bar-chart
 * payloads only — no backend queries, chart tools, arbitrary JS, or SVG.
 *
 * `source: 'provided'` means user-provided data that is NOT verified live.
 * `source: 'example'` is illustrative sample data.
 *
 * Public API:
 *   - validateDataBlock(input) → cloned canonical DataBlock
 */

import { DesignErrorCodes, designError } from './errors';

export const DATA_BLOCK_LIMITS = {
  MAX_JSON_BYTES: 64 * 1024,
  MAX_COLUMNS: 12,
  MAX_ROWS: 100,
  MAX_LABELS: 30,
  MAX_TEXT: 500,
  MAX_ABS_VALUE: 1e12,
} as const;

export type DataBlockSource = 'example' | 'provided';

export type DataBlockKind = 'table' | 'bar-chart';

export interface TableData {
  kind: 'table';
  source: DataBlockSource;
  caption: string;
  columns: string[];
  rows: (string | number | null)[][];
}

export interface BarChartData {
  kind: 'bar-chart';
  source: DataBlockSource;
  caption: string;
  labels: string[];
  values: number[];
}

export type DataBlock = TableData | BarChartData;

export const DATA_BLOCK_KINDS: readonly DataBlockKind[] = ['table', 'bar-chart'];

export const DATA_BLOCK_SOURCES: readonly DataBlockSource[] = ['example', 'provided'];

export const TABLE_DATA_KEYS = ['kind', 'source', 'caption', 'columns', 'rows'] as const;

export const BAR_CHART_DATA_KEYS = ['kind', 'source', 'caption', 'labels', 'values'] as const;

export const DATA_BLOCK_FORBIDDEN_KEYS = ['__proto__', 'prototype', 'constructor'] as const;

const KIND_SET = new Set<string>(DATA_BLOCK_KINDS);
const SOURCE_SET = new Set<string>(DATA_BLOCK_SOURCES);
const TABLE_KEY_SET = new Set<string>(TABLE_DATA_KEYS);
const BAR_CHART_KEY_SET = new Set<string>(BAR_CHART_DATA_KEYS);
const FORBIDDEN_KEY_SET = new Set<string>(DATA_BLOCK_FORBIDDEN_KEYS);

const CONTROL_RE = /[\u0000-\u001F\u007F]/;

function schema(message: string): never {
  designError(422, DesignErrorCodes.SCHEMA, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value);
}

function assertNoForbiddenKeys(value: Record<string, unknown>, label: string): void {
  for (const key of ownKeys(value)) {
    if (FORBIDDEN_KEY_SET.has(key)) {
      schema(`${label} contains forbidden key "${key}"`);
    }
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  assertNoForbiddenKeys(value, label);
  for (const key of ownKeys(value)) {
    if (!allowed.has(key)) {
      schema(`${label} has unknown field "${key}"`);
    }
  }
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    schema(`${label} must be a string`);
  }
  return value;
}

function assertText(value: unknown, label: string): string {
  const text = assertString(value, label);
  if (text.length > DATA_BLOCK_LIMITS.MAX_TEXT) {
    schema(`${label} exceeds ${DATA_BLOCK_LIMITS.MAX_TEXT} characters`);
  }
  if (CONTROL_RE.test(text)) {
    schema(`${label} contains control characters`);
  }
  return text;
}

function assertFiniteBoundedNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    schema(`${label} must be a finite number`);
  }
  if (Math.abs(value) > DATA_BLOCK_LIMITS.MAX_ABS_VALUE) {
    schema(`${label} absolute value exceeds ${DATA_BLOCK_LIMITS.MAX_ABS_VALUE}`);
  }
  return value;
}

function assertSource(value: unknown, label: string): DataBlockSource {
  if (value === undefined) {
    schema(`${label} is required`);
  }
  const text = assertString(value, label);
  if (!SOURCE_SET.has(text)) {
    schema(`${label} must be "example" or "provided"`);
  }
  return text as DataBlockSource;
}

function assertJsonSize(input: unknown): void {
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    schema('data block is not JSON-serializable');
  }
  if (typeof encoded !== 'string') {
    schema('data block is not JSON-serializable');
  }
  const bytes = Buffer.byteLength(encoded, 'utf8');
  if (bytes > DATA_BLOCK_LIMITS.MAX_JSON_BYTES) {
    schema(`data block JSON exceeds ${DATA_BLOCK_LIMITS.MAX_JSON_BYTES} bytes`);
  }
}

function assertCell(value: unknown, label: string): string | number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return assertText(value, label);
  }
  if (typeof value === 'number') {
    return assertFiniteBoundedNumber(value, label);
  }
  schema(`${label} must be string, number, or null`);
}

function validateTable(raw: Record<string, unknown>): TableData {
  assertAllowedKeys(raw, TABLE_KEY_SET, 'table data block');

  if (raw.kind !== 'table') {
    schema('table data block kind must be "table"');
  }

  const source = assertSource(raw.source, 'source');
  const caption = assertText(raw.caption, 'caption');

  if (!Array.isArray(raw.columns)) {
    schema('columns must be an array');
  }
  if (raw.columns.length === 0) {
    schema('columns must not be empty');
  }
  if (raw.columns.length > DATA_BLOCK_LIMITS.MAX_COLUMNS) {
    schema(`columns exceed limit of ${DATA_BLOCK_LIMITS.MAX_COLUMNS}`);
  }

  const columns: string[] = [];
  for (let i = 0; i < raw.columns.length; i += 1) {
    columns.push(assertText(raw.columns[i], `columns[${i}]`));
  }

  if (!Array.isArray(raw.rows)) {
    schema('rows must be an array');
  }
  if (raw.rows.length > DATA_BLOCK_LIMITS.MAX_ROWS) {
    schema(`rows exceed limit of ${DATA_BLOCK_LIMITS.MAX_ROWS}`);
  }

  const colCount = columns.length;
  const rows: (string | number | null)[][] = [];
  for (let r = 0; r < raw.rows.length; r += 1) {
    const row = raw.rows[r];
    if (!Array.isArray(row)) {
      schema(`rows[${r}] must be an array`);
    }
    if (row.length !== colCount) {
      schema(`rows[${r}] length ${row.length} does not match columns length ${colCount}`);
    }
    const outRow: (string | number | null)[] = [];
    for (let c = 0; c < row.length; c += 1) {
      outRow.push(assertCell(row[c], `rows[${r}][${c}]`));
    }
    rows.push(outRow);
  }

  return {
    kind: 'table',
    source,
    caption,
    columns,
    rows,
  };
}

function validateBarChart(raw: Record<string, unknown>): BarChartData {
  assertAllowedKeys(raw, BAR_CHART_KEY_SET, 'bar-chart data block');

  if (raw.kind !== 'bar-chart') {
    schema('bar-chart data block kind must be "bar-chart"');
  }

  const source = assertSource(raw.source, 'source');
  const caption = assertText(raw.caption, 'caption');

  if (!Array.isArray(raw.labels)) {
    schema('labels must be an array');
  }
  if (raw.labels.length === 0) {
    schema('labels must not be empty');
  }
  if (raw.labels.length > DATA_BLOCK_LIMITS.MAX_LABELS) {
    schema(`labels exceed limit of ${DATA_BLOCK_LIMITS.MAX_LABELS}`);
  }

  const labels: string[] = [];
  for (let i = 0; i < raw.labels.length; i += 1) {
    labels.push(assertText(raw.labels[i], `labels[${i}]`));
  }

  if (!Array.isArray(raw.values)) {
    schema('values must be an array');
  }
  if (raw.values.length !== labels.length) {
    schema(`values length ${raw.values.length} does not match labels length ${labels.length}`);
  }

  const values: number[] = [];
  for (let i = 0; i < raw.values.length; i += 1) {
    values.push(assertFiniteBoundedNumber(raw.values[i], `values[${i}]`));
  }

  return {
    kind: 'bar-chart',
    source,
    caption,
    labels,
    values,
  };
}

/**
 * Validate and return a deep-cloned canonical data block.
 * Does not mutate the input. Rejects unknown fields and prototype pollution keys.
 */
export function validateDataBlock(input: unknown): DataBlock {
  assertJsonSize(input);

  if (!isPlainObject(input)) {
    schema('data block must be a plain object');
  }

  assertNoForbiddenKeys(input, 'data block');

  const kind = input.kind;
  if (typeof kind !== 'string' || !KIND_SET.has(kind)) {
    schema('kind must be "table" or "bar-chart"');
  }

  if (kind === 'table') {
    return validateTable(input);
  }
  return validateBarChart(input);
}
