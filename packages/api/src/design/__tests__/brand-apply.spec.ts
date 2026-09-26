import type { DesignDocument, DesignNode, NodeProps, OperationContext } from '../types';
import type { BrandPackage } from '../brand-package';
import { BRAND_APPLY_MODE, buildBrandApplication, buildBrandOperations } from '../brand-apply';
import { systemsCatalog, getSystem } from '../systems';
import { applyOperations } from '../operations';
import { DesignError } from '../assets';

function geometry(over: Partial<NodeProps> = {}): NodeProps {
  return {
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    rotation: 0,
    opacity: 1,
    ...over,
  };
}

function makeNode(over: Partial<DesignNode> = {}): DesignNode {
  const type = over.type ?? 'rect';
  const props = geometry(over.props);
  if (type === 'text') {
    if (props.text === undefined) props.text = 'Hello';
    if (props.fill === undefined) props.fill = '#1A1A1A';
    if (props.fontFamily === undefined) props.fontFamily = 'Inter';
    if (props.fontSize === undefined) props.fontSize = 14;
  }
  if ((type === 'rect' || type === 'ellipse') && props.fill === undefined) {
    props.fill = '#FFFFFF';
  }
  if ((type === 'rect' || type === 'ellipse') && props.stroke === undefined) {
    props.stroke = '#E5E5E5';
  }
  return {
    id: over.id ?? 'n1',
    type,
    parentId: over.parentId ?? null,
    locked: over.locked ?? false,
    props,
    bindings: over.bindings ? { ...over.bindings } : {},
  };
}

function makeDoc(over: Partial<DesignDocument> = {}): DesignDocument {
  return {
    id: 'doc1',
    projectId: 'proj1',
    kind: 'canvas',
    schemaVersion: 1,
    title: 'Brand apply fixture',
    revision: 3,
    designSystem: over.designSystem ?? { id: 'neutral-business', version: '1.0.0' },
    payload: {
      width: over.payload?.width ?? 1080,
      height: over.payload?.height ?? 1080,
      nodes: over.payload?.nodes ?? [makeNode({ id: 'n1' })],
    },
    assetRefs: over.assetRefs ?? [],
    archived: false,
  };
}

function baseBrand(over: Partial<BrandPackage> = {}): BrandPackage {
  return {
    id: 'acme-brand',
    version: '1.2.0',
    name: 'Acme Brand',
    baseSystemId: 'neutral-business',
    baseSystemVersion: '1.0.0',
    tokens: {
      'color.accent': { type: 'color', value: '#FF5500', properties: ['fill'] },
      'color.text': { type: 'color', value: '#111111', properties: ['fill'] },
      'color.surface': { type: 'color', value: '#FAFAFA', properties: ['fill'] },
      'color.stroke': { type: 'color', value: '#CCCCCC', properties: ['stroke', 'fill'] },
      'font.family.body': { type: 'fontFamily', value: 'Inter', properties: ['fontFamily'] },
      'font.size.body': { type: 'fontSize', value: 18, properties: ['fontSize'] },
    },
    fonts: [{ family: 'Inter', licenseText: 'SIL OPEN FONT LICENSE Version 1.1' }],
    designNotes: 'Snapshot brand apply fixture.',
    ...over,
  };
}

const editor: OperationContext = {
  actorId: 'user-editor',
  role: 'editor',
  agent: false,
};

describe('buildBrandOperations / buildBrandApplication', () => {
  it('materializes bound roles as setLiteral only and clears bindings on apply', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [
          makeNode({
            id: 't1',
            type: 'text',
            bindings: {
              fill: 'color.text',
              fontFamily: 'font.family.body',
              fontSize: 'font.size.body',
            },
          }),
          makeNode({
            id: 'r1',
            type: 'rect',
            bindings: { fill: 'color.surface', stroke: 'color.stroke' },
          }),
        ],
      },
    });
    const frozenDoc = JSON.stringify(doc);
    const catalogBefore = JSON.stringify(systemsCatalog);
    const brand = baseBrand();

    const result = buildBrandApplication(doc, brand, { preserveOverrides: true });
    expect(result.mode).toBe(BRAND_APPLY_MODE);
    expect(result.brandId).toBe('acme-brand');
    expect(result.brandVersion).toBe('1.2.0');
    expect(result.baseSystem).toEqual({ id: 'neutral-business', version: '1.0.0' });
    expect(result.operations.every((op) => op.type === 'setLiteral')).toBe(true);
    expect(result.operations.some((op) => op.type === 'applySystem')).toBe(false);

    const byKey = new Map(result.operations.map((op) => [`${op.nodeId}:${op.property}`, op.value]));
    expect(byKey.get('t1:fill')).toBe('#111111');
    expect(byKey.get('t1:fontFamily')).toBe('Inter');
    expect(byKey.get('t1:fontSize')).toBe(18);
    expect(byKey.get('r1:fill')).toBe('#FAFAFA');
    expect(byKey.get('r1:stroke')).toBe('#CCCCCC');

    const next = applyOperations(
      doc,
      {
        operationId: 'test-brand-apply',
        expectedRevision: doc.revision,
        declaredScope: doc.payload.nodes.map((n) => n.id),
        operations: result.operations,
      },
      editor,
    );

    const text = next.payload.nodes.find((n) => n.id === 't1')!;
    expect(text.props.fill).toBe('#111111');
    expect(text.props.fontSize).toBe(18);
    expect(text.props.fontFamily).toBe('Inter');
    expect(text.bindings).toEqual({});

    const rect = next.payload.nodes.find((n) => n.id === 'r1')!;
    expect(rect.props.fill).toBe('#FAFAFA');
    expect(rect.props.stroke).toBe('#CCCCCC');
    expect(rect.bindings).toEqual({});

    // designSystem pin unchanged — snapshot mode, not live brand binding.
    expect(next.designSystem).toEqual({ id: 'neutral-business', version: '1.0.0' });
    expect(JSON.stringify(doc)).toBe(frozenDoc);
    expect(JSON.stringify(systemsCatalog)).toBe(catalogBefore);
    expect(getSystem('acme-brand', '1.2.0')).toBeUndefined();
  });

  it('preserveOverrides true skips unbound literal props', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [
          makeNode({
            id: 't1',
            type: 'text',
            props: geometry({
              text: 'Custom',
              fill: '#ABCDEF',
              fontFamily: 'Inter',
              fontSize: 22,
            }),
            bindings: { fontFamily: 'font.family.body' },
          }),
        ],
      },
    });

    const ops = buildBrandOperations(doc, baseBrand(), { preserveOverrides: true });
    expect(ops).toEqual([
      { type: 'setLiteral', nodeId: 't1', property: 'fontFamily', value: 'Inter' },
    ]);

    const next = applyOperations(
      doc,
      {
        operationId: 'preserve-literal',
        expectedRevision: doc.revision,
        declaredScope: ['t1'],
        operations: ops,
      },
      editor,
    );
    const text = next.payload.nodes[0];
    expect(text.props.fill).toBe('#ABCDEF');
    expect(text.props.fontSize).toBe(22);
    expect(text.props.fontFamily).toBe('Inter');
    expect(text.bindings.fontFamily).toBeUndefined();
  });

  it('preserveOverrides false fills default roles from systems', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [
          makeNode({
            id: 't1',
            type: 'text',
            props: geometry({
              text: 'Plain',
              fill: '#ABCDEF',
              fontFamily: 'Inter',
              fontSize: 22,
            }),
            bindings: {},
          }),
          makeNode({
            id: 'e1',
            type: 'ellipse',
            props: geometry({ fill: '#010101', stroke: '#020202' }),
            bindings: {},
          }),
        ],
      },
    });

    const ops = buildBrandOperations(doc, baseBrand(), { preserveOverrides: false });
    const byKey = new Map(ops.map((op) => [`${op.nodeId}:${op.property}`, op.value]));
    expect(byKey.get('t1:fill')).toBe('#111111');
    expect(byKey.get('t1:fontFamily')).toBe('Inter');
    expect(byKey.get('t1:fontSize')).toBe(18);
    expect(byKey.get('e1:fill')).toBe('#FAFAFA');
    expect(byKey.get('e1:stroke')).toBe('#CCCCCC');
  });

  it('leaves locked nodes (and descendants of locked ancestors) unchanged', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [
          makeNode({
            id: 'g1',
            type: 'group',
            locked: true,
            props: geometry({ width: 200, height: 200 }),
          }),
          makeNode({
            id: 'child',
            type: 'text',
            parentId: 'g1',
            bindings: { fill: 'color.text' },
          }),
          makeNode({
            id: 'locked-text',
            type: 'text',
            locked: true,
            bindings: { fill: 'color.text', fontSize: 'font.size.body' },
          }),
          makeNode({
            id: 'free',
            type: 'rect',
            bindings: { fill: 'color.surface' },
          }),
        ],
      },
    });
    const before = JSON.parse(JSON.stringify(doc.payload.nodes));

    const ops = buildBrandOperations(doc, baseBrand(), { preserveOverrides: true });
    expect(ops.every((op) => op.nodeId === 'free')).toBe(true);
    expect(ops).toEqual([
      { type: 'setLiteral', nodeId: 'free', property: 'fill', value: '#FAFAFA' },
    ]);

    const next = applyOperations(
      doc,
      {
        operationId: 'locked-skip',
        expectedRevision: doc.revision,
        declaredScope: doc.payload.nodes.map((n) => n.id),
        operations: ops,
      },
      editor,
    );

    for (const id of ['g1', 'child', 'locked-text']) {
      const original = before.find((n: DesignNode) => n.id === id);
      const updated = next.payload.nodes.find((n) => n.id === id)!;
      expect(updated.props).toEqual(original.props);
      expect(updated.bindings).toEqual(original.bindings);
      expect(updated.locked).toBe(original.locked);
    }
  });

  it('rejects unknown fonts through brand-package validation', () => {
    expect(() =>
      buildBrandOperations(
        makeDoc(),
        baseBrand({
          tokens: {
            'font.family.body': {
              type: 'fontFamily',
              value: 'Comic Sans',
              properties: ['fontFamily'],
            },
          },
        }),
        { preserveOverrides: false },
      ),
    ).toThrow(/known bundled font|undeclared font|fontFamily/);
  });

  it('does not mutate the input document or global catalog', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [
          makeNode({
            id: 't1',
            type: 'text',
            bindings: { fill: 'color.text' },
          }),
        ],
      },
    });
    const frozenDoc = JSON.stringify(doc);
    const catalogBefore = JSON.stringify(systemsCatalog);

    buildBrandOperations(doc, baseBrand(), { preserveOverrides: true });

    expect(JSON.stringify(doc)).toBe(frozenDoc);
    expect(JSON.stringify(systemsCatalog)).toBe(catalogBefore);
    expect(getSystem('acme-brand', '1.2.0')).toBeUndefined();
  });

  it('requires preserveOverrides boolean', () => {
    expect(() => buildBrandOperations(makeDoc(), baseBrand(), undefined as never)).toThrow(
      DesignError,
    );
  });
});
