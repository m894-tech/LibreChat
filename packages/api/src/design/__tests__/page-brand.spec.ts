import { applyPageOperations } from '../page-document';
import { buildPageBrandPatch } from '../page-brand';
it('materializes published brand colors and skips protected content', () => {
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
        props: { direction: 'column', gap: 10, padding: 20, background: '#FFFFFF' },
      },
      {
        id: 't',
        type: 'text',
        parentId: 'r',
        locked: false,
        props: { text: 'Text', size: 20, color: '#000000', weight: 400 },
      },
    ],
  };
  const brand = {
    id: 'team-brand',
    version: '1.0.0',
    name: 'Team',
    baseSystemId: 'neutral-business',
    baseSystemVersion: '1.0.0',
    tokens: { 'color.text': { type: 'color', value: '#FF2200', properties: ['fill'] } },
    fonts: [],
    designNotes: 'Brand snapshot',
  };
  const patch = buildPageBrandPatch(doc, brand);
  const next = applyPageOperations(doc, patch.operations, {
    actorId: 'u',
    role: 'editor',
    agent: false,
    scopeIds: ['r', 't'],
  });
  expect((next.nodes[1].props as any).color).toBe('#FF2200');
  expect(patch.mode).toBe('materialized-values');
  doc.nodes[1].locked = true;
  expect(buildPageBrandPatch(doc, brand).operations).toHaveLength(0);
});
