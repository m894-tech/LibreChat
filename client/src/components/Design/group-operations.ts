import type { DesignDocument, DesignOperation, DesignSystemPackage } from './types';
import { descendants, isEffectivelyLocked, createId } from './document';
import { createNode } from './operations';
export function manualScope(doc: DesignDocument, ops: DesignOperation[]): string[] {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.nodeId) {
      ids.add(op.nodeId);
      for (const id of descendants(doc.payload.nodes, op.nodeId)) ids.add(id);
    }
    if (op.parentId) ids.add(op.parentId);
    if (op.node) ids.add(op.node.id);
    if (op.type === 'applySystem') doc.payload.nodes.forEach((n) => ids.add(n.id));
  }
  return [...ids];
}
export function wrapInGroup(
  doc: DesignDocument,
  nodeId: string,
  system: DesignSystemPackage,
): DesignOperation[] {
  const node = doc.payload.nodes.find((n) => n.id === nodeId);
  if (
    !node ||
    isEffectivelyLocked(doc.payload.nodes, nodeId) ||
    descendants(doc.payload.nodes, nodeId).some((id) => isEffectivelyLocked(doc.payload.nodes, id))
  )
    throw Error('Элемент заблокирован или отсутствует');
  const group = createNode('group', system, node.parentId);
  group.id = createId();
  Object.assign(group.props, { x: 0, y: 0, width: doc.payload.width, height: doc.payload.height });
  return [
    { type: 'insertNode', node: group },
    { type: 'moveNode', nodeId, parentId: group.id },
  ];
}
export function ungroup(doc: DesignDocument, nodeId: string): DesignOperation[] {
  const group = doc.payload.nodes.find((n) => n.id === nodeId);
  if (!group || group.type !== 'group') throw Error('Выберите группу');
  if (
    isEffectivelyLocked(doc.payload.nodes, nodeId) ||
    descendants(doc.payload.nodes, nodeId).some((id) => isEffectivelyLocked(doc.payload.nodes, id))
  )
    throw Error('Группа содержит заблокированные элементы');
  if (group.props.rotation !== 0 || group.props.opacity !== 1)
    throw Error('Сначала верните поворот группы в 0 и прозрачность в 1');
  const ops: DesignOperation[] = [];
  for (const child of doc.payload.nodes.filter((n) => n.parentId === nodeId)) {
    ops.push(
      { type: 'moveNode', nodeId: child.id, parentId: group.parentId },
      {
        type: 'setProperty',
        nodeId: child.id,
        property: 'x',
        value: child.props.x + group.props.x,
      },
      {
        type: 'setProperty',
        nodeId: child.id,
        property: 'y',
        value: child.props.y + group.props.y,
      },
    );
  }
  ops.push({ type: 'removeNode', nodeId });
  return ops;
}
