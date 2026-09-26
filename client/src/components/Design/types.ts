export type NodeType = 'text' | 'rect' | 'ellipse' | 'image' | 'group';

export type DesignRole = 'owner' | 'editor' | 'viewer';

export type FontStyle = 'normal' | 'italic' | 'bold' | 'bold-italic';

export type TextAlign = 'left' | 'center' | 'right';

export type TokenValueType = 'color' | 'fontFamily' | 'fontSize';

export type BindableProperty = 'fill' | 'stroke' | 'fontFamily' | 'fontSize';

export type NodePropKey =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'rotation'
  | 'opacity'
  | 'text'
  | 'fontSize'
  | 'fontFamily'
  | 'fontStyle'
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  | 'assetId'
  | 'assetVersion'
  | 'crop'
  | 'align';

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

export interface DesignProject {
  id: string;
  name: string;
  ownerId: string;
  members: Record<string, DesignRole>;
  archived: boolean;
}

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

export interface OperationEnvelope {
  operationId: string;
  expectedRevision: number;
  declaredScope: string[];
  operations: DesignOperation[];
}

export interface DesignToken {
  role: string;
  type: TokenValueType;
  value: string | number;
  properties: readonly BindableProperty[];
}

export interface DesignSystemPackage {
  id: string;
  version: string;
  name: string;
  tokens: Record<string, DesignToken | { value: string | number }>;
  fonts?: readonly string[];
}

export interface DesignProposal {
  id: string;
  documentId: string;
  baseRevision: number;
  declaredScope?: string[];
  scope?: string[];
  operations: DesignOperation[];
  authorId?: string;
  author?: string;
  summary: string;
  status: 'pending' | 'applied' | 'rejected' | 'stale';
}

export interface DesignCapabilities {
  presentationSend?: boolean;
  inpaint?: boolean;
  documentDraft?: boolean;
  textPrompt: boolean;
  textProposal: boolean;
  imageUpload: boolean;
  imageGenerate: boolean;
  imageGeneration: boolean;
  exports: string[];
  proposals: boolean;
  restore: boolean;
  source: 'server' | 'unavailable';
  reason?: string;
}

export interface HttpErrorBody {
  code?: string;
  message?: string;
  revision?: number;
}

export interface DesignError {
  status: number;
  code: string;
  message: string;
  revision?: number;
}

export interface SaveState {
  status: 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';
  message: string;
  remoteRevision: number | null;
}
