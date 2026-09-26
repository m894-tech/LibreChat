import { createGenerationDraft } from '../generation-draft';
const node = (id: string, parentId: string | null = null, type: any = 'text'): any => ({
  id,
  type,
  parentId,
  locked: false,
  props: {
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    opacity: 1,
    ...(type === 'text'
      ? { text: 'Текст Йошкар-Ола', fontFamily: 'Inter', fontSize: 16, fill: '#000000' }
      : {}),
  },
  bindings: {},
});
const base = (): any => ({
  id: 'base',
  projectId: 'project',
  kind: 'canvas',
  schemaVersion: 1,
  title: 'Draft',
  revision: 1,
  designSystem: { id: 'neutral-business', version: '1.0.0' },
  payload: { width: 1080, height: 1080, nodes: [node('existing')] },
  assetRefs: [],
  archived: false,
});
const line = (n: any) => JSON.stringify({ type: 'insertNode', node: n }) + '\n';
it('renders only complete valid lines, leaves base unchanged and previous valid block intact', () => {
  const d = base(),
    g = createGenerationDraft(d, {
      actorId: 'u',
      role: 'editor',
      agent: true,
      authorizedNodeIds: ['existing'],
    });
  const text = line(node('new'));
  expect(g.append(text.slice(0, 20)).accepted).toBe(0);
  expect(g.append(text.slice(20)).accepted).toBe(1);
  const result = g.append('not-json\n');
  expect(result.rejected).toBe(1);
  expect(result.document.payload.nodes).toHaveLength(2);
  expect(d.payload.nodes).toHaveLength(1);
});
it('never expands limited base grant, even caller sets agent false', () => {
  const d = base();
  d.payload.nodes.push(node('group', null, 'group'));
  const g = createGenerationDraft(d, {
    actorId: 'u',
    role: 'editor',
    agent: false,
    authorizedNodeIds: ['group'],
  });
  expect(g.append(line(node('outside'))).accepted).toBe(0);
  expect(g.append(line(node('inside', 'group'))).accepted).toBe(1);
});
it('does not apply caller mutations to saved grant and does not unlock protected parent', () => {
  const d = base();
  d.payload.nodes.push({ ...node('g', null, 'group'), locked: true });
  const ctx: any = {
    actorId: 'u',
    role: 'editor',
    agent: true,
    authorizedNodeIds: ['existing', 'g'],
  };
  const g = createGenerationDraft(d, ctx);
  ctx.authorizedNodeIds.push('injected');
  expect(g.append(line(node('child', 'g'))).accepted).toBe(0);
});
it('allows subsequent root blocks only through base+created grant, rejects duplicate', () => {
  const g = createGenerationDraft(base(), {
    actorId: 'u',
    role: 'editor',
    agent: true,
    authorizedNodeIds: ['existing'],
  });
  expect(g.append(line(node('one')) + line(node('two'))).accepted).toBe(2);
  expect(g.append(line(node('one'))).rejected).toBe(1);
});
it('rejects unknown image asset refs and oversized incomplete line', () => {
  const g = createGenerationDraft(base(), {
    actorId: 'u',
    role: 'editor',
    agent: true,
    authorizedNodeIds: ['existing'],
  });
  const n = node('image', null, 'image');
  Object.assign(n.props, { assetId: 'unknown', assetVersion: 1 });
  expect(g.append(line(n)).accepted).toBe(0);
  expect(() => g.append('x'.repeat(65537))).toThrow();
});
