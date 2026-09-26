/**
 * R3 registered page-document schema (pure module).
 *
 * Native `kind: 'web'` envelope — does not replace the R1 canvas schema.
 * Storage/UI/persistence are intentionally absent from this module.
 *
 * Public API:
 *   - validatePageDocument(doc)
 *   - applyPageOperations(doc, ops, context)
 *
 * Actor identity and scope come only from trusted `PageOperationContext`.
 * There is no unlock operation; models cannot clear locks through properties.
 */

import { validateDataBlock, type DataBlock } from './page-data-blocks';
import { DesignErrorCodes, designError } from './errors';

export const PAGE_LIMITS = {
  MAX_NODES: 300,
  MAX_DEPTH: 12,
  MAX_TITLE: 200,
  MAX_TEXT: 8000,
  MAX_LABEL: 500,
  MAX_ALT: 1000,
  MAX_ID: 128,
  MAX_HREF: 2048,
  MIN_SIZE: 8,
  MAX_SIZE: 120,
  MIN_GAP: 0,
  MAX_GAP: 128,
  MIN_PADDING: 0,
  MAX_PADDING: 128,
  MIN_VIEWPORT: 1,
  MAX_VIEWPORT: 10000,
  MAX_OPS: 200,
} as const;

export type PageRole = 'owner' | 'editor' | 'viewer';

export type PageNodeType =
  | 'section'
  | 'stack'
  | 'text'
  | 'image'
  | 'button'
  | 'table'
  | 'bar-chart';

export type PageDirection = 'row' | 'column';

export type PageFontWeight = 400 | 600 | 700;

export type PageOperationType =
  | 'setProperty'
  | 'setText'
  | 'insertNode'
  | 'removeNode'
  | 'lock'
  | 'unlock';

export const PAGE_NODE_TYPES: readonly PageNodeType[] = [
  'section',
  'stack',
  'text',
  'image',
  'button',
  'table',
  'bar-chart',
];

export const PAGE_CONTAINER_TYPES: readonly PageNodeType[] = ['section', 'stack'];

export const PAGE_DIRECTIONS: readonly PageDirection[] = ['row', 'column'];

export const PAGE_FONT_WEIGHTS: readonly PageFontWeight[] = [400, 600, 700];

export const PAGE_OPERATION_TYPES: readonly PageOperationType[] = [
  'setProperty',
  'setText',
  'insertNode',
  'removeNode',
  'lock',
  'unlock',
];

export const PAGE_DOCUMENT_KEYS = [
  'schemaVersion',
  'kind',
  'title',
  'viewport',
  'nodes',
  'assetRefs',
] as const;

export const PAGE_NODE_KEYS = ['id', 'parentId', 'type', 'props', 'locked'] as const;

export const PAGE_VIEWPORT_KEYS = ['desktop', 'mobile'] as const;

export const PAGE_ASSET_REF_KEYS = ['assetId', 'version'] as const;

export const PAGE_OPERATION_KEYS = [
  'type',
  'nodeId',
  'parentId',
  'property',
  'value',
  'node',
] as const;

export const PAGE_FORBIDDEN_KEYS = ['__proto__', 'prototype', 'constructor'] as const;

export const PAGE_FORBIDDEN_BODY_FIELDS = [
  'actor',
  'actorId',
  'ownerId',
  'owner',
  'role',
  'agent',
  'authorizedNodeIds',
  'scopeIds',
  'grantId',
  'authorizedScope',
] as const;

export const PAGE_SECTION_STACK_PROP_KEYS = [
  'direction',
  'gap',
  'padding',
  'background',
  'mobileDirection',
] as const;

export const PAGE_TEXT_PROP_KEYS = ['text', 'size', 'color', 'weight'] as const;

export const PAGE_IMAGE_PROP_KEYS = ['assetId', 'version', 'alt'] as const;

export const PAGE_BUTTON_PROP_KEYS = ['label', 'href'] as const;

export interface PageAssetRef {
  assetId: string;
  version: number;
}

export interface PageViewport {
  desktop: number;
  mobile: number;
}

export interface PageSectionStackProps {
  direction: PageDirection;
  gap: number;
  padding: number;
  background: string;
  mobileDirection?: PageDirection;
}

export interface PageTextProps {
  text: string;
  size: number;
  color: string;
  weight: PageFontWeight;
}

export interface PageImageProps {
  assetId: string;
  version: number;
  alt: string;
}

export interface PageButtonProps {
  label: string;
  href: string;
}

export type PageNodeProps =
  | DataBlock
  | PageSectionStackProps
  | PageTextProps
  | PageImageProps
  | PageButtonProps;

export interface PageNode {
  id: string;
  parentId: string | null;
  type: PageNodeType;
  props: PageNodeProps;
  locked: boolean;
}

/**
 * Canonical registered page document. Not a canvas document.
 * Shared canvas geometry (x/y/width/height/rotation/opacity) is intentionally absent.
 */
export interface PageDocument {
  schemaVersion: 1;
  kind: 'web';
  title: string;
  viewport: PageViewport;
  nodes: PageNode[];
  assetRefs: PageAssetRef[];
}

/**
 * Trusted server context. Never read actor/role/scope from the operation body.
 * For agents, `authorizedNodeIds` is the grant ceiling (fail-closed if omitted).
 */
export interface PageOperationContext {
  actorId: string;
  role: PageRole;
  agent: boolean;
  scopeIds: string[];
  authorizedNodeIds?: string[];
}

export interface PageOperation {
  type: PageOperationType;
  nodeId?: string;
  parentId?: string | null;
  property?: string;
  value?: string | number | boolean | null;
  node?: PageNode;
}

const PAGE_NODE_TYPE_SET = new Set<string>(PAGE_NODE_TYPES);
const PAGE_CONTAINER_SET = new Set<string>(PAGE_CONTAINER_TYPES);
const PAGE_DIRECTION_SET = new Set<string>(PAGE_DIRECTIONS);
const PAGE_WEIGHT_SET = new Set<number>(PAGE_FONT_WEIGHTS);
const PAGE_OPERATION_TYPE_SET = new Set<string>(PAGE_OPERATION_TYPES);
const PAGE_DOCUMENT_KEY_SET = new Set<string>(PAGE_DOCUMENT_KEYS);
const PAGE_NODE_KEY_SET = new Set<string>(PAGE_NODE_KEYS);
const PAGE_VIEWPORT_KEY_SET = new Set<string>(PAGE_VIEWPORT_KEYS);
const PAGE_ASSET_REF_KEY_SET = new Set<string>(PAGE_ASSET_REF_KEYS);
const PAGE_OPERATION_KEY_SET = new Set<string>(PAGE_OPERATION_KEYS);
const PAGE_FORBIDDEN_KEY_SET = new Set<string>(PAGE_FORBIDDEN_KEYS);
const PAGE_FORBIDDEN_BODY_SET = new Set<string>(PAGE_FORBIDDEN_BODY_FIELDS);

const SECTION_STACK_PROP_SET = new Set<string>(PAGE_SECTION_STACK_PROP_KEYS);
const TEXT_PROP_SET = new Set<string>(PAGE_TEXT_PROP_KEYS);
const IMAGE_PROP_SET = new Set<string>(PAGE_IMAGE_PROP_KEYS);
const BUTTON_PROP_SET = new Set<string>(PAGE_BUTTON_PROP_KEYS);

const COLOR_RE = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONTROL_RE = /[\u0000-\u001F\u007F]/;

function schema(message: string): never {
  designError(422, DesignErrorCodes.SCHEMA, message);
}

function scope(message: string): never {
  designError(422, DesignErrorCodes.SCOPE, message);
}

function lock(message: string): never {
  designError(422, DesignErrorCodes.LOCK, message);
}

function capability(message: string): never {
  designError(422, DesignErrorCodes.CAPABILITY, message);
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
    if (PAGE_FORBIDDEN_KEY_SET.has(key)) {
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

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value) || PAGE_FORBIDDEN_KEY_SET.has(value)) {
    schema(`${label} is not a valid id`);
  }
  return value;
}

function assertFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    schema(`${label} must be a finite number`);
  }
  return value;
}

function assertInteger(value: unknown, label: string): number {
  const num = assertFiniteNumber(value, label);
  if (!Number.isInteger(num)) {
    schema(`${label} must be an integer`);
  }
  return num;
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    schema(`${label} must be a boolean`);
  }
  return value;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    schema(`${label} must be a string`);
  }
  return value;
}

function inRange(value: number, min: number, max: number, label: string): number {
  if (value < min || value > max) {
    schema(`${label} must be between ${min} and ${max}`);
  }
  return value;
}

function assertColor(value: unknown, label: string): string {
  const text = assertString(value, label);
  if (!COLOR_RE.test(text)) {
    schema(`${label} must be a hex color`);
  }
  return text;
}

function assertDirection(value: unknown, label: string): PageDirection {
  const text = assertString(value, label);
  if (!PAGE_DIRECTION_SET.has(text)) {
    schema(`${label} must be "row" or "column"`);
  }
  return text as PageDirection;
}

function cloneJson<T>(value: T): T {
  return cloneValue(value, 0) as T;
}

function cloneValue(value: unknown, depth: number): unknown {
  if (depth > 64) {
    schema('value nesting exceeds limit');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      schema('non-finite numbers are not allowed');
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item, depth + 1));
  }
  if (!isPlainObject(value)) {
    schema('only plain JSON values are allowed');
  }
  assertNoForbiddenKeys(value, 'value');
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys(value)) {
    out[key] = cloneValue(value[key], depth + 1);
  }
  return out;
}

function propAllowlist(type: PageNodeType): Set<string> {
  switch (type) {
    case 'section':
    case 'stack':
      return SECTION_STACK_PROP_SET;
    case 'text':
      return TEXT_PROP_SET;
    case 'image':
      return IMAGE_PROP_SET;
    case 'button':
      return BUTTON_PROP_SET;
    default:
      schema(`unknown page node type "${type as string}"`);
  }
}

/**
 * Accept https absolute URLs or app-relative paths starting with a single `/`.
 * Reject javascript/data schemes, protocol-relative `//`, backslashes, and controls.
 */
export function assertSafePageHref(value: unknown, label: string = 'href'): string {
  const href = assertString(value, label);
  if (href.length === 0 || href.length > PAGE_LIMITS.MAX_HREF) {
    schema(`${label} length is invalid`);
  }
  if (CONTROL_RE.test(href)) {
    schema(`${label} contains control characters`);
  }
  if (href.includes('\\')) {
    schema(`${label} must not contain backslashes`);
  }
  if (href.startsWith('//')) {
    schema(`${label} must not be protocol-relative`);
  }

  const lower = href.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
    schema(`${label} scheme is not allowed`);
  }

  if (href.startsWith('/')) {
    if (/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
      schema(`${label} app-relative path must not include a scheme`);
    }
    return href;
  }

  if (!/^https:\/\//i.test(href)) {
    schema(`${label} must be https or an app-relative path`);
  }
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:') {
      schema(`${label} must use the https scheme`);
    }
    if (url.username !== '' || url.password !== '') {
      schema(`${label} must not include credentials`);
    }
  } catch {
    schema(`${label} is not a valid https URL`);
  }
  return href;
}

function parseSectionStackProps(
  raw: Record<string, unknown>,
  label: string,
): PageSectionStackProps {
  assertAllowedKeys(raw, SECTION_STACK_PROP_SET, label);
  for (const key of ['direction', 'gap', 'padding', 'background'] as const) {
    if (raw[key] === undefined) {
      schema(`${label}.${key} is required`);
    }
  }
  const props: PageSectionStackProps = {
    direction: assertDirection(raw.direction, `${label}.direction`),
    gap: inRange(
      assertInteger(raw.gap, `${label}.gap`),
      PAGE_LIMITS.MIN_GAP,
      PAGE_LIMITS.MAX_GAP,
      `${label}.gap`,
    ),
    padding: inRange(
      assertInteger(raw.padding, `${label}.padding`),
      PAGE_LIMITS.MIN_PADDING,
      PAGE_LIMITS.MAX_PADDING,
      `${label}.padding`,
    ),
    background: assertColor(raw.background, `${label}.background`),
  };
  if (raw.mobileDirection !== undefined) {
    props.mobileDirection = assertDirection(raw.mobileDirection, `${label}.mobileDirection`);
  }
  return props;
}

function parseTextProps(raw: Record<string, unknown>, label: string): PageTextProps {
  assertAllowedKeys(raw, TEXT_PROP_SET, label);
  for (const key of PAGE_TEXT_PROP_KEYS) {
    if (raw[key] === undefined) {
      schema(`${label}.${key} is required`);
    }
  }
  const text = assertString(raw.text, `${label}.text`);
  if (text.length > PAGE_LIMITS.MAX_TEXT) {
    schema(`${label}.text exceeds maximum length`);
  }
  if (CONTROL_RE.test(text)) {
    schema(`${label}.text contains control characters`);
  }
  const weight = assertInteger(raw.weight, `${label}.weight`);
  if (!PAGE_WEIGHT_SET.has(weight)) {
    schema(`${label}.weight must be 400, 600, or 700`);
  }
  return {
    text,
    size: inRange(
      assertInteger(raw.size, `${label}.size`),
      PAGE_LIMITS.MIN_SIZE,
      PAGE_LIMITS.MAX_SIZE,
      `${label}.size`,
    ),
    color: assertColor(raw.color, `${label}.color`),
    weight: weight as PageFontWeight,
  };
}

function parseImageProps(raw: Record<string, unknown>, label: string): PageImageProps {
  assertAllowedKeys(raw, IMAGE_PROP_SET, label);
  for (const key of PAGE_IMAGE_PROP_KEYS) {
    if (raw[key] === undefined) {
      schema(`${label}.${key} is required`);
    }
  }
  const alt = assertString(raw.alt, `${label}.alt`);
  if (alt.length > PAGE_LIMITS.MAX_ALT) {
    schema(`${label}.alt exceeds maximum length`);
  }
  if (CONTROL_RE.test(alt)) {
    schema(`${label}.alt contains control characters`);
  }
  const version = assertInteger(raw.version, `${label}.version`);
  if (version < 1) {
    schema(`${label}.version must be >= 1`);
  }
  return {
    assetId: assertId(raw.assetId, `${label}.assetId`),
    version,
    alt,
  };
}

function parseButtonProps(raw: Record<string, unknown>, label: string): PageButtonProps {
  assertAllowedKeys(raw, BUTTON_PROP_SET, label);
  for (const key of PAGE_BUTTON_PROP_KEYS) {
    if (raw[key] === undefined) {
      schema(`${label}.${key} is required`);
    }
  }
  const labelText = assertString(raw.label, `${label}.label`);
  if (labelText.length === 0 || labelText.length > PAGE_LIMITS.MAX_LABEL) {
    schema(`${label}.label length is invalid`);
  }
  if (CONTROL_RE.test(labelText)) {
    schema(`${label}.label contains control characters`);
  }
  return {
    label: labelText,
    href: assertSafePageHref(raw.href, `${label}.href`),
  };
}

function parseProps(type: PageNodeType, raw: unknown, label: string): PageNodeProps {
  if (!isPlainObject(raw)) {
    schema(`${label} must be an object`);
  }
  switch (type) {
    case 'section':
    case 'stack':
      return parseSectionStackProps(raw, label);
    case 'text':
      return parseTextProps(raw, label);
    case 'image':
      return parseImageProps(raw, label);
    case 'button':
      return parseButtonProps(raw, label);
    case 'table':
    case 'bar-chart': {
      const data = validateDataBlock(raw);
      if (data.kind !== type) schema('Data block type mismatch');
      return data;
    }
    default:
      schema(`unsupported page node type`);
  }
}

function parseAssetRef(raw: unknown, index: number): PageAssetRef {
  if (!isPlainObject(raw)) {
    schema(`assetRefs[${index}] must be an object`);
  }
  assertAllowedKeys(raw, PAGE_ASSET_REF_KEY_SET, `assetRefs[${index}]`);
  const version = assertInteger(raw.version, `assetRefs[${index}].version`);
  if (version < 1) {
    schema(`assetRefs[${index}].version must be >= 1`);
  }
  return {
    assetId: assertId(raw.assetId, `assetRefs[${index}].assetId`),
    version,
  };
}

function parseNode(raw: unknown, index: number): PageNode {
  if (!isPlainObject(raw)) {
    schema(`nodes[${index}] must be an object`);
  }
  assertAllowedKeys(raw, PAGE_NODE_KEY_SET, `nodes[${index}]`);
  const id = assertId(raw.id, `nodes[${index}].id`);
  const typeRaw = assertString(raw.type, `nodes[${index}].type`);
  if (!PAGE_NODE_TYPE_SET.has(typeRaw)) {
    schema(`nodes[${index}].type "${typeRaw}" is not allowed`);
  }
  const type = typeRaw as PageNodeType;
  const parentId =
    raw.parentId === null || raw.parentId === undefined
      ? null
      : assertId(raw.parentId, `nodes[${index}].parentId`);
  const locked = assertBoolean(raw.locked, `nodes[${index}].locked`);
  const props = parseProps(type, raw.props, `nodes[${index}].props`);
  return { id, parentId, type, props, locked };
}

function assertGraph(nodes: PageNode[]): void {
  if (nodes.length > PAGE_LIMITS.MAX_NODES) {
    schema(`page documents may contain at most ${PAGE_LIMITS.MAX_NODES} nodes`);
  }
  const byId = new Map<string, PageNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      designError(409, DesignErrorCodes.ID_REUSE, `duplicate node id "${node.id}"`);
    }
    byId.set(node.id, node);
  }

  for (const node of nodes) {
    if (node.parentId === null) {
      if (!PAGE_CONTAINER_SET.has(node.type)) {
        schema(`root node "${node.id}" must be a section or stack`);
      }
      continue;
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      schema(`node "${node.id}" parentId "${node.parentId}" does not exist`);
    }
    if (!PAGE_CONTAINER_SET.has(parent.type)) {
      schema(`node "${node.id}" parent must be a section or stack`);
    }
  }

  const depthById = new Map<string, number>();
  const visiting = new Set<string>();

  function depthOf(id: string): number {
    const cached = depthById.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(id)) {
      schema('node parent cycle detected');
    }
    visiting.add(id);
    const node = byId.get(id);
    if (!node) {
      schema(`node "${id}" does not exist`);
    }
    let depth = 1;
    if (node.parentId !== null) {
      depth = depthOf(node.parentId) + 1;
    }
    visiting.delete(id);
    if (depth > PAGE_LIMITS.MAX_DEPTH) {
      schema(`node "${id}" exceeds maximum depth of ${PAGE_LIMITS.MAX_DEPTH}`);
    }
    depthById.set(id, depth);
    return depth;
  }

  for (const node of nodes) {
    depthOf(node.id);
  }
}

function assertImageAssetRefs(nodes: PageNode[], assetRefs: PageAssetRef[]): void {
  const seenRefs = new Set<string>();
  for (const ref of assetRefs) {
    const key = `${ref.assetId}@${ref.version}`;
    if (seenRefs.has(key)) {
      schema(`duplicate assetRef ${key}`);
    }
    seenRefs.add(key);
  }
  for (const node of nodes) {
    if (node.type !== 'image') {
      continue;
    }
    const props = node.props as PageImageProps;
    const key = `${props.assetId}@${props.version}`;
    if (!seenRefs.has(key)) {
      schema(`image "${node.id}" references missing assetRef ${key}`);
    }
  }
}

function parsePageDocument(doc: unknown): PageDocument {
  if (!isPlainObject(doc)) {
    schema('page document must be an object');
  }
  assertAllowedKeys(doc, PAGE_DOCUMENT_KEY_SET, 'page document');
  if (doc.schemaVersion !== 1) {
    schema('page document.schemaVersion must be 1');
  }
  if (doc.kind !== 'web') {
    schema('page document.kind must be "web"');
  }
  const title = assertString(doc.title, 'page document.title');
  if (title.length === 0 || title.length > PAGE_LIMITS.MAX_TITLE) {
    schema('page document.title length is invalid');
  }
  if (CONTROL_RE.test(title)) {
    schema('page document.title contains control characters');
  }
  if (!isPlainObject(doc.viewport)) {
    schema('page document.viewport must be an object');
  }
  assertAllowedKeys(doc.viewport, PAGE_VIEWPORT_KEY_SET, 'page document.viewport');
  const viewport: PageViewport = {
    desktop: inRange(
      assertInteger(doc.viewport.desktop, 'viewport.desktop'),
      PAGE_LIMITS.MIN_VIEWPORT,
      PAGE_LIMITS.MAX_VIEWPORT,
      'viewport.desktop',
    ),
    mobile: inRange(
      assertInteger(doc.viewport.mobile, 'viewport.mobile'),
      PAGE_LIMITS.MIN_VIEWPORT,
      PAGE_LIMITS.MAX_VIEWPORT,
      'viewport.mobile',
    ),
  };
  if (!Array.isArray(doc.nodes)) {
    schema('page document.nodes must be an array');
  }
  const nodes = doc.nodes.map((node, index) => parseNode(node, index));
  assertGraph(nodes);
  if (!Array.isArray(doc.assetRefs)) {
    schema('page document.assetRefs must be an array');
  }
  const assetRefs = doc.assetRefs.map((ref, index) => parseAssetRef(ref, index));
  assertImageAssetRefs(nodes, assetRefs);
  return {
    schemaVersion: 1,
    kind: 'web',
    title,
    viewport,
    nodes,
    assetRefs,
  };
}

function cloneProps(type: PageNodeType, props: PageNodeProps): PageNodeProps {
  switch (type) {
    case 'section':
    case 'stack': {
      const value = props as PageSectionStackProps;
      const next: PageSectionStackProps = {
        direction: value.direction,
        gap: value.gap,
        padding: value.padding,
        background: value.background,
      };
      if (value.mobileDirection !== undefined) {
        next.mobileDirection = value.mobileDirection;
      }
      return next;
    }
    case 'text': {
      const value = props as PageTextProps;
      return {
        text: value.text,
        size: value.size,
        color: value.color,
        weight: value.weight,
      };
    }
    case 'image': {
      const value = props as PageImageProps;
      return {
        assetId: value.assetId,
        version: value.version,
        alt: value.alt,
      };
    }
    case 'button': {
      const value = props as PageButtonProps;
      return {
        label: value.label,
        href: value.href,
      };
    }
    case 'table':
    case 'bar-chart':
      return validateDataBlock(props);
    default:
      schema('cannot clone props for unknown type');
  }
}

function cloneNode(node: PageNode): PageNode {
  return {
    id: node.id,
    parentId: node.parentId,
    type: node.type,
    locked: node.locked,
    props: cloneProps(node.type, node.props),
  };
}

function clonePageDocument(doc: PageDocument): PageDocument {
  return {
    schemaVersion: 1,
    kind: 'web',
    title: doc.title,
    viewport: { desktop: doc.viewport.desktop, mobile: doc.viewport.mobile },
    nodes: doc.nodes.map(cloneNode),
    assetRefs: doc.assetRefs.map((ref) => ({ assetId: ref.assetId, version: ref.version })),
  };
}

function requireNode(doc: PageDocument, nodeId: string): PageNode {
  const node = doc.nodes.find((item) => item.id === nodeId);
  if (!node) {
    schema(`node "${nodeId}" does not exist`);
  }
  return node;
}

function isAncestorLocked(doc: PageDocument, nodeId: string): boolean {
  const byId = new Map(doc.nodes.map((node) => [node.id, node] as const));
  const seen = new Set<string>();
  let cursor = byId.get(nodeId);
  while (cursor) {
    if (seen.has(cursor.id)) {
      schema('node parent cycle detected');
    }
    seen.add(cursor.id);
    if (cursor.locked) {
      return true;
    }
    if (!cursor.parentId) {
      return false;
    }
    cursor = byId.get(cursor.parentId);
  }
  return false;
}

function subtreeIds(doc: PageDocument, rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const node of doc.nodes) {
    if (!node.parentId) {
      continue;
    }
    const list = children.get(node.parentId) ?? [];
    list.push(node.id);
    children.set(node.parentId, list);
  }
  const out: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) {
      schema('node parent cycle detected');
    }
    seen.add(id);
    out.push(id);
    const kids = children.get(id);
    if (kids) {
      for (const kid of kids) {
        stack.push(kid);
      }
    }
  }
  return out;
}

function assertUnlocked(doc: PageDocument, ids: readonly string[]): void {
  for (const id of ids) {
    if (isAncestorLocked(doc, id)) {
      lock(`node "${id}" is locked`);
    }
  }
}

function grantSet(context: PageOperationContext): Set<string> | null {
  if (!context.agent) {
    return null;
  }
  return new Set(context.authorizedNodeIds ?? []);
}

function assertWritableRole(context: PageOperationContext): void {
  if (context.role === 'viewer') {
    designError(403, DesignErrorCodes.FORBIDDEN, 'viewer cannot mutate page documents');
  }
  if (context.role !== 'owner' && context.role !== 'editor') {
    designError(403, DesignErrorCodes.FORBIDDEN, 'unsupported role');
  }
}

function assertContext(context: unknown): PageOperationContext {
  if (!isPlainObject(context)) {
    schema('page operation context must be an object');
  }
  const actorId = assertString(context.actorId, 'context.actorId');
  if (actorId.length === 0 || actorId.length > PAGE_LIMITS.MAX_ID) {
    schema('context.actorId is invalid');
  }
  const roleRaw = assertString(context.role, 'context.role');
  if (roleRaw !== 'owner' && roleRaw !== 'editor' && roleRaw !== 'viewer') {
    schema('context.role is invalid');
  }
  const agent = assertBoolean(context.agent, 'context.agent');
  if (!Array.isArray(context.scopeIds)) {
    schema('context.scopeIds must be an array');
  }
  const scopeIds = context.scopeIds.map((id, index) => assertId(id, `context.scopeIds[${index}]`));
  const result: PageOperationContext = {
    actorId,
    role: roleRaw,
    agent,
    scopeIds,
  };
  if (context.authorizedNodeIds !== undefined) {
    if (!Array.isArray(context.authorizedNodeIds)) {
      schema('context.authorizedNodeIds must be an array');
    }
    result.authorizedNodeIds = context.authorizedNodeIds.map((id, index) =>
      assertId(id, `context.authorizedNodeIds[${index}]`),
    );
  }
  return result;
}

function inScope(
  ids: readonly string[],
  declared: Set<string>,
  grant: Set<string> | null,
  createdIds: Set<string>,
): void {
  for (const id of ids) {
    if (createdIds.has(id)) {
      continue;
    }
    if (!declared.has(id)) {
      scope(`node "${id}" is outside scopeIds`);
    }
    if (grant && !grant.has(id)) {
      scope(`node "${id}" is outside the agent grant`);
    }
  }
}

function ensureAssetRef(doc: PageDocument, assetId: string, version: number): void {
  const exists = doc.assetRefs.some((ref) => ref.assetId === assetId && ref.version === version);
  if (!exists) {
    doc.assetRefs.push({ assetId, version });
  }
}

function validatePropValue(type: PageNodeType, property: string, value: unknown): unknown {
  const allowed = propAllowlist(type);
  if (!allowed.has(property)) {
    schema(`property "${property}" is not allowed on ${type} nodes`);
  }
  if (
    property === 'locked' ||
    property === 'id' ||
    property === 'type' ||
    property === 'parentId' ||
    property === 'style' ||
    property === 'html' ||
    property === 'dangerouslySetInnerHTML'
  ) {
    schema(`property "${property}" cannot be set through setProperty`);
  }

  switch (type) {
    case 'section':
    case 'stack': {
      if (property === 'direction' || property === 'mobileDirection') {
        return assertDirection(value, property);
      }
      if (property === 'gap') {
        return inRange(
          assertInteger(value, property),
          PAGE_LIMITS.MIN_GAP,
          PAGE_LIMITS.MAX_GAP,
          property,
        );
      }
      if (property === 'padding') {
        return inRange(
          assertInteger(value, property),
          PAGE_LIMITS.MIN_PADDING,
          PAGE_LIMITS.MAX_PADDING,
          property,
        );
      }
      if (property === 'background') {
        return assertColor(value, property);
      }
      schema(`property "${property}" is not allowed`);
      break;
    }
    case 'text': {
      if (property === 'text') {
        const text = assertString(value, property);
        if (text.length > PAGE_LIMITS.MAX_TEXT) {
          schema('text exceeds maximum length');
        }
        if (CONTROL_RE.test(text)) {
          schema('text contains control characters');
        }
        return text;
      }
      if (property === 'size') {
        return inRange(
          assertInteger(value, property),
          PAGE_LIMITS.MIN_SIZE,
          PAGE_LIMITS.MAX_SIZE,
          property,
        );
      }
      if (property === 'color') {
        return assertColor(value, property);
      }
      if (property === 'weight') {
        const weight = assertInteger(value, property);
        if (!PAGE_WEIGHT_SET.has(weight)) {
          schema('weight must be 400, 600, or 700');
        }
        return weight;
      }
      schema(`property "${property}" is not allowed`);
      break;
    }
    case 'image': {
      if (property === 'assetId') {
        return assertId(value, property);
      }
      if (property === 'version') {
        const version = assertInteger(value, property);
        if (version < 1) {
          schema('version must be >= 1');
        }
        return version;
      }
      if (property === 'alt') {
        const alt = assertString(value, property);
        if (alt.length > PAGE_LIMITS.MAX_ALT) {
          schema('alt exceeds maximum length');
        }
        if (CONTROL_RE.test(alt)) {
          schema('alt contains control characters');
        }
        return alt;
      }
      schema(`property "${property}" is not allowed`);
      break;
    }
    case 'button': {
      if (property === 'label') {
        const label = assertString(value, property);
        if (label.length === 0 || label.length > PAGE_LIMITS.MAX_LABEL) {
          schema('label length is invalid');
        }
        if (CONTROL_RE.test(label)) {
          schema('label contains control characters');
        }
        return label;
      }
      if (property === 'href') {
        return assertSafePageHref(value, property);
      }
      schema(`property "${property}" is not allowed`);
      break;
    }
    default:
      schema(`property "${property}" is not allowed`);
  }
}

function applyProp(node: PageNode, property: string, value: unknown): void {
  const next = validatePropValue(node.type, property, value);
  (node.props as unknown as Record<string, unknown>)[property] = next;
}

function parseOperation(raw: unknown, index: number): PageOperation {
  if (!isPlainObject(raw)) {
    schema(`operations[${index}] must be an object`);
  }
  assertAllowedKeys(raw, PAGE_OPERATION_KEY_SET, `operations[${index}]`);
  for (const field of PAGE_FORBIDDEN_BODY_SET) {
    if (field in raw) {
      schema(`operation actor cannot be a body field ("${field}")`);
    }
  }
  const type = assertString(raw.type, `operations[${index}].type`);
  if (!PAGE_OPERATION_TYPE_SET.has(type)) {
    schema(`operations[${index}] has unknown type "${type}"`);
  }
  const op: PageOperation = { type: type as PageOperationType };
  if (raw.nodeId !== undefined) {
    op.nodeId = assertId(raw.nodeId, `operations[${index}].nodeId`);
  }
  if (raw.parentId !== undefined) {
    op.parentId =
      raw.parentId === null ? null : assertId(raw.parentId, `operations[${index}].parentId`);
  }
  if (raw.property !== undefined) {
    op.property = assertString(raw.property, `operations[${index}].property`);
    if (PAGE_FORBIDDEN_KEY_SET.has(op.property) || op.property === 'locked') {
      schema(`property "${op.property}" cannot be set through operations`);
    }
  }
  if (raw.value !== undefined) {
    const cloned = cloneJson(raw.value);
    if (
      cloned !== null &&
      typeof cloned !== 'string' &&
      typeof cloned !== 'number' &&
      typeof cloned !== 'boolean'
    ) {
      schema(`operations[${index}].value must be a primitive`);
    }
    op.value = cloned as string | number | boolean | null;
  }
  if (raw.node !== undefined) {
    op.node = parseNode(raw.node, index);
  }
  return op;
}

function parseOperations(ops: unknown): PageOperation[] {
  if (!Array.isArray(ops)) {
    schema('operations must be an array');
  }
  if (ops.length === 0) {
    schema('operations must not be empty');
  }
  if (ops.length > PAGE_LIMITS.MAX_OPS) {
    schema(`operations exceed limit of ${PAGE_LIMITS.MAX_OPS}`);
  }
  return ops.map((op, index) => parseOperation(op, index));
}

interface WorkingState {
  doc: PageDocument;
  createdIds: Set<string>;
}

function applyOne(
  state: WorkingState,
  op: PageOperation,
  declared: Set<string>,
  grant: Set<string> | null,
  context: PageOperationContext,
): void {
  const { doc, createdIds } = state;
  switch (op.type) {
    case 'setProperty': {
      if (!op.nodeId || op.property === undefined) {
        schema('setProperty requires nodeId and property');
      }
      inScope([op.nodeId], declared, grant, createdIds);
      assertUnlocked(doc, [op.nodeId]);
      const node = requireNode(doc, op.nodeId);
      if (PAGE_CONTAINER_SET.has(node.type)) {
        const affected = subtreeIds(doc, node.id);
        inScope(affected, declared, grant, createdIds);
        assertUnlocked(doc, affected);
      }
      applyProp(node, op.property, op.value);
      if (node.type === 'image') {
        const image = node.props as PageImageProps;
        ensureAssetRef(doc, image.assetId, image.version);
      }
      return;
    }
    case 'setText': {
      if (!op.nodeId) {
        schema('setText requires nodeId');
      }
      inScope([op.nodeId], declared, grant, createdIds);
      assertUnlocked(doc, [op.nodeId]);
      const node = requireNode(doc, op.nodeId);
      if (node.type !== 'text') {
        schema('setText is only valid on text nodes');
      }
      applyProp(node, 'text', op.value);
      return;
    }
    case 'insertNode': {
      if (!op.node) {
        schema('insertNode requires node');
      }
      const node = cloneNode(op.node);
      if (op.parentId !== undefined) {
        node.parentId = op.parentId;
      }
      if (context.agent && node.locked) {
        capability('agents cannot create locked nodes');
      }
      // Locks are sticky input state for trusted users; agents always insert unlocked.
      if (context.agent) {
        node.locked = false;
      }
      if (node.parentId !== null) {
        inScope([node.parentId], declared, grant, createdIds);
        assertUnlocked(doc, [node.parentId]);
        const parent = requireNode(doc, node.parentId);
        if (!PAGE_CONTAINER_SET.has(parent.type)) {
          schema('insertNode parent must be a section or stack');
        }
      } else {
        if (!PAGE_CONTAINER_SET.has(node.type)) {
          schema('root insertNode must be a section or stack');
        }
        if (grant) {
          const existing = doc.nodes.map((item) => item.id);
          inScope(existing, declared, grant, createdIds);
        }
      }
      if (doc.nodes.some((item) => item.id === node.id) || createdIds.has(node.id)) {
        designError(409, DesignErrorCodes.ID_REUSE, `node id "${node.id}" already exists`);
      }
      if (node.type === 'image') {
        const image = node.props as PageImageProps;
        ensureAssetRef(doc, image.assetId, image.version);
      }
      doc.nodes.push(node);
      createdIds.add(node.id);
      assertGraph(doc.nodes);
      return;
    }
    case 'removeNode': {
      if (!op.nodeId) {
        schema('removeNode requires nodeId');
      }
      if (!doc.nodes.some((node) => node.id === op.nodeId)) {
        schema(`node "${op.nodeId}" does not exist`);
      }
      const ids = subtreeIds(doc, op.nodeId);
      inScope(ids, declared, grant, createdIds);
      assertUnlocked(doc, ids);
      const remove = new Set(ids);
      doc.nodes = doc.nodes.filter((node) => !remove.has(node.id));
      return;
    }
    case 'lock':
    case 'unlock': {
      if (context.agent) capability('Agents cannot change locks');
      if (!op.nodeId) schema('nodeId required');
      inScope([op.nodeId], declared, grant, createdIds);
      const node = requireNode(doc, op.nodeId);
      if (node.parentId) assertUnlocked(doc, [node.parentId]);
      node.locked = op.type === 'lock';
      return;
    }
    default:
      schema(`unsupported operation type`);
  }
}

/**
 * Validate a registered page document envelope and graph.
 * Throws DesignError on schema/id/graph/asset violations.
 */
export function validatePageDocument(doc: unknown): void {
  parsePageDocument(doc);
}

/**
 * Apply allowlisted page operations immutably.
 * Actor/role/scope are trusted context only. No unlock operation exists.
 */
export function applyPageOperations(doc: unknown, ops: unknown, context: unknown): PageDocument {
  const parsedContext = assertContext(context);
  assertWritableRole(parsedContext);
  const current = parsePageDocument(cloneJson(doc));
  const operations = parseOperations(ops);

  const declared = new Set(parsedContext.scopeIds);
  const grant = grantSet(parsedContext);
  if (grant) {
    for (const id of declared) {
      if (!grant.has(id)) {
        scope(`scopeIds node "${id}" is outside the agent grant`);
      }
    }
  }

  const working: WorkingState = {
    doc: clonePageDocument(current),
    createdIds: new Set<string>(),
  };

  for (const op of operations) {
    applyOne(working, op, declared, grant, parsedContext);
  }

  return parsePageDocument(working.doc);
}
