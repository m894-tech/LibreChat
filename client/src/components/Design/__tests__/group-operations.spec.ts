import { wrapInGroup, ungroup, manualScope } from '../group-operations';
import { applyOperations, createEnvelope } from '../document';
import { templatePayload } from '../templates';
import { R1_SYSTEMS } from '../systems';
const document = (): any => ({
  id: 'd1',
  projectId: 'p1',
  kind: 'canvas',
  schemaVersion: 1,
  title: 'Fixture',
  revision: 1,
  designSystem: { id: 'neutral-business', version: '1.0.0' },
  payload: templatePayload(R1_SYSTEMS[0], 'business'),
  assetRefs: [],
  archived: false,
});
it('wraps and ungroups without changing node position or text', () => {
  const d = document();
  const id = d.payload.nodes[1].id;
  const initial = d.payload.nodes[1];
  const ops = wrapInGroup(d, id, R1_SYSTEMS[0]);
  const next = applyOperations(d, createEnvelope(1, ops), R1_SYSTEMS);
  const group = next.payload.nodes.find((n) => n.type === 'group')!;
  const back = applyOperations(next, createEnvelope(1, ungroup(next, group.id)), R1_SYSTEMS);
  expect(back.payload.nodes.find((n) => n.id === id)).toEqual(initial);
});
it('includes descendants for actual manual group scope', () => {
  const d = document();
  const ops = wrapInGroup(d, d.payload.nodes[1].id, R1_SYSTEMS[0]);
  const next = applyOperations(d, createEnvelope(1, ops), R1_SYSTEMS);
  const group = next.payload.nodes.find((n) => n.type === 'group')!;
  expect(manualScope(next, [{ type: 'removeNode', nodeId: group.id }])).toContain(
    d.payload.nodes[1].id,
  );
});
it('rejects locked group and rotated ungroup without loss', () => {
  const d = document();
  const next = applyOperations(
    d,
    createEnvelope(1, wrapInGroup(d, d.payload.nodes[1].id, R1_SYSTEMS[0])),
    R1_SYSTEMS,
  );
  const g = next.payload.nodes.find((n) => n.type === 'group')!;
  g.props.rotation = 10;
  expect(() => ungroup(next, g.id)).toThrow();
  g.props.rotation = 0;
  g.locked = true;
  expect(() => ungroup(next, g.id)).toThrow();
});
it.each(['neutral-business', 'data-analytics', 'retail-promo'])(
  'registered templates have exact canonical props in %s',
  (id) => {
    const sys = R1_SYSTEMS.find((x) => x.id === id)!;
    for (const t of ['promo', 'business', 'analytics'] as const) {
      const p = templatePayload(sys, t);
      expect(p.nodes.length).toBeGreaterThan(3);
      for (const n of p.nodes) {
        expect(n.props.rotation).toBe(0);
        expect(n.props.opacity).toBe(1);
        expect(n.props).not.toHaveProperty('name');
      }
    }
  },
);
