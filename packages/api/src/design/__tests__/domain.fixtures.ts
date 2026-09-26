import type {
  DesignDocument,
  DesignNode,
  NodeProps,
  NodeType,
  OperationBatch,
  OperationContext,
  OperationType,
} from '../types';

export const editorContext: OperationContext = {
  actorId: 'user-editor',
  role: 'editor',
  agent: false,
};

export const ownerContext: OperationContext = {
  actorId: 'user-owner',
  role: 'owner',
  agent: false,
};

export const viewerContext: OperationContext = {
  actorId: 'user-viewer',
  role: 'viewer',
  agent: false,
};

export const agentContext = (nodeIds: string[]): OperationContext => ({
  actorId: 'agent-1',
  role: 'editor',
  agent: true,
  authorizedNodeIds: nodeIds,
});

export function geometry(over: Partial<NodeProps> = {}): NodeProps {
  return {
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    rotation: 0,
    opacity: 1,
    ...over,
  };
}

export function makeNode(over: Partial<DesignNode> & { type?: NodeType } = {}): DesignNode {
  const type = over.type ?? 'rect';
  const baseProps = geometry(over.props);
  if (type === 'text' && baseProps.text === undefined) {
    baseProps.text = 'Hello';
    baseProps.fill = '#1A1A1A';
    baseProps.fontFamily = 'Inter';
    baseProps.fontSize = 14;
  }
  if ((type === 'rect' || type === 'ellipse') && baseProps.fill === undefined) {
    baseProps.fill = '#FFFFFF';
  }
  return {
    id: over.id ?? 'n1',
    type,
    parentId: over.parentId ?? null,
    locked: over.locked ?? false,
    props: baseProps,
    bindings: over.bindings ? { ...over.bindings } : {},
  };
}

export function makeDoc(over: Partial<DesignDocument> = {}): DesignDocument {
  const nodes = over.payload?.nodes ?? [makeNode({ id: 'n1' })];
  return {
    id: 'doc1',
    projectId: 'proj1',
    kind: 'canvas',
    schemaVersion: 1,
    title: 'Retail card',
    revision: 3,
    designSystem: over.designSystem ?? { id: 'neutral-business', version: '1.0.0' },
    payload: {
      width: over.payload?.width ?? 1080,
      height: over.payload?.height ?? 1080,
      nodes,
    },
    assetRefs: over.assetRefs ?? [],
    archived: over.archived ?? false,
    ...omit(over, ['payload', 'designSystem', 'assetRefs', 'archived']),
  };
}

function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const next = { ...obj };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

export function batch(
  operations: Array<{ type: OperationType } & Record<string, unknown>>,
  over: Partial<OperationBatch> = {},
): OperationBatch {
  return {
    operationId: over.operationId ?? 'op-1',
    expectedRevision: over.expectedRevision ?? 3,
    declaredScope: over.declaredScope ?? ['n1'],
    operations: operations as OperationBatch['operations'],
  };
}

export function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('domain fixtures', () => {
  it('builds a canvas document', () => {
    expect(makeDoc().kind).toBe('canvas');
    expect(makeNode({ id: 't', type: 'text' }).type).toBe('text');
  });
});
