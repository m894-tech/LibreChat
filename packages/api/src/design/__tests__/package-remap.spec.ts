import { remapPackageSource } from '../package-remap';
const source = () => ({
  documentId: 'old-doc',
  revision: 1,
  format: 'source',
  projectId: 'old-project',
  snapshot: {
    title: 'Изображение',
    kind: 'canvas',
    schemaVersion: 1,
    designSystem: { id: 'neutral-business', version: '1.0.0' },
    assetRefs: [{ assetId: 'old-asset', version: 1 }],
    payload: {
      width: 100,
      height: 100,
      nodes: [
        {
          id: 'image',
          type: 'image',
          parentId: null,
          locked: false,
          props: {
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            opacity: 1,
            assetId: 'old-asset',
            assetVersion: 1,
          },
          bindings: {},
        },
      ],
    },
  },
});
it('rewrites every image and ref using fresh IDs without mutating source', () => {
  const s = source();
  const r = remapPackageSource(s, 'new-project', [
    { originalId: 'old-asset', originalVersion: 1, assetId: 'new-asset', version: 1 },
  ]);
  expect(r.document.assetRefs).toEqual([{ assetId: 'new-asset', version: 1 }]);
  expect(r.document.payload.nodes[0].props.assetId).toBe('new-asset');
  expect(s.snapshot.payload.nodes[0].props.assetId).toBe('old-asset');
});
it('rejects missing and duplicate asset maps', () => {
  expect(() => remapPackageSource(source(), 'new-project', [])).toThrow();
  expect(() =>
    remapPackageSource(source(), 'new-project', [
      { originalId: 'old-asset', originalVersion: 1, assetId: 'new', version: 1 },
      { originalId: 'old-asset', originalVersion: 1, assetId: 'other', version: 1 },
    ]),
  ).toThrow();
});
