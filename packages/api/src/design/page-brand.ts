import { validatePageDocument, type PageDocument, type PageOperation } from './page-document';
import { materializeBrandSystem } from './brand-package';
/** Snapshot adapter only. Brand metadata retained by registry, page values explicitly materialized. */
export function buildPageBrandPatch(
  doc: PageDocument,
  brand: unknown,
): { mode: 'materialized-values'; operations: PageOperation[] } {
  validatePageDocument(doc);
  const system = materializeBrandSystem(brand);
  const locked = (id: string): boolean => {
    let n = doc.nodes.find((x) => x.id === id);
    while (n) {
      if (n.locked) return true;
      n = doc.nodes.find((x) => x.id === n!.parentId);
    }
    return false;
  };
  const hasLockedChild = (id: string) =>
    doc.nodes.some((n) => {
      if (!locked(n.id)) return false;
      let x: typeof n | undefined = n;
      while (x) {
        if (x.parentId === id) return true;
        x = doc.nodes.find((t) => t.id === x!.parentId);
      }
      return false;
    });
  const operations: PageOperation[] = [];
  for (const n of doc.nodes) {
    if (locked(n.id)) continue;
    if (n.type === 'text')
      operations.push({
        type: 'setProperty',
        nodeId: n.id,
        property: 'color',
        value: String(system.tokens['color.text'].value),
      });
    else if ((n.type === 'section' || n.type === 'stack') && !hasLockedChild(n.id))
      operations.push({
        type: 'setProperty',
        nodeId: n.id,
        property: 'background',
        value: String(system.tokens[n.parentId ? 'color.surface' : 'color.background'].value),
      });
  }
  return { mode: 'materialized-values', operations };
}
