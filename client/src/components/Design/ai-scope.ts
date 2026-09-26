import type { DesignDocument } from './types';
import { descendants } from './document';
export type AIScopeMode = 'element' | 'group' | 'document';
/** UI-selected scope: never expanded by model output. Backend still validates grant. */
export function resolveAIScope(
  doc: DesignDocument,
  selectedId: string | null,
  mode: AIScopeMode,
): string[] {
  if (mode === 'document') return doc.payload.nodes.map((n) => n.id);
  const node = doc.payload.nodes.find((n) => n.id === selectedId);
  if (!node) return [];
  if (mode === 'element') return [node.id];
  const group =
    node.type === 'group'
      ? node
      : doc.payload.nodes.find((n) => n.id === node.parentId && n.type === 'group');
  return group ? [group.id, ...descendants(doc.payload.nodes, group.id)] : [];
}
