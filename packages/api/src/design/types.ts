/**
 * Design workspace domain types.
 *
 * Storage imports these contracts from `./types`. Actor identity is supplied via
 * `OperationContext` (trusted by the server) and is never a field on the batch body.
 */

export const DESIGN_LIMITS = {
  MAX_NODES: 1000,
  MIN_ARTBOARD: 64,
  MAX_ARTBOARD: 4096,
  MAX_BATCH: 200,
  MAX_TEXT: 8192,
  MAX_TITLE: 200,
  MAX_ID: 128,
  MAX_FONT_SIZE: 512,
  MIN_FONT_SIZE: 1,
  MAX_STROKE_WIDTH: 64,
  MAX_COORD: 16384,
  MAX_CROP: 65535,
} as const;

export type DesignRole = 'owner' | 'editor' | 'viewer';

export type NodeType = 'text' | 'rect' | 'ellipse' | 'image' | 'group';

export const NODE_TYPES: readonly NodeType[] = ['text', 'rect', 'ellipse', 'image', 'group'];

export type FontStyle = 'normal' | 'italic' | 'bold' | 'bold-italic';

export const FONT_STYLES: readonly FontStyle[] = ['normal', 'italic', 'bold', 'bold-italic'];

export type TextAlign = 'left' | 'center' | 'right';

export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right'];

export type OperationType =
  | 'setProperty'
  | 'setText'
  | 'insertNode'
  | 'removeNode'
  | 'moveNode'
  | 'reorderNode'
  | 'replaceAsset'
  | 'bindToken'
  | 'setLiteral'
  | 'applySystem'
  | 'lock'
  | 'unlock';

export const OPERATION_TYPES: readonly OperationType[] = [
  'setProperty',
  'setText',
  'insertNode',
  'removeNode',
  'moveNode',
  'reorderNode',
  'replaceAsset',
  'bindToken',
  'setLiteral',
  'applySystem',
  'lock',
  'unlock',
];

export const NODE_PROP_KEYS = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'text',
  'fontSize',
  'fontFamily',
  'fontStyle',
  'fill',
  'stroke',
  'strokeWidth',
  'assetId',
  'assetVersion',
  'crop',
  'align',
] as const;

export type NodePropKey = (typeof NODE_PROP_KEYS)[number];

export const GEOMETRY_PROP_KEYS = ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const;

export const NODE_PROP_ALLOWLIST: Record<NodeType, readonly NodePropKey[]> = {
  text: [
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'opacity',
    'text',
    'fontSize',
    'fontFamily',
    'fontStyle',
    'fill',
    'align',
  ],
  rect: ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fill', 'stroke', 'strokeWidth'],
  ellipse: ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'fill', 'stroke', 'strokeWidth'],
  image: ['x', 'y', 'width', 'height', 'rotation', 'opacity', 'assetId', 'assetVersion', 'crop'],
  group: ['x', 'y', 'width', 'height', 'rotation', 'opacity'],
};

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: FontStyle;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  assetId?: string;
  assetVersion?: number;
  crop?: CropRect;
  align?: TextAlign;
}

/**
 * Flat canvas node. `bindings` maps allowlisted property names to pinned-system token roles.
 * List order of `payload.nodes` is z-order. `parentId` must reference a group or be null.
 */
export interface DesignNode {
  id: string;
  type: NodeType;
  parentId: string | null;
  locked: boolean;
  props: NodeProps;
  bindings: Record<string, string>;
}

export interface AssetRef {
  assetId: string;
  version: number;
}

export interface DesignSystemRef {
  id: string;
  version: string;
}

export interface DesignPayload {
  width: number;
  height: number;
  nodes: DesignNode[];
}

/**
 * Canonical canvas document. Extra Mongo metadata belongs in storage, not here.
 */
export interface DesignDocument {
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
}

/**
 * Trusted server context. Never read actor/role from the operation body.
 * For agents, `authorizedNodeIds` is the grant ceiling (fail-closed if omitted).
 */
export interface OperationContext {
  actorId: string;
  role: DesignRole;
  agent: boolean;
  authorizedNodeIds?: string[];
}

export interface DesignOperation {
  type: OperationType;
  nodeId?: string;
  parentId?: string | null;
  property?: string;
  value?: unknown;
  node?: DesignNode;
  assetId?: string;
  assetVersion?: number;
  systemId?: string;
  systemVersion?: string;
  preserveOverrides?: boolean;
}

export interface OperationBatch {
  operationId: string;
  expectedRevision: number;
  declaredScope: string[];
  operations: DesignOperation[];
}

export const DOCUMENT_KEYS = [
  'id',
  'projectId',
  'kind',
  'schemaVersion',
  'title',
  'revision',
  'designSystem',
  'payload',
  'assetRefs',
  'archived',
] as const;

export const NODE_KEYS = ['id', 'type', 'parentId', 'locked', 'props', 'bindings'] as const;

export const OPERATION_KEYS = [
  'type',
  'nodeId',
  'parentId',
  'property',
  'value',
  'node',
  'assetId',
  'assetVersion',
  'systemId',
  'systemVersion',
  'preserveOverrides',
] as const;

export const BATCH_KEYS = [
  'operationId',
  'expectedRevision',
  'declaredScope',
  'operations',
] as const;

export const FORBIDDEN_KEYS = ['__proto__', 'prototype', 'constructor'] as const;

export const FORBIDDEN_BODY_FIELDS = [
  'actor',
  'actorId',
  'ownerId',
  'owner',
  'role',
  'agent',
  'authorizedNodeIds',
  'grantId',
  'authorizedScope',
] as const;
