import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  DesignSystemPackage,
  NodeProps,
  NodeType,
  OperationEnvelope,
} from './types';
import { createEnvelope, createId } from './document';
import { DEFAULT_TOKEN_ROLES } from './constants';
import { lookupToken } from './systems';

const DEFAULT_GEOMETRY = { rotation: 0, opacity: 1 };

const SIZE: Record<NodeType, Pick<NodeProps, 'x' | 'y' | 'width' | 'height'>> = {
  rect: { x: 80, y: 80, width: 240, height: 160 },
  ellipse: { x: 120, y: 120, width: 180, height: 180 },
  text: { x: 80, y: 80, width: 480, height: 80 },
  image: { x: 80, y: 80, width: 320, height: 320 },
  group: { x: 80, y: 80, width: 400, height: 300 },
};

export function materializeDefaults(
  type: NodeType,
  system: DesignSystemPackage,
): { props: NodeProps; bindings: Record<string, string> } {
  const bindings: Record<string, string> = { ...(DEFAULT_TOKEN_ROLES[type] ?? {}) };
  const props: NodeProps = {
    ...SIZE[type],
    ...DEFAULT_GEOMETRY,
  };
  if (type === 'text') {
    props.text = 'Текст';
    props.align = 'left';
    props.fontStyle = 'normal';
    props.fontFamily = 'Inter';
  }
  if (type === 'rect' || type === 'ellipse') {
    props.strokeWidth = 1;
  }
  for (const [property, role] of Object.entries(bindings)) {
    const value = lookupToken(system, role);
    if (value !== undefined) {
      (props as unknown as Record<string, unknown>)[property] = value;
    }
  }
  if (type === 'text' && typeof props.fontFamily !== 'string') {
    props.fontFamily = system.fonts?.[0] ?? 'Inter';
  }
  return { props, bindings };
}

export function createNode(
  type: NodeType,
  system: DesignSystemPackage,
  parentId: string | null = null,
): DesignNode {
  const { props, bindings } = materializeDefaults(type, system);
  return {
    id: createId(),
    type,
    parentId,
    locked: false,
    props,
    bindings,
  };
}

export function insertNodeOps(node: DesignNode): DesignOperation[] {
  return [{ type: 'insertNode', node, parentId: node.parentId, nodeId: node.id }];
}

export function setTextOps(nodeId: string, text: string): DesignOperation[] {
  return [{ type: 'setText', nodeId, value: text }];
}

export function setPropertyOps(
  nodeId: string,
  property: string,
  value: unknown,
): DesignOperation[] {
  return [{ type: 'setProperty', nodeId, property, value }];
}

export function dragOps(nodeId: string, x: number, y: number): DesignOperation[] {
  return [
    { type: 'setProperty', nodeId, property: 'x', value: x },
    { type: 'setProperty', nodeId, property: 'y', value: y },
  ];
}

export function lockOps(nodeId: string, locked: boolean): DesignOperation[] {
  return [{ type: locked ? 'lock' : 'unlock', nodeId }];
}

export function removeOps(nodeId: string): DesignOperation[] {
  return [{ type: 'removeNode', nodeId }];
}

export function applySystemOps(
  systemId: string,
  systemVersion: string,
  preserveOverrides: boolean,
): DesignOperation[] {
  return [{ type: 'applySystem', systemId, systemVersion, preserveOverrides }];
}

export function bindTokenOps(nodeId: string, property: string, role: string): DesignOperation[] {
  return [{ type: 'bindToken', nodeId, property, value: role }];
}

export function replaceAssetOps(
  nodeId: string,
  assetId: string,
  assetVersion: number,
): DesignOperation[] {
  return [{ type: 'replaceAsset', nodeId, assetId, assetVersion }];
}

export function envelopeFor(doc: DesignDocument, operations: DesignOperation[]): OperationEnvelope {
  return createEnvelope(doc.revision, operations);
}
