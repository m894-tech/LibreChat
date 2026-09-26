import { validatePageDocument, applyPageOperations, assertSafePageHref } from '../page-document';

const doc = (): any => ({
  kind: 'web',
  schemaVersion: 1,
  title: 'Страница R3 — Кириллица',
  viewport: { desktop: 1024, mobile: 375 },
  assetRefs: [],
  nodes: [
    {
      id: 'root',
      type: 'section',
      parentId: null,
      locked: false,
      props: {
        direction: 'row',
        mobileDirection: 'column',
        padding: 20,
        gap: 12,
        background: '#FFFFFF',
      },
    },
    {
      id: 't',
      type: 'text',
      parentId: 'root',
      locked: false,
      props: { text: 'Привет мир — тест кириллицы', size: 32, color: '#000000', weight: 600 },
    },
  ],
});

it('validates nested registered page and edits without mutation', () => {
  const d = doc();
  validatePageDocument(d);
  const result = applyPageOperations(d, [{ type: 'setText', nodeId: 't', value: 'Changed' }], {
    actorId: 'u',
    role: 'editor',
    agent: false,
    scopeIds: ['t'],
  });
  expect((result.nodes[1].props as any).text).toBe('Changed');
  expect(d.nodes[1].props.text).toBe('Привет мир — тест кириллицы');
});

it('rejects cycles and locked descendant deletion', () => {
  const d = doc();
  d.nodes[0].parentId = 't';
  expect(() => validatePageDocument(d)).toThrow();
  const locked = doc();
  locked.nodes[1].locked = true;
  expect(() =>
    applyPageOperations(locked, [{ type: 'removeNode', nodeId: 'root' }], {
      actorId: 'u',
      role: 'editor',
      agent: false,
      scopeIds: ['root', 't'],
    }),
  ).toThrow();
});

it('rejects script URLs, arbitrary props, agent scope widening', () => {
  for (const url of ['javascript:alert(1)', '//evil.org', 'data:text/html,x'])
    expect(() => assertSafePageHref(url)).toThrow();
  const d = doc();
  expect(() =>
    applyPageOperations(
      d,
      [{ type: 'setProperty', nodeId: 't', property: 'innerHTML', value: '<script>' }],
      { actorId: 'u', role: 'editor', agent: false, scopeIds: ['t'] },
    ),
  ).toThrow();
  expect(() =>
    applyPageOperations(d, [{ type: 'setText', nodeId: 't', value: 'X' }], {
      actorId: 'u',
      role: 'editor',
      agent: true,
      scopeIds: ['t'],
      authorizedNodeIds: ['root'],
    }),
  ).toThrow();
});

it('rejects container layout changes affecting locked or out-of-scope descendants', () => {
  const d = doc();
  d.nodes[1].locked = true;
  expect(() =>
    applyPageOperations(
      d,
      [{ type: 'setProperty', nodeId: 'root', property: 'padding', value: 30 }],
      { actorId: 'u', role: 'editor', agent: false, scopeIds: ['root', 't'] },
    ),
  ).toThrow();
  const d2 = doc();
  expect(() =>
    applyPageOperations(
      d2,
      [{ type: 'setProperty', nodeId: 'root', property: 'direction', value: 'column' }],
      {
        actorId: 'u',
        role: 'editor',
        agent: true,
        scopeIds: ['root'],
        authorizedNodeIds: ['root'],
      },
    ),
  ).toThrow();
});

it('manual lock/unlock explicit; agent cannot grant itself unlock', () => {
  const d = doc();
  const locked = applyPageOperations(d, [{ type: 'lock', nodeId: 't' }], {
    actorId: 'u',
    role: 'editor',
    agent: false,
    scopeIds: ['t'],
  });
  expect(locked.nodes[1].locked).toBe(true);
  expect(() =>
    applyPageOperations(locked, [{ type: 'unlock', nodeId: 't' }], {
      actorId: 'u',
      role: 'editor',
      agent: true,
      scopeIds: ['t'],
      authorizedNodeIds: ['t'],
    }),
  ).toThrow();
  const next = applyPageOperations(locked, [{ type: 'unlock', nodeId: 't' }], {
    actorId: 'u',
    role: 'editor',
    agent: false,
    scopeIds: ['t'],
  });
  expect(next.nodes[1].locked).toBe(false);
});

it('registered data nodes retain provenance and reject fake live data flag', () => {
  const d = doc();
  d.nodes.push({
    id: 'table',
    type: 'table',
    parentId: 'root',
    locked: false,
    props: {
      kind: 'table',
      source: 'example',
      caption: 'Пример',
      columns: ['Label', 'Value'],
      rows: [['A', 10]],
    },
  });
  validatePageDocument(d);
  d.nodes[2].props.source = 'live';
  expect(() => validatePageDocument(d)).toThrow();
});
