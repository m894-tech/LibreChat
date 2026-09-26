import { validatePageDocument, type PageDocument, type PageOperation } from './page-document';
import { DesignError } from './errors';
import { getSystem } from './systems';
export interface PageSystemPatch {
  id: string;
  version: string;
  mode: 'materialized-values';
  operations: PageOperation[];
}
/** Explicit page adapter: values materialized; does not claim live tokens in page schema. */
export function buildPageSystemPatch(
  doc: PageDocument,
  id: string,
  version: string,
): PageSystemPatch {
  validatePageDocument(doc);
  const system = getSystem(id, version);
  if (!system) throw new DesignError(422, 'page_system', 'Unknown design system');
  const isLocked = (nodeId: string): boolean => {
    let n = doc.nodes.find((x) => x.id === nodeId);
    while (n) {
      if (n.locked) return true;
      n = doc.nodes.find((x) => x.id === n!.parentId);
    }
    return false;
  };
  const operations: PageOperation[] = [];
  for (const node of doc.nodes) {
    if (isLocked(node.id)) continue;
    if (node.type === 'text') {
      operations.push({
        type: 'setProperty',
        nodeId: node.id,
        property: 'color',
        value: String(system.tokens['color.text'].value),
      });
    }
    if (node.type === 'section' || node.type === 'stack') {
      // Background/layout of parent can affect protected children; skip entire container.
      const hasLocked = doc.nodes.some((child) => {
        if (!isLocked(child.id)) return false;
        let n: typeof child | undefined = child;
        while (n) {
          if (n.parentId === node.id) return true;
          n = doc.nodes.find((x) => x.id === n!.parentId);
        }
        return false;
      });
      if (!hasLocked)
        operations.push({
          type: 'setProperty',
          nodeId: node.id,
          property: 'background',
          value: String(
            system.tokens[node.parentId === null ? 'color.background' : 'color.surface'].value,
          ),
        });
    }
  }
  return { id, version, mode: 'materialized-values', operations };
}
