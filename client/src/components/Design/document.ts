import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  DesignPayload,
  DesignSystemPackage,
  NodePropKey,
  NodeProps,
  NodeType,
  OperationEnvelope,
} from './types';
import {
  GEOMETRY_PROPS,
  MAX_ARTBOARD,
  MAX_NODES,
  MAX_OP_BATCH,
  MIN_ARTBOARD,
  NODE_TYPES,
  TYPE_PROPS,
} from './constants';
import { defaultSystem, getSystemPackage, lookupToken } from './systems';

export class DocumentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function cloneNode(node: DesignNode): DesignNode {
  return {
    id: node.id,
    type: node.type,
    parentId: node.parentId,
    locked: node.locked,
    props: { ...node.props, ...(node.props.crop ? { crop: { ...node.props.crop } } : {}) },
    bindings: { ...node.bindings },
  };
}

export function cloneDocument(doc: DesignDocument): DesignDocument {
  return {
    ...doc,
    designSystem: { ...doc.designSystem },
    assetRefs: doc.assetRefs.map((ref) => ({ ...ref })),
    payload: {
      width: doc.payload.width,
      height: doc.payload.height,
      nodes: doc.payload.nodes.map(cloneNode),
    },
  };
}

export function nodeMap(nodes: DesignNode[]): Map<string, DesignNode> {
  const map = new Map<string, DesignNode>();
  for (const node of nodes) {
    map.set(node.id, node);
  }
  return map;
}

export function allowedProps(type: NodeType): Set<string> {
  return new Set(TYPE_PROPS[type]);
}

export function isAllowedProp(type: NodeType, property: string): property is NodePropKey {
  return allowedProps(type).has(property);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validatePayload(payload: DesignPayload): void {
  if (!isFiniteNumber(payload.width) || !isFiniteNumber(payload.height)) {
    throw new DocumentError('validation', 'Размер холста должен быть конечным числом');
  }
  if (
    payload.width < MIN_ARTBOARD ||
    payload.height < MIN_ARTBOARD ||
    payload.width > MAX_ARTBOARD ||
    payload.height > MAX_ARTBOARD
  ) {
    throw new DocumentError('validation', 'Размер холста вне 64..4096');
  }
  if (payload.nodes.length > MAX_NODES) {
    throw new DocumentError('validation', 'Слишком много узлов');
  }
  const seen = new Set<string>();
  const byId = nodeMap(payload.nodes);
  for (const node of payload.nodes) {
    if (!node.id || seen.has(node.id)) {
      throw new DocumentError('validation', 'Дублирующийся или пустой id узла');
    }
    seen.add(node.id);
    if (!NODE_TYPES.includes(node.type)) {
      throw new DocumentError('validation', 'Недопустимый тип узла: ' + node.type);
    }
    if (node.parentId && !byId.has(node.parentId)) {
      throw new DocumentError('validation', 'Неизвестный parentId: ' + node.parentId);
    }
    for (const key of GEOMETRY_PROPS) {
      if (!isFiniteNumber(node.props[key])) {
        throw new DocumentError('validation', 'Обязательная геометрия: ' + key);
      }
    }
    const allow = allowedProps(node.type);
    for (const key of Object.keys(node.props)) {
      if (!allow.has(key)) {
        throw new DocumentError('validation', 'Недопустимое свойство ' + key);
      }
    }
  }
}

export function isEffectivelyLocked(nodes: DesignNode[], nodeId: string): boolean {
  const byId = nodeMap(nodes);
  let current: string | null = nodeId;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    const node = byId.get(current);
    if (!node) {
      return false;
    }
    if (node.locked) {
      return true;
    }
    current = node.parentId;
  }
  return false;
}

export function descendants(nodes: DesignNode[], rootId: string): string[] {
  const result: string[] = [];
  const byParent = new Map<string | null, DesignNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    const children = byParent.get(id) ?? [];
    for (const child of children) {
      result.push(child.id);
      stack.push(child.id);
    }
  }
  return result;
}

/**
 * Server materializes bound token values into `node.props`.
 * Never overlay catalog tokens here: locked nodes keep frozen literals after applySystem.
 */
export function resolvedProps(node: DesignNode, _system?: DesignSystemPackage): NodeProps {
  return {
    ...node.props,
    crop: node.props.crop ? { ...node.props.crop } : undefined,
  };
}

export function systemFor(
  doc: DesignDocument,
  catalog: DesignSystemPackage[] = [],
): DesignSystemPackage {
  const found =
    catalog.find(
      (item) => item.id === doc.designSystem.id && item.version === doc.designSystem.version,
    ) ?? getSystemPackage(doc.designSystem.id, doc.designSystem.version);
  return found ?? defaultSystem();
}

export function findNode(doc: DesignDocument, nodeId: string | null): DesignNode | undefined {
  if (!nodeId) {
    return undefined;
  }
  return doc.payload.nodes.find((node) => node.id === nodeId);
}

export function collectScope(operations: DesignOperation[]): string[] {
  const scope = new Set<string>();
  for (const op of operations) {
    if (op.nodeId) {
      scope.add(op.nodeId);
    }
    if (op.parentId) {
      scope.add(op.parentId);
    }
    if (op.node?.id) {
      scope.add(op.node.id);
    }
  }
  return [...scope];
}

export function createId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      /* insecure HTTP context */
    }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const n = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? n : (n & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function createEnvelope(
  expectedRevision: number,
  operations: DesignOperation[],
  operationId = createId(),
): OperationEnvelope {
  return {
    operationId,
    expectedRevision,
    declaredScope: collectScope(operations),
    operations,
  };
}

function requireNode(nodes: DesignNode[], nodeId: string | undefined): DesignNode {
  if (!nodeId) {
    throw new DocumentError('validation', 'Нужен nodeId');
  }
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) {
    throw new DocumentError('validation', 'Узел не найден: ' + nodeId);
  }
  return node;
}

function applyTokenToNode(
  node: DesignNode,
  property: string,
  system: DesignSystemPackage,
  role: string,
): void {
  const value = lookupToken(system, role);
  if (value !== undefined) {
    (node.props as unknown as Record<string, unknown>)[property] = value;
  }
  node.bindings[property] = role;
}

export function applyOne(
  doc: DesignDocument,
  op: DesignOperation,
  catalog: DesignSystemPackage[] = [],
): void {
  const nodes = doc.payload.nodes;
  switch (op.type) {
    case 'setProperty':
    case 'setLiteral': {
      const node = requireNode(nodes, op.nodeId);
      if (!op.property || !isAllowedProp(node.type, op.property)) {
        throw new DocumentError('validation', 'Недопустимое свойство');
      }
      (node.props as unknown as Record<string, unknown>)[op.property] = op.value;
      delete node.bindings[op.property];
      return;
    }
    case 'setText': {
      const node = requireNode(nodes, op.nodeId);
      node.props.text = typeof op.value === 'string' ? op.value : '';
      return;
    }
    case 'insertNode': {
      if (!op.node) {
        throw new DocumentError('validation', 'insertNode требует node');
      }
      const nextNode = cloneNode(op.node);
      if (op.parentId !== undefined) {
        nextNode.parentId = op.parentId;
      }
      nodes.push(nextNode);
      return;
    }
    case 'removeNode': {
      const node = requireNode(nodes, op.nodeId);
      const removeIds = new Set([node.id, ...descendants(nodes, node.id)]);
      doc.payload.nodes = nodes.filter((item) => !removeIds.has(item.id));
      return;
    }
    case 'moveNode': {
      const node = requireNode(nodes, op.nodeId);
      node.parentId = op.parentId === undefined ? node.parentId : op.parentId;
      return;
    }
    case 'reorderNode': {
      const index = nodes.findIndex((item) => item.id === op.nodeId);
      if (index < 0) {
        return;
      }
      const [item] = nodes.splice(index, 1);
      const target = typeof op.value === 'number' ? op.value : nodes.length;
      nodes.splice(Math.max(0, Math.min(target, nodes.length)), 0, item);
      return;
    }
    case 'replaceAsset': {
      const node = requireNode(nodes, op.nodeId);
      node.props.assetId = op.assetId;
      node.props.assetVersion = op.assetVersion;
      return;
    }
    case 'bindToken': {
      const node = requireNode(nodes, op.nodeId);
      if (!op.property || typeof op.value !== 'string') {
        throw new DocumentError('validation', 'bindToken требует property и role');
      }
      applyTokenToNode(node, op.property, systemFor(doc, catalog), op.value);
      return;
    }
    case 'applySystem': {
      if (!op.systemId || !op.systemVersion) {
        throw new DocumentError('validation', 'Нужны systemId и version');
      }
      const pack =
        catalog.find((item) => item.id === op.systemId && item.version === op.systemVersion) ??
        getSystemPackage(op.systemId, op.systemVersion);
      if (!pack) {
        throw new DocumentError('validation', 'Неизвестная система оформления');
      }
      const preserve = op.preserveOverrides !== false;
      for (const node of nodes) {
        if (isEffectivelyLocked(nodes, node.id)) {
          node.bindings = {};
          continue;
        }
        const nextBindings: Record<string, string> = {};
        for (const [property, role] of Object.entries(node.bindings)) {
          applyTokenToNode(node, property, pack, role);
          nextBindings[property] = role;
        }
        if (!preserve) {
          const defaults =
            node.type === 'text' || node.type === 'rect' || node.type === 'ellipse'
              ? node.type
              : '';
          if (defaults) {
            const roles = {
              text: {
                fill: 'color.text',
                fontFamily: 'font.family.body',
                fontSize: 'font.size.body',
              },
              rect: { fill: 'color.surface', stroke: 'color.stroke' },
              ellipse: { fill: 'color.surface', stroke: 'color.stroke' },
            }[defaults];
            for (const [property, role] of Object.entries(roles)) {
              if (node.bindings[property]) {
                continue;
              }
              applyTokenToNode(node, property, pack, role);
              nextBindings[property] = role;
            }
          }
        }
        node.bindings = { ...node.bindings, ...nextBindings };
      }
      doc.designSystem = { id: op.systemId, version: op.systemVersion };
      return;
    }
    case 'lock':
      requireNode(nodes, op.nodeId).locked = true;
      return;
    case 'unlock':
      requireNode(nodes, op.nodeId).locked = false;
      return;
    default:
      return;
  }
}

export function applyOperations(
  doc: DesignDocument,
  envelope: OperationEnvelope,
  catalog: DesignSystemPackage[] = [],
): DesignDocument {
  if (envelope.operations.length === 0) {
    throw new DocumentError('validation', 'Пустой пакет операций');
  }
  if (envelope.operations.length > MAX_OP_BATCH) {
    throw new DocumentError('validation', 'Пакет больше 200 операций');
  }
  const next = cloneDocument(doc);
  for (const op of envelope.operations) {
    applyOne(next, op, catalog);
  }
  validatePayload(next.payload);
  next.revision = doc.revision;
  return next;
}

export function blankPayload(
  system: DesignSystemPackage,
  width = 1080,
  height = 1350,
): DesignPayload {
  const fill = lookupToken(system, 'color.background');
  return {
    width,
    height,
    nodes: [
      {
        id: createId(),
        type: 'rect',
        parentId: null,
        locked: false,
        props: {
          x: 0,
          y: 0,
          width,
          height,
          rotation: 0,
          opacity: 1,
          fill: typeof fill === 'string' ? fill : '#F7F7F5',
        },
        bindings: { fill: 'color.background' },
      },
    ],
  };
}
