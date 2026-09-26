import { cloneNode, blankPayload, applyOperations, createEnvelope } from '../document';
import { createNode, insertNodeOps } from '../operations';
import { R1_SYSTEMS } from '../systems';
describe('canonical UI payload regressions', () => {
  it('does not add undefined crop to text clone', () => {
    const node = createNode('text', R1_SYSTEMS[0]);
    expect(Object.hasOwn(cloneNode(node).props, 'crop')).toBe(false);
  });
  it('creates and edits a text node with canonical props', () => {
    const doc: any = {
      id: 'd1',
      projectId: 'p1',
      kind: 'canvas',
      schemaVersion: 1,
      title: 'Fixture',
      revision: 1,
      designSystem: { id: 'neutral-business', version: '1.0.0' },
      payload: blankPayload(R1_SYSTEMS[0]),
      assetRefs: [],
      archived: false,
    };
    const node = createNode('text', R1_SYSTEMS[0]);
    const next = applyOperations(doc, createEnvelope(1, insertNodeOps(node)), R1_SYSTEMS);
    expect(next.payload.nodes).toHaveLength(2);
    expect(doc.payload.nodes).toHaveLength(1);
    expect(next.payload.nodes[1].props.rotation).toBe(0);
  });
});
