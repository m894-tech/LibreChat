import { exportPageHTML } from '../page-export';
it('exports escaped native text and responsive registered components without scripts', async () => {
  const doc = {
    kind: 'web',
    schemaVersion: 1,
    title: '<x>',
    viewport: { desktop: 1024, mobile: 375 },
    assetRefs: [],
    nodes: [
      {
        id: 'root',
        parentId: null,
        type: 'section',
        locked: false,
        props: {
          direction: 'row',
          mobileDirection: 'column',
          gap: 10,
          padding: 20,
          background: '#FFFFFF',
        },
      },
      {
        id: 't',
        parentId: 'root',
        type: 'text',
        locked: false,
        props: { text: '<script>alert(1)</script>', size: 20, weight: 400, color: '#000000' },
      },
    ],
  };
  const html = await exportPageHTML(doc, {
    loadAsset: async () => {
      throw Error('no assets');
    },
  });
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('@media(max-width:375px)');
  expect(html).toContain("default-src 'none'");
});

it('refuses unsafe CSS and URL values before HTML construction', async () => {
  const root = {
    id: 'r',
    type: 'section',
    parentId: null,
    locked: false,
    props: { direction: 'column', gap: 10, padding: 20, background: '#FFFFFF' },
  };
  const doc: any = {
    kind: 'web',
    schemaVersion: 1,
    title: 'x',
    viewport: { desktop: 1024, mobile: 375 },
    assetRefs: [],
    nodes: [
      root,
      {
        id: 'b',
        type: 'button',
        parentId: 'r',
        locked: false,
        props: { label: 'Click', href: 'javascript:alert(1)' },
      },
    ],
  };
  await expect(
    exportPageHTML(doc, {
      loadAsset: async () => {
        throw Error('no');
      },
    }),
  ).rejects.toThrow();
  doc.nodes = [{ ...root, props: { ...root.props, background: 'red;}</style><script>' } }];
  await expect(
    exportPageHTML(doc, {
      loadAsset: async () => {
        throw Error('no');
      },
    }),
  ).rejects.toThrow();
});
