import { applyPageOperations } from '../page-document';
import { buildPageSystemPatch } from '../page-system';
it('applies registered system colors as explicit literals and respects locked subtree', () => {
  const doc: any = {
    kind: 'web',
    schemaVersion: 1,
    title: 'Page',
    viewport: { desktop: 1024, mobile: 375 },
    assetRefs: [],
    nodes: [
      {
        id: 'r',
        type: 'section',
        parentId: null,
        locked: false,
        props: { direction: 'column', gap: 12, padding: 20, background: '#FFFFFF' },
      },
      {
        id: 't',
        type: 'text',
        parentId: 'r',
        locked: false,
        props: { text: 'Текст', size: 20, color: '#000000', weight: 400 },
      },
    ],
  };
  const patch = buildPageSystemPatch(doc, 'data-analytics', '1.0.0');
  expect(patch.mode).toBe('materialized-values');
  const next = applyPageOperations(doc, patch.operations, {
    actorId: 'u',
    role: 'editor',
    agent: false,
    scopeIds: ['r', 't'],
  });
  expect((next.nodes[1].props as any).color).toBe('#F8FAFC');
  doc.nodes[1].locked = true;
  expect(buildPageSystemPatch(doc, 'data-analytics', '1.0.0').operations).toHaveLength(0);
});
