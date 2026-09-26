import type { DesignDocument, DesignNode } from './types';
import { isEffectivelyLocked, nodeMap } from './document';
import { LABELS, NODE_TYPE_LABELS } from './constants';

interface LayersProps {
  document: DesignDocument;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function depth(nodes: DesignNode[], node: DesignNode): number {
  const byId = nodeMap(nodes);
  let current: string | null = node.parentId;
  let level = 0;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    level += 1;
    current = byId.get(current)?.parentId ?? null;
  }
  return level;
}

export default function LayersPanel({ document: doc, selectedId, onSelect }: LayersProps) {
  const ordered = [...doc.payload.nodes].reverse();
  return (
    <div className="design-layers" data-testid="design-layers">
      <h2>{LABELS.layers}</h2>
      <ul>
        {ordered.map((node) => {
          const selected = selectedId === node.id;
          const locked = isEffectivelyLocked(doc.payload.nodes, node.id);
          return (
            <li key={node.id} style={{ paddingLeft: depth(doc.payload.nodes, node) * 12 }}>
              <button
                type="button"
                data-testid={`design-layer-${node.id}`}
                aria-pressed={selected}
                aria-label={NODE_TYPE_LABELS[node.type]}
                className={selected ? 'is-selected' : ''}
                onClick={() => onSelect(node.id)}
              >
                <span>
                  {NODE_TYPE_LABELS[node.type]} {node.id.slice(0, 6)}
                </span>
                <span>{locked ? '🔒' : node.type}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
