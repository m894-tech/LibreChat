/**
 * Pure design-document validator and operation applier.
 *
 * Storage imports:
 *   - `validateDocument(doc, resolver?)` — throws `DesignError` on invalid envelope/nodes
 *   - `applyOperations(doc, batch, context, resolver?)` — returns next revision (+1), never mutates inputs
 *   - `canonicalHash(value)` — SHA-256 of stable JSON (sorted keys)
 * Optional `SystemResolver` defaults to builtin `getSystem` (fail closed). Does not mutate catalog/ALS.
 *
 * Actor is trusted `OperationContext` only. Operation body may not carry actor/owner/role.
 */

import { createHash } from 'crypto';
import type { ResolvedDesignSystem, SystemResolver } from './system-resolver';
import {
  ALLOWED_FONT_FAMILIES,
  DEFAULT_TOKEN_ROLES,
  getSystem,
  tokenCompatible,
  type DesignToken,
} from './systems';
import { DesignErrorCodes, designError } from './errors';

export type { ResolvedDesignSystem, SystemResolver };
import type {
  AssetRef,
  CropRect,
  DesignDocument,
  DesignNode,
  DesignOperation,
  FontStyle,
  NodeProps,
  NodeType,
  OperationBatch,
  OperationContext,
  OperationType,
  TextAlign,
} from './types';
import {
  BATCH_KEYS,
  DESIGN_LIMITS,
  DOCUMENT_KEYS,
  FONT_STYLES,
  FORBIDDEN_BODY_FIELDS,
  FORBIDDEN_KEYS,
  GEOMETRY_PROP_KEYS,
  NODE_KEYS,
  NODE_PROP_ALLOWLIST,
  NODE_PROP_KEYS,
  NODE_TYPES,
  OPERATION_KEYS,
  OPERATION_TYPES,
  TEXT_ALIGNS,
} from './types';

const FORBIDDEN_KEY_SET = new Set<string>(FORBIDDEN_KEYS);
const FORBIDDEN_BODY_SET = new Set<string>(FORBIDDEN_BODY_FIELDS);
const DOCUMENT_KEY_SET = new Set<string>(DOCUMENT_KEYS);
const NODE_KEY_SET = new Set<string>(NODE_KEYS);
const OPERATION_KEY_SET = new Set<string>(OPERATION_KEYS);
const BATCH_KEY_SET = new Set<string>(BATCH_KEYS);
const NODE_TYPE_SET = new Set<string>(NODE_TYPES);
const OPERATION_TYPE_SET = new Set<string>(OPERATION_TYPES);
const FONT_STYLE_SET = new Set<string>(FONT_STYLES);
const TEXT_ALIGN_SET = new Set<string>(TEXT_ALIGNS);
const FONT_FAMILY_SET = new Set<string>(ALLOWED_FONT_FAMILIES);
const NODE_PROP_KEY_SET = new Set<string>(NODE_PROP_KEYS);
const GEOMETRY_KEY_SET = new Set<string>(GEOMETRY_PROP_KEYS);

const COLOR_RE = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TOKEN_ROLE_RE = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const CROP_KEYS = new Set(['x', 'y', 'width', 'height']);

const BINDABLE_PROPS = new Set(['fill', 'stroke', 'fontFamily', 'fontSize']);

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

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value) || FORBIDDEN_KEY_SET.has(value)) {
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

function cloneJson<T>(value: T): T {
  return cloneValue(value, 0) as T;
}

function cloneValue(value: unknown, depth: number): unknown {
  if (depth > 32) {
    schema('value nesting exceeds limit');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      schema('non-finite number is not serializable');
    }
    return value;
  }
  if (typeof value !== 'object') {
    schema('value contains a non-JSON type');
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item, depth + 1));
  }
  if (!isPlainObject(value)) {
    schema('value must be a plain object');
  }
  assertNoForbiddenKeys(value, 'value');
  const out: Record<string, unknown> = {};
  for (const key of ownKeys(value)) {
    const next = value[key];
    if (next !== undefined) {
      out[key] = cloneValue(next, depth + 1);
    }
  }
  return out;
}

/**
 * SHA-256 hex digest of a stably serialized JSON value (sorted object keys, UTF-8).
 * Used by storage for idempotency body hashes. Does not include actor identity.
 */
export function canonicalHash(value: unknown): string {
  const canonical = canonicalize(value, 0);
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

function canonicalize(value: unknown, depth: number): unknown {
  if (depth > 32) {
    schema('value nesting exceeds limit');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      schema('non-finite number cannot be hashed');
    }
    return value;
  }
  if (typeof value !== 'object') {
    schema('value contains a non-JSON type');
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, depth + 1));
  }
  if (!isPlainObject(value)) {
    schema('value must be a plain object');
  }
  assertNoForbiddenKeys(value, 'hash value');
  const keys = ownKeys(value).sort();
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const next = value[key];
    if (next !== undefined) {
      out[key] = canonicalize(next, depth + 1);
    }
  }
  return out;
}

function allowlistFor(type: NodeType): Set<string> {
  return new Set<string>(NODE_PROP_ALLOWLIST[type]);
}

function readCrop(value: unknown, label: string): CropRect {
  if (!isPlainObject(value)) {
    schema(`${label} must be an object`);
  }
  assertAllowedKeys(value, CROP_KEYS, label);
  const x = assertFiniteNumber(value.x, `${label}.x`);
  const y = assertFiniteNumber(value.y, `${label}.y`);
  const width = assertFiniteNumber(value.width, `${label}.width`);
  const height = assertFiniteNumber(value.height, `${label}.height`);
  inRange(x, -DESIGN_LIMITS.MAX_CROP, DESIGN_LIMITS.MAX_CROP, `${label}.x`);
  inRange(y, -DESIGN_LIMITS.MAX_CROP, DESIGN_LIMITS.MAX_CROP, `${label}.y`);
  inRange(width, 0, DESIGN_LIMITS.MAX_CROP, `${label}.width`);
  inRange(height, 0, DESIGN_LIMITS.MAX_CROP, `${label}.height`);
  return { x, y, width, height };
}

function validatePropValue(type: NodeType, property: string, value: unknown): unknown {
  const allowed = allowlistFor(type);
  if (!allowed.has(property) || !NODE_PROP_KEY_SET.has(property)) {
    schema(`property "${property}" is not allowed on ${type} nodes`);
  }
  if (
    property === 'locked' ||
    property === 'id' ||
    property === 'type' ||
    property === 'parentId'
  ) {
    schema(`property "${property}" cannot be set through setProperty`);
  }
  switch (property) {
    case 'x':
    case 'y':
      return inRange(
        assertFiniteNumber(value, property),
        -DESIGN_LIMITS.MAX_COORD,
        DESIGN_LIMITS.MAX_COORD,
        property,
      );
    case 'width':
    case 'height':
      return inRange(assertFiniteNumber(value, property), 0, DESIGN_LIMITS.MAX_ARTBOARD, property);
    case 'rotation':
      return assertFiniteNumber(value, property);
    case 'opacity':
      return inRange(assertFiniteNumber(value, property), 0, 1, property);
    case 'text': {
      const text = assertString(value, property);
      if (text.length > DESIGN_LIMITS.MAX_TEXT) {
        schema('text exceeds maximum length');
      }
      return text;
    }
    case 'fontSize':
      return inRange(
        assertFiniteNumber(value, property),
        DESIGN_LIMITS.MIN_FONT_SIZE,
        DESIGN_LIMITS.MAX_FONT_SIZE,
        property,
      );
    case 'fontFamily': {
      const family = assertString(value, property);
      if (!FONT_FAMILY_SET.has(family)) {
        schema(`fontFamily "${family}" is not in the catalog`);
      }
      return family;
    }
    case 'fontStyle': {
      const style = assertString(value, property);
      if (!FONT_STYLE_SET.has(style)) {
        schema('fontStyle is invalid');
      }
      return style as FontStyle;
    }
    case 'fill':
    case 'stroke':
      return assertColor(value, property);
    case 'strokeWidth':
      return inRange(
        assertFiniteNumber(value, property),
        0,
        DESIGN_LIMITS.MAX_STROKE_WIDTH,
        property,
      );
    case 'assetId':
      return assertId(value, property);
    case 'assetVersion': {
      const version = assertInteger(value, property);
      if (version < 1) {
        schema('assetVersion must be >= 1');
      }
      return version;
    }
    case 'crop':
      return readCrop(value, property);
    case 'align': {
      const align = assertString(value, property);
      if (!TEXT_ALIGN_SET.has(align)) {
        schema('align is invalid');
      }
      return align as TextAlign;
    }
    default:
      schema(`property "${property}" is not allowed`);
  }
}

function cloneProps(type: NodeType, props: NodeProps): NodeProps {
  const allowed = allowlistFor(type);
  const next: NodeProps = {
    x: props.x,
    y: props.y,
    width: props.width,
    height: props.height,
    rotation: props.rotation,
    opacity: props.opacity,
  };
  for (const key of NODE_PROP_KEYS) {
    if (GEOMETRY_KEY_SET.has(key)) {
      continue;
    }
    if (!allowed.has(key)) {
      continue;
    }
    const value = props[key];
    if (value === undefined) {
      continue;
    }
    if (key === 'crop' && props.crop) {
      next.crop = { ...props.crop };
    } else {
      (next as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

function cloneNode(node: DesignNode): DesignNode {
  return {
    id: node.id,
    type: node.type,
    parentId: node.parentId,
    locked: node.locked,
    props: cloneProps(node.type, node.props),
    bindings: { ...node.bindings },
  };
}

function cloneAssetRefs(refs: AssetRef[]): AssetRef[] {
  return refs.map((ref) => ({ assetId: ref.assetId, version: ref.version }));
}

function cloneDocument(doc: DesignDocument): DesignDocument {
  return {
    id: doc.id,
    projectId: doc.projectId,
    kind: 'canvas',
    schemaVersion: 1,
    title: doc.title,
    revision: doc.revision,
    designSystem: { id: doc.designSystem.id, version: doc.designSystem.version },
    payload: {
      width: doc.payload.width,
      height: doc.payload.height,
      nodes: doc.payload.nodes.map(cloneNode),
    },
    assetRefs: cloneAssetRefs(doc.assetRefs),
    archived: doc.archived,
  };
}

function parseBindings(
  raw: unknown,
  type: NodeType,
  system: ResolvedDesignSystem,
): Record<string, string> {
  if (!isPlainObject(raw)) {
    schema('bindings must be an object');
  }
  assertNoForbiddenKeys(raw, 'bindings');
  const allowed = allowlistFor(type);
  const bindings: Record<string, string> = {};
  for (const key of ownKeys(raw)) {
    if (!allowed.has(key) || !BINDABLE_PROPS.has(key)) {
      schema(`binding property "${key}" is not bindable on ${type}`);
    }
    const role = raw[key];
    if (typeof role !== 'string' || !TOKEN_ROLE_RE.test(role)) {
      schema(`binding for "${key}" must be a token role`);
    }
    const token = system.tokens[role];
    if (!token) {
      schema(`token role "${role}" is not in pinned system ${system.id}@${system.version}`);
    }
    if (!tokenCompatible(token, key)) {
      schema(`token "${role}" cannot bind to "${key}"`);
    }
    bindings[key] = role;
  }
  return bindings;
}

function parseNode(raw: unknown, system: ResolvedDesignSystem): DesignNode {
  if (!isPlainObject(raw)) {
    schema('node must be an object');
  }
  assertAllowedKeys(raw, NODE_KEY_SET, 'node');
  const id = assertId(raw.id, 'node.id');
  const typeRaw = assertString(raw.type, 'node.type');
  if (!NODE_TYPE_SET.has(typeRaw)) {
    schema(`unknown node type "${typeRaw}"`);
  }
  const type = typeRaw as NodeType;
  const parentId = raw.parentId === null ? null : assertId(raw.parentId, 'node.parentId');
  const locked = assertBoolean(raw.locked, 'node.locked');
  if (!isPlainObject(raw.props)) {
    schema('node.props must be an object');
  }
  assertNoForbiddenKeys(raw.props, 'node.props');
  const allowed = allowlistFor(type);
  for (const key of ownKeys(raw.props)) {
    if (!allowed.has(key)) {
      schema(`unknown prop "${key}" on ${type} node`);
    }
  }
  for (const key of GEOMETRY_PROP_KEYS) {
    if (raw.props[key] === undefined) {
      schema(`node.props.${key} is required`);
    }
  }
  const props: NodeProps = {
    x: validatePropValue(type, 'x', raw.props.x) as number,
    y: validatePropValue(type, 'y', raw.props.y) as number,
    width: validatePropValue(type, 'width', raw.props.width) as number,
    height: validatePropValue(type, 'height', raw.props.height) as number,
    rotation: validatePropValue(type, 'rotation', raw.props.rotation) as number,
    opacity: validatePropValue(type, 'opacity', raw.props.opacity) as number,
  };
  for (const key of ownKeys(raw.props)) {
    if (GEOMETRY_KEY_SET.has(key)) {
      continue;
    }
    (props as unknown as Record<string, unknown>)[key] = validatePropValue(
      type,
      key,
      raw.props[key],
    );
  }
  if (type === 'text' && props.text === undefined) {
    schema('text nodes require props.text');
  }
  const bindings = parseBindings(raw.bindings, type, system);
  return { id, type, parentId, locked, props, bindings };
}

function parseAssetRef(raw: unknown): AssetRef {
  if (!isPlainObject(raw)) {
    schema('assetRef must be an object');
  }
  assertAllowedKeys(raw, new Set(['assetId', 'version']), 'assetRef');
  const assetId = assertId(raw.assetId, 'assetRef.assetId');
  const version = assertInteger(raw.version, 'assetRef.version');
  if (version < 1) {
    schema('assetRef.version must be >= 1');
  }
  return { assetId, version };
}

function assertGraph(nodes: DesignNode[]): void {
  if (nodes.length > DESIGN_LIMITS.MAX_NODES) {
    schema(`document exceeds ${DESIGN_LIMITS.MAX_NODES} nodes`);
  }
  const byId = new Map<string, DesignNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      designError(409, DesignErrorCodes.ID_REUSE, `duplicate node id "${node.id}"`);
    }
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.parentId === null) {
      continue;
    }
    if (node.parentId === node.id) {
      schema(`node "${node.id}" cannot parent itself`);
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      schema(`node "${node.id}" parent "${node.parentId}" does not exist`);
    }
    if (parent.type !== 'group') {
      schema(`node "${node.id}" parent must be a group`);
    }
    const seen = new Set<string>();
    let cursor: DesignNode | undefined = node;
    while (cursor?.parentId) {
      if (seen.has(cursor.id)) {
        schema('node parent cycle detected');
      }
      seen.add(cursor.id);
      cursor = byId.get(cursor.parentId);
      if (!cursor) {
        schema('node parent chain is broken');
      }
    }
  }
}

/**
 * Validates a whole document. Throws DesignError; does not mutate `doc`.
 * Asset existence/ACL is also a storage responsibility; domain checks shape and refs present on images.
 */
export function validateDocument(doc: unknown, resolver: SystemResolver = getSystem): void {
  parseDocument(doc, resolver);
}

function parseDocument(doc: unknown, resolver: SystemResolver): DesignDocument {
  if (!isPlainObject(doc)) {
    schema('document must be an object');
  }
  assertAllowedKeys(doc, DOCUMENT_KEY_SET, 'document');
  const id = assertId(doc.id, 'document.id');
  const projectId = assertId(doc.projectId, 'document.projectId');
  if (doc.kind !== 'canvas') {
    schema('document.kind must be "canvas"');
  }
  if (doc.schemaVersion !== 1) {
    schema('document.schemaVersion must be 1');
  }
  const title = assertString(doc.title, 'document.title');
  if (title.length === 0 || title.length > DESIGN_LIMITS.MAX_TITLE) {
    schema('document.title is invalid');
  }
  const revision = assertInteger(doc.revision, 'document.revision');
  if (revision < 0) {
    schema('document.revision must be >= 0');
  }
  if (!isPlainObject(doc.designSystem)) {
    schema('document.designSystem must be an object');
  }
  assertAllowedKeys(doc.designSystem, new Set(['id', 'version']), 'document.designSystem');
  const systemId = assertString(doc.designSystem.id, 'document.designSystem.id');
  const systemVersion = assertString(doc.designSystem.version, 'document.designSystem.version');
  const system = resolver(systemId, systemVersion);
  if (!system) {
    schema(`unknown design system ${systemId}@${systemVersion}`);
  }
  if (!isPlainObject(doc.payload)) {
    schema('document.payload must be an object');
  }
  assertAllowedKeys(doc.payload, new Set(['width', 'height', 'nodes']), 'document.payload');
  const width = inRange(
    assertInteger(doc.payload.width, 'payload.width'),
    DESIGN_LIMITS.MIN_ARTBOARD,
    DESIGN_LIMITS.MAX_ARTBOARD,
    'payload.width',
  );
  const height = inRange(
    assertInteger(doc.payload.height, 'payload.height'),
    DESIGN_LIMITS.MIN_ARTBOARD,
    DESIGN_LIMITS.MAX_ARTBOARD,
    'payload.height',
  );
  if (!Array.isArray(doc.payload.nodes)) {
    schema('payload.nodes must be an array');
  }
  const nodes = doc.payload.nodes.map((node) => parseNode(node, system));
  assertGraph(nodes);
  if (!Array.isArray(doc.assetRefs)) {
    schema('assetRefs must be an array');
  }
  const assetRefs = doc.assetRefs.map(parseAssetRef);
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
    if (node.props.assetId !== undefined || node.props.assetVersion !== undefined) {
      if (node.props.assetId === undefined || node.props.assetVersion === undefined) {
        schema(`image "${node.id}" assetId and assetVersion must be paired`);
      }
      const key = `${node.props.assetId}@${node.props.assetVersion}`;
      if (!seenRefs.has(key)) {
        schema(`image "${node.id}" references missing assetRef ${key}`);
      }
    }
  }
  const archived = assertBoolean(doc.archived, 'document.archived');
  return {
    id,
    projectId,
    kind: 'canvas',
    schemaVersion: 1,
    title,
    revision,
    designSystem: { id: system.id, version: system.version },
    payload: { width, height, nodes },
    assetRefs,
    archived,
  };
}

interface WorkingState {
  doc: DesignDocument;
  createdIds: Set<string>;
}

function nodeIndex(nodes: DesignNode[]): Map<string, number> {
  const map = new Map<string, number>();
  nodes.forEach((node, index) => map.set(node.id, index));
  return map;
}

function requireNode(doc: DesignDocument, nodeId: string): DesignNode {
  const node = doc.payload.nodes.find((item) => item.id === nodeId);
  if (!node) {
    schema(`node "${nodeId}" does not exist`);
  }
  return node;
}

function isAncestorLocked(doc: DesignDocument, nodeId: string): boolean {
  const byId = new Map(doc.payload.nodes.map((node) => [node.id, node]));
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

function subtreeIds(doc: DesignDocument, rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const node of doc.payload.nodes) {
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

function grantSet(context: OperationContext): Set<string> | null {
  if (!context.agent) {
    return null;
  }
  return new Set(context.authorizedNodeIds ?? []);
}

function assertWritableRole(context: OperationContext): void {
  if (context.role === 'viewer') {
    designError(403, DesignErrorCodes.FORBIDDEN, 'viewer cannot mutate documents');
  }
  if (context.role !== 'owner' && context.role !== 'editor') {
    designError(403, DesignErrorCodes.FORBIDDEN, 'unsupported role');
  }
}

function assertContext(context: unknown): OperationContext {
  if (!isPlainObject(context)) {
    schema('operation context must be an object');
  }
  const actorId = assertString(context.actorId, 'context.actorId');
  if (actorId.length === 0 || actorId.length > DESIGN_LIMITS.MAX_ID) {
    schema('context.actorId is invalid');
  }
  const role = assertString(context.role, 'context.role');
  if (role !== 'owner' && role !== 'editor' && role !== 'viewer') {
    schema('context.role is invalid');
  }
  const agent = assertBoolean(context.agent, 'context.agent');
  let authorizedNodeIds: string[] | undefined;
  if (context.authorizedNodeIds !== undefined) {
    if (!Array.isArray(context.authorizedNodeIds)) {
      schema('context.authorizedNodeIds must be an array');
    }
    authorizedNodeIds = context.authorizedNodeIds.map((id, index) =>
      assertId(id, `context.authorizedNodeIds[${index}]`),
    );
  }
  return { actorId, role, agent, authorizedNodeIds };
}

function parseBatch(batch: unknown): OperationBatch {
  if (!isPlainObject(batch)) {
    schema('operation batch must be an object');
  }
  assertAllowedKeys(batch, BATCH_KEY_SET, 'operation batch');
  for (const field of FORBIDDEN_BODY_FIELDS) {
    if (field in batch) {
      schema(`operation actor cannot be a body field ("${field}")`);
    }
  }
  const operationId = assertString(batch.operationId, 'operationId');
  if (operationId.length === 0 || operationId.length > 128) {
    schema('operationId is invalid');
  }
  const expectedRevision = assertInteger(batch.expectedRevision, 'expectedRevision');
  if (expectedRevision < 0) {
    schema('expectedRevision must be >= 0');
  }
  if (!Array.isArray(batch.declaredScope)) {
    schema('declaredScope must be an array');
  }
  const declaredScope = batch.declaredScope.map((id, index) =>
    assertId(id, `declaredScope[${index}]`),
  );
  if (!Array.isArray(batch.operations)) {
    schema('operations must be an array');
  }
  if (batch.operations.length === 0) {
    schema('operations must not be empty');
  }
  if (batch.operations.length > DESIGN_LIMITS.MAX_BATCH) {
    schema(`operations exceed batch limit of ${DESIGN_LIMITS.MAX_BATCH}`);
  }
  const operations = batch.operations.map((op, index) => parseOperation(op, index));
  return { operationId, expectedRevision, declaredScope, operations };
}

function parseOperation(raw: unknown, index: number): DesignOperation {
  if (!isPlainObject(raw)) {
    schema(`operations[${index}] must be an object`);
  }
  assertAllowedKeys(raw, OPERATION_KEY_SET, `operations[${index}]`);
  for (const field of FORBIDDEN_BODY_SET) {
    if (field in raw) {
      schema(`operation actor cannot be a body field ("${field}")`);
    }
  }
  const type = assertString(raw.type, `operations[${index}].type`);
  if (!OPERATION_TYPE_SET.has(type)) {
    schema(`operations[${index}] has unknown type "${type}"`);
  }
  const op: DesignOperation = { type: type as OperationType };
  if (raw.nodeId !== undefined) {
    op.nodeId = assertId(raw.nodeId, `operations[${index}].nodeId`);
  }
  if (raw.parentId !== undefined) {
    op.parentId =
      raw.parentId === null ? null : assertId(raw.parentId, `operations[${index}].parentId`);
  }
  if (raw.property !== undefined) {
    op.property = assertString(raw.property, `operations[${index}].property`);
    if (FORBIDDEN_KEY_SET.has(op.property) || op.property === 'locked') {
      schema(`property "${op.property}" cannot be set through operations`);
    }
  }
  if (raw.value !== undefined) {
    op.value = cloneJson(raw.value);
  }
  if (raw.node !== undefined) {
    if (!isPlainObject(raw.node)) {
      schema(`operations[${index}].node must be an object`);
    }
    op.node = cloneJson(raw.node) as unknown as DesignNode;
  }
  if (raw.assetId !== undefined) {
    op.assetId = assertId(raw.assetId, `operations[${index}].assetId`);
  }
  if (raw.assetVersion !== undefined) {
    op.assetVersion = assertInteger(raw.assetVersion, `operations[${index}].assetVersion`);
    if (op.assetVersion < 1) {
      schema('assetVersion must be >= 1');
    }
  }
  if (raw.systemId !== undefined) {
    op.systemId = assertString(raw.systemId, `operations[${index}].systemId`);
  }
  if (raw.systemVersion !== undefined) {
    op.systemVersion = assertString(raw.systemVersion, `operations[${index}].systemVersion`);
  }
  if (raw.preserveOverrides !== undefined) {
    op.preserveOverrides = assertBoolean(
      raw.preserveOverrides,
      `operations[${index}].preserveOverrides`,
    );
  }
  return op;
}

function inScope(
  ids: string[],
  declared: Set<string>,
  grant: Set<string> | null,
  created: Set<string>,
): void {
  for (const id of ids) {
    if (created.has(id)) {
      continue;
    }
    if (!declared.has(id)) {
      scope(`node "${id}" is outside declaredScope`);
    }
    if (grant && !grant.has(id)) {
      scope(`node "${id}" is outside the agent grant`);
    }
  }
}

function assertUnlocked(doc: DesignDocument, ids: string[]): void {
  for (const id of ids) {
    if (isAncestorLocked(doc, id)) {
      lock(`node "${id}" is locked`);
    }
  }
}

/** Geometry/reorder of a group would move locked descendants; require the whole subtree unlocked. */
function assertSubtreeUnlocked(doc: DesignDocument, nodeId: string): void {
  assertUnlocked(doc, subtreeIds(doc, nodeId));
}

function applyProp(
  node: DesignNode,
  property: string,
  value: unknown,
  clearBinding: boolean,
): void {
  const next = validatePropValue(node.type, property, value);
  (node.props as unknown as Record<string, unknown>)[property] = next;
  if (clearBinding && node.bindings[property] !== undefined) {
    delete node.bindings[property];
  }
}

function ensureAssetRef(doc: DesignDocument, assetId: string, version: number): void {
  const exists = doc.assetRefs.some((ref) => ref.assetId === assetId && ref.version === version);
  if (!exists) {
    doc.assetRefs.push({ assetId, version });
  }
}

function applyTokenValue(node: DesignNode, property: string, token: DesignToken): void {
  applyProp(node, property, token.value, false);
  node.bindings[property] = token.role;
}

function applyOne(
  state: WorkingState,
  op: DesignOperation,
  declared: Set<string>,
  grant: Set<string> | null,
  context: OperationContext,
  resolver: SystemResolver,
): void {
  const { doc, createdIds } = state;
  switch (op.type) {
    case 'setProperty': {
      if (!op.nodeId || op.property === undefined) {
        schema('setProperty requires nodeId and property');
      }
      inScope([op.nodeId], declared, grant, createdIds);
      assertSubtreeUnlocked(doc, op.nodeId);
      const node = requireNode(doc, op.nodeId);
      applyProp(node, op.property, op.value, true);
      return;
    }
    case 'setText': {
      if (!op.nodeId) {
        schema('setText requires nodeId');
      }
      inScope([op.nodeId], declared, grant, createdIds);
      assertSubtreeUnlocked(doc, op.nodeId);
      const node = requireNode(doc, op.nodeId);
      if (node.type !== 'text') {
        schema('setText is only valid on text nodes');
      }
      applyProp(node, 'text', op.value, true);
      return;
    }
    case 'insertNode': {
      if (!op.node) {
        schema('insertNode requires node');
      }
      const system = resolver(doc.designSystem.id, doc.designSystem.version);
      if (!system) {
        schema('pinned design system is missing');
      }
      const node = parseNode(op.node, system);
      if (op.parentId !== undefined) {
        node.parentId = op.parentId;
      }
      if (context.agent && node.locked) {
        capability('agents cannot create locked nodes');
      }
      node.locked = false;
      if (node.parentId !== null) {
        inScope([node.parentId], declared, grant, createdIds);
        assertUnlocked(doc, [node.parentId]);
        const parent = requireNode(doc, node.parentId);
        if (parent.type !== 'group') {
          schema('insertNode parent must be a group');
        }
      } else if (grant) {
        const existing = doc.payload.nodes.map((item) => item.id);
        inScope(existing, declared, grant, createdIds);
      }
      if (doc.payload.nodes.some((item) => item.id === node.id) || createdIds.has(node.id)) {
        designError(409, DesignErrorCodes.ID_REUSE, `node id "${node.id}" already exists`);
      }
      if (node.props.assetId && node.props.assetVersion) {
        ensureAssetRef(doc, node.props.assetId, node.props.assetVersion);
      }
      doc.payload.nodes.push(node);
      createdIds.add(node.id);
      return;
    }
    case 'removeNode': {
      if (!op.nodeId) {
        schema('removeNode requires nodeId');
      }
      const ids = subtreeIds(doc, op.nodeId);
      if (!ids.includes(op.nodeId) || !doc.payload.nodes.some((node) => node.id === op.nodeId)) {
        schema(`node "${op.nodeId}" does not exist`);
      }
      inScope(ids, declared, grant, createdIds);
      assertUnlocked(doc, ids);
      const remove = new Set(ids);
      doc.payload.nodes = doc.payload.nodes.filter((node) => !remove.has(node.id));
      return;
    }
    case 'moveNode': {
      if (!op.nodeId || !('parentId' in op)) {
        schema('moveNode requires nodeId and parentId');
      }
      const ids = subtreeIds(doc, op.nodeId);
      if (!doc.payload.nodes.some((node) => node.id === op.nodeId)) {
        schema(`node "${op.nodeId}" does not exist`);
      }
      const targets = [...ids];
      if (op.parentId) {
        targets.push(op.parentId);
      }
      inScope(targets, declared, grant, createdIds);
      assertUnlocked(doc, ids);
      if (op.parentId) {
        assertUnlocked(doc, [op.parentId]);
        const parent = requireNode(doc, op.parentId);
        if (parent.type !== 'group') {
          schema('moveNode parent must be a group');
        }
        if (ids.includes(op.parentId)) {
          schema('moveNode would create a parent cycle');
        }
      } else if (grant) {
        inScope(
          doc.payload.nodes.map((node) => node.id),
          declared,
          grant,
          createdIds,
        );
      }
      const node = requireNode(doc, op.nodeId);
      node.parentId = op.parentId ?? null;
      const current = nodeIndex(doc.payload.nodes).get(op.nodeId);
      if (current === undefined) {
        schema(`node "${op.nodeId}" does not exist`);
      }
      const [moved] = doc.payload.nodes.splice(current, 1);
      let insertAt = doc.payload.nodes.length;
      if (op.value !== undefined) {
        insertAt = inRange(
          assertInteger(op.value, 'moveNode.value'),
          0,
          doc.payload.nodes.length,
          'moveNode.value',
        );
      }
      doc.payload.nodes.splice(insertAt, 0, moved);
      return;
    }
    case 'reorderNode': {
      if (!op.nodeId) {
        schema('reorderNode requires nodeId');
      }
      inScope([op.nodeId], declared, grant, createdIds);
      assertSubtreeUnlocked(doc, op.nodeId);
      requireNode(doc, op.nodeId);
      const current = nodeIndex(doc.payload.nodes).get(op.nodeId) as number;
      const [moved] = doc.payload.nodes.splice(current, 1);
      const insertAt = inRange(
        assertInteger(op.value, 'reorderNode.value'),
        0,
        doc.payload.nodes.length,
        'reorderNode.value',
      );
      doc.payload.nodes.splice(insertAt, 0, moved);
      return;
    }
    case 'replaceAsset': {
      if (!op.nodeId || !op.assetId || op.assetVersion === undefined) {
        schema('replaceAsset requires nodeId, assetId and assetVersion');
      }
      inScope([op.nodeId], declared, grant, createdIds);
      assertSubtreeUnlocked(doc, op.nodeId);
      const node = requireNode(doc, op.nodeId);
      if (node.type !== 'image') {
        schema('replaceAsset is only valid on image nodes');
      }
      applyProp(node, 'assetId', op.assetId, true);
      applyProp(node, 'assetVersion', op.assetVersion, true);
      ensureAssetRef(doc, op.assetId, op.assetVersion);
      return;
    }
    case 'bindToken': {
      if (!op.nodeId || !op.property) {
        schema('bindToken requires nodeId and property');
      }
      inScope([op.nodeId], declared, grant, createdIds);
      assertSubtreeUnlocked(doc, op.nodeId);
      const node = requireNode(doc, op.nodeId);
      const role = assertString(op.value, 'bindToken.value');
      if (!TOKEN_ROLE_RE.test(role)) {
        schema('bindToken value must be a token role');
      }
      const system = resolver(doc.designSystem.id, doc.designSystem.version);
      if (!system) {
        schema('pinned design system is missing');
      }
      const token = system.tokens[role];
      if (!token) {
        schema(`token role "${role}" is not in pinned system ${system.id}@${system.version}`);
      }
      if (!tokenCompatible(token, op.property)) {
        schema(`token "${role}" cannot bind to "${op.property}"`);
      }
      applyTokenValue(node, op.property, token);
      return;
    }
    case 'setLiteral': {
      if (!op.nodeId || !op.property) {
        schema('setLiteral requires nodeId and property');
      }
      inScope([op.nodeId], declared, grant, createdIds);
      assertSubtreeUnlocked(doc, op.nodeId);
      const node = requireNode(doc, op.nodeId);
      applyProp(node, op.property, op.value, true);
      return;
    }
    case 'applySystem': {
      if (!op.systemId || !op.systemVersion) {
        schema('applySystem requires systemId and systemVersion');
      }
      const nextSystem = resolver(op.systemId, op.systemVersion);
      if (!nextSystem) {
        schema(`unknown design system ${op.systemId}@${op.systemVersion}`);
      }
      const allIds = doc.payload.nodes.map((node) => node.id);
      inScope(allIds, declared, grant, createdIds);
      const preserve = op.preserveOverrides !== false;
      for (const node of doc.payload.nodes) {
        if (isAncestorLocked(doc, node.id)) {
          // Freeze stored literals; do not keep bindings that would re-resolve against the new system.
          node.bindings = {};
          continue;
        }
        const nextBindings: Record<string, string> = {};
        for (const [property, role] of Object.entries(node.bindings)) {
          const token = nextSystem.tokens[role];
          if (!token) {
            schema(
              `token role "${role}" is not in pinned system ${nextSystem.id}@${nextSystem.version}`,
            );
          }
          if (!tokenCompatible(token, property)) {
            schema(`token "${role}" cannot bind to "${property}"`);
          }
          applyTokenValue(node, property, token);
          nextBindings[property] = role;
        }
        if (!preserve) {
          const defaults = DEFAULT_TOKEN_ROLES[node.type] ?? {};
          for (const [property, role] of Object.entries(defaults)) {
            if (node.bindings[property]) {
              continue;
            }
            const token = nextSystem.tokens[role];
            if (!token) {
              continue;
            }
            applyTokenValue(node, property, token);
            nextBindings[property] = role;
          }
        }
        node.bindings = { ...node.bindings, ...nextBindings };
      }
      doc.designSystem = { id: nextSystem.id, version: nextSystem.version };
      return;
    }
    case 'lock':
    case 'unlock': {
      if (context.agent) {
        capability('agents cannot lock or unlock nodes');
      }
      if (!op.nodeId) {
        schema(`${op.type} requires nodeId`);
      }
      inScope([op.nodeId], declared, grant, createdIds);
      const node = requireNode(doc, op.nodeId);
      node.locked = op.type === 'lock';
      return;
    }
    default:
      schema(`unsupported operation type`);
  }
}

/**
 * Apply an atomic operation batch.
 *
 * @returns a new document whose `revision` is exactly `doc.revision + 1`
 * @throws DesignError 403 viewer, 409 stale/id reuse, 422 schema/scope/lock/capability
 */
export function applyOperations(
  doc: unknown,
  batch: unknown,
  context: unknown,
  resolver: SystemResolver = getSystem,
): DesignDocument {
  const parsedContext = assertContext(context);
  assertWritableRole(parsedContext);
  const current = parseDocument(cloneJson(doc), resolver);
  if (current.archived) {
    schema('archived documents cannot be mutated');
  }
  const parsedBatch = parseBatch(batch);
  if (parsedBatch.expectedRevision !== current.revision) {
    designError(
      409,
      DesignErrorCodes.REVISION_MISMATCH,
      `expected revision ${parsedBatch.expectedRevision} but document is ${current.revision}`,
    );
  }

  const declared = new Set(parsedBatch.declaredScope);
  const grant = grantSet(parsedContext);
  if (parsedContext.agent && parsedContext.authorizedNodeIds === undefined) {
    // Fail closed: empty grant.
  }
  if (grant) {
    for (const id of declared) {
      if (!grant.has(id)) {
        scope(`declaredScope node "${id}" is outside the agent grant`);
      }
    }
  }

  const working: WorkingState = {
    doc: cloneDocument(current),
    createdIds: new Set<string>(),
  };

  try {
    for (const op of parsedBatch.operations) {
      applyOne(working, op, declared, grant, parsedContext, resolver);
    }
  } catch (error) {
    throw error;
  }

  working.doc.revision = current.revision + 1;
  const validated = parseDocument(working.doc, resolver);
  if (validated.revision !== current.revision + 1) {
    schema('revision must increment by exactly 1');
  }
  return validated;
}
