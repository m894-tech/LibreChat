import type { DesignDocument, DesignOperation, OperationBatch } from '../types';
import {
  agentContext,
  batch,
  editorContext,
  makeDoc,
  makeNode,
  snapshot,
  viewerContext,
} from './domain.fixtures';
import { DesignError, DesignErrorCodes } from '../errors';
import { applyOperations } from '../operations';
import { getSystem } from '../systems';

function expectError(fn: () => unknown, status: number, code: string): DesignError {
  try {
    fn();
    throw new Error(`expected DesignError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DesignError);
    const designError = error as DesignError;
    expect(designError.status).toBe(status);
    expect(designError.code).toBe(code);
    return designError;
  }
}

function groupedDoc(): DesignDocument {
  return makeDoc({
    payload: {
      width: 1080,
      height: 1080,
      nodes: [
        makeNode({ id: 'g1', type: 'group' }),
        makeNode({ id: 'n1', type: 'rect', parentId: 'g1' }),
        makeNode({
          id: 't1',
          type: 'text',
          parentId: 'g1',
          props: {
            x: 0,
            y: 0,
            width: 200,
            height: 40,
            rotation: 0,
            opacity: 1,
            text: 'Price',
            fill: '#1A1A1A',
            fontFamily: 'Inter',
            fontSize: 14,
          },
        }),
        makeNode({ id: 'sib', type: 'ellipse' }),
      ],
    },
  });
}

describe('applyOperations revision and ACL', () => {
  it('increments revision by exactly 1', () => {
    const doc = makeDoc({ revision: 7 });
    const next = applyOperations(
      doc,
      batch([{ type: 'setProperty', nodeId: 'n1', property: 'x', value: 12 }], {
        expectedRevision: 7,
      }),
      editorContext,
    );
    expect(next.revision).toBe(8);
    expect(doc.revision).toBe(7);
  });

  it('rejects stale expectedRevision without mutation (T-CON-01 domain)', () => {
    const doc = makeDoc({ revision: 5 });
    const before = snapshot(doc);
    expectError(
      () =>
        applyOperations(
          doc,
          batch([{ type: 'setProperty', nodeId: 'n1', property: 'x', value: 1 }], {
            expectedRevision: 4,
          }),
          editorContext,
        ),
      409,
      DesignErrorCodes.REVISION_MISMATCH,
    );
    expect(doc).toEqual(before);
  });

  it('rejects viewer writes with 403', () => {
    expectError(
      () =>
        applyOperations(
          makeDoc(),
          batch([{ type: 'setProperty', nodeId: 'n1', property: 'x', value: 1 }]),
          viewerContext,
        ),
      403,
      DesignErrorCodes.FORBIDDEN,
    );
  });

  it('rejects actor fields on the operation body', () => {
    const hostile = {
      operationId: 'op-x',
      expectedRevision: 3,
      declaredScope: ['n1'],
      actorId: 'forged',
      operations: [{ type: 'setProperty', nodeId: 'n1', property: 'x', value: 1 }],
    };
    expectError(
      () => applyOperations(makeDoc(), hostile, editorContext),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });
});

describe('hostile operations and allowlists', () => {
  it('rejects unknown operation types and prototype property paths', () => {
    expectError(
      () =>
        applyOperations(
          makeDoc(),
          batch([{ type: 'explode' as unknown as DesignOperation['type'], nodeId: 'n1' }]),
          editorContext,
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );

    expectError(
      () =>
        applyOperations(
          makeDoc(),
          batch([{ type: 'setProperty', nodeId: 'n1', property: '__proto__', value: { x: 1 } }]),
          editorContext,
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );

    expectError(
      () =>
        applyOperations(
          makeDoc(),
          batch([{ type: 'setProperty', nodeId: 'n1', property: 'locked', value: false }]),
          editorContext,
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });

  it('rejects invalid colors, nonfinite numbers and oversized text', () => {
    expectError(
      () =>
        applyOperations(
          makeDoc(),
          batch([{ type: 'setProperty', nodeId: 'n1', property: 'fill', value: 'red' }]),
          editorContext,
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );
    expectError(
      () =>
        applyOperations(
          makeDoc(),
          batch([{ type: 'setProperty', nodeId: 'n1', property: 'opacity', value: Number.NaN }]),
          editorContext,
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );
    const long = 'я'.repeat(9000);
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [makeNode({ id: 'n1', type: 'text' })],
      },
    });
    expectError(
      () =>
        applyOperations(
          doc,
          batch([{ type: 'setText', nodeId: 'n1', value: long }]),
          editorContext,
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });

  it('rejects insertNode id reuse with 409 and keeps the batch atomic', () => {
    const doc = makeDoc();
    const before = snapshot(doc);
    expectError(
      () =>
        applyOperations(
          doc,
          {
            operationId: 'op-reuse',
            expectedRevision: 3,
            declaredScope: ['n1'],
            operations: [
              { type: 'setProperty', nodeId: 'n1', property: 'x', value: 99 },
              {
                type: 'insertNode',
                node: makeNode({ id: 'n1', type: 'ellipse' }),
              },
            ],
          } satisfies OperationBatch,
          editorContext,
        ),
      409,
      DesignErrorCodes.ID_REUSE,
    );
    expect(doc).toEqual(before);
  });

  it('rejects batches over 200 operations', () => {
    const ops = Array.from({ length: 201 }, () => ({
      type: 'setProperty' as const,
      nodeId: 'n1',
      property: 'x',
      value: 1,
    }));
    expectError(
      () => applyOperations(makeDoc(), batch(ops), editorContext),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });
});

describe('locks and subtree scope', () => {
  it('blocks edits when an ancestor is locked (T-OPS-01)', () => {
    const doc = groupedDoc();
    doc.payload.nodes[0].locked = true;
    const before = snapshot(doc);
    expectError(
      () =>
        applyOperations(
          doc,
          batch([{ type: 'setProperty', nodeId: 'n1', property: 'x', value: 8 }], {
            declaredScope: ['g1', 'n1'],
          }),
          editorContext,
        ),
      422,
      DesignErrorCodes.LOCK,
    );
    expect(doc).toEqual(before);
  });

  it('requires descendant scope and unlocked subtree for remove/move', () => {
    const doc = groupedDoc();
    expectError(
      () =>
        applyOperations(
          doc,
          batch([{ type: 'removeNode', nodeId: 'g1' }], { declaredScope: ['g1'] }),
          editorContext,
        ),
      422,
      DesignErrorCodes.SCOPE,
    );

    const lockedChild = groupedDoc();
    lockedChild.payload.nodes.find((node) => node.id === 'n1')!.locked = true;
    expectError(
      () =>
        applyOperations(
          lockedChild,
          batch([{ type: 'removeNode', nodeId: 'g1' }], { declaredScope: ['g1', 'n1', 't1'] }),
          editorContext,
        ),
      422,
      DesignErrorCodes.LOCK,
    );

    const moved = applyOperations(
      groupedDoc(),
      batch([{ type: 'moveNode', nodeId: 'n1', parentId: null }], {
        declaredScope: ['g1', 'n1', 't1', 'sib'],
      }),
      editorContext,
    );
    expect(moved.payload.nodes.find((node) => node.id === 'n1')?.parentId).toBeNull();
  });

  it('rejects group geometry and reorder when a descendant is locked', () => {
    const doc = groupedDoc();
    doc.payload.nodes.find((node) => node.id === 'n1')!.locked = true;
    expectError(
      () =>
        applyOperations(
          doc,
          batch([{ type: 'setProperty', nodeId: 'g1', property: 'x', value: 40 }], {
            declaredScope: ['g1', 'n1', 't1'],
          }),
          editorContext,
        ),
      422,
      DesignErrorCodes.LOCK,
    );
    expectError(
      () =>
        applyOperations(
          doc,
          batch([{ type: 'reorderNode', nodeId: 'g1', value: 0 }], {
            declaredScope: ['g1', 'n1', 't1', 'sib'],
          }),
          editorContext,
        ),
      422,
      DesignErrorCodes.LOCK,
    );
  });

  it('rejects move into a descendant (cycle) and into a locked parent', () => {
    const doc = groupedDoc();
    expectError(
      () =>
        applyOperations(
          doc,
          batch([{ type: 'moveNode', nodeId: 'g1', parentId: 'n1' }], {
            declaredScope: ['g1', 'n1', 't1'],
          }),
          editorContext,
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );

    const lockedParent = groupedDoc();
    lockedParent.payload.nodes[0].locked = true;
    expectError(
      () =>
        applyOperations(
          lockedParent,
          batch(
            [
              {
                type: 'insertNode',
                parentId: 'g1',
                node: makeNode({ id: 'n2', type: 'rect', parentId: 'g1' }),
              },
            ],
            { declaredScope: ['g1'] },
          ),
          editorContext,
        ),
      422,
      DesignErrorCodes.LOCK,
    );
  });

  it('allows owner lock/unlock but never agents', () => {
    const locked = applyOperations(
      makeDoc(),
      batch([{ type: 'lock', nodeId: 'n1' }]),
      editorContext,
    );
    expect(locked.payload.nodes[0].locked).toBe(true);
    const unlocked = applyOperations(
      locked,
      batch([{ type: 'unlock', nodeId: 'n1' }], { expectedRevision: 4 }),
      editorContext,
    );
    expect(unlocked.payload.nodes[0].locked).toBe(false);

    expectError(
      () =>
        applyOperations(makeDoc(), batch([{ type: 'unlock', nodeId: 'n1' }]), agentContext(['n1'])),
      422,
      DesignErrorCodes.CAPABILITY,
    );
  });
});

describe('agent grants', () => {
  it('rejects sibling edits outside authorizedNodeIds (T-OPS-02)', () => {
    const doc = groupedDoc();
    expectError(
      () =>
        applyOperations(
          doc,
          batch([{ type: 'setProperty', nodeId: 'sib', property: 'x', value: 3 }], {
            declaredScope: ['sib'],
          }),
          agentContext(['n1', 't1']),
        ),
      422,
      DesignErrorCodes.SCOPE,
    );

    const ok = applyOperations(
      doc,
      batch([{ type: 'setProperty', nodeId: 'n1', property: 'x', value: 3 }], {
        declaredScope: ['n1'],
      }),
      agentContext(['n1', 't1']),
    );
    expect(ok.payload.nodes.find((node) => node.id === 'n1')?.props.x).toBe(3);
  });

  it('cannot widen declaredScope past the grant', () => {
    expectError(
      () =>
        applyOperations(
          groupedDoc(),
          batch([{ type: 'setProperty', nodeId: 'n1', property: 'x', value: 3 }], {
            declaredScope: ['n1', 'sib'],
          }),
          agentContext(['n1']),
        ),
      422,
      DesignErrorCodes.SCOPE,
    );
  });
});

describe('tokens and applySystem', () => {
  it('bindToken applies pinned system values; setLiteral drops the binding', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [makeNode({ id: 'n1', type: 'rect', props: { fill: '#000000' } as never })],
      },
    });
    const bound = applyOperations(
      makeDoc(),
      batch([{ type: 'bindToken', nodeId: 'n1', property: 'fill', value: 'color.accent' }]),
      editorContext,
    );
    expect(bound.payload.nodes[0].bindings.fill).toBe('color.accent');
    expect(bound.payload.nodes[0].props.fill).toBe(
      getSystem('neutral-business', '1.0.0')?.tokens['color.accent'].value,
    );

    const literal = applyOperations(
      bound,
      batch([{ type: 'setLiteral', nodeId: 'n1', property: 'fill', value: '#112233' }], {
        expectedRevision: 4,
      }),
      editorContext,
    );
    expect(literal.payload.nodes[0].bindings.fill).toBeUndefined();
    expect(literal.payload.nodes[0].props.fill).toBe('#112233');
    expect(doc.revision).toBe(3);
  });

  it('applySystem preserveOverrides updates bindings and keeps literals (T-SYS-04)', () => {
    const start = applyOperations(
      makeDoc({
        payload: {
          width: 1080,
          height: 1080,
          nodes: [
            makeNode({
              id: 'n1',
              type: 'rect',
              bindings: { fill: 'color.accent' },
              props: { fill: '#1F4E79' } as never,
            }),
            makeNode({
              id: 'n2',
              type: 'rect',
              props: { fill: '#ABCDEF' } as never,
            }),
          ],
        },
      }),
      batch(
        [
          {
            type: 'applySystem',
            systemId: 'retail-promo',
            systemVersion: '1.0.0',
            preserveOverrides: true,
          },
        ],
        { declaredScope: ['n1', 'n2'] },
      ),
      editorContext,
    );
    expect(start.designSystem).toEqual({ id: 'retail-promo', version: '1.0.0' });
    expect(start.payload.nodes[0].props.fill).toBe(
      getSystem('retail-promo', '1.0.0')?.tokens['color.accent'].value,
    );
    expect(start.payload.nodes[1].props.fill).toBe('#ABCDEF');
    expect(start.payload.nodes[1].bindings.fill).toBeUndefined();
  });

  it('applySystem without preserveOverrides rebinds default tokens', () => {
    const next = applyOperations(
      makeDoc({
        payload: {
          width: 1080,
          height: 1080,
          nodes: [makeNode({ id: 'n1', type: 'rect', props: { fill: '#ABCDEF' } as never })],
        },
      }),
      batch([
        {
          type: 'applySystem',
          systemId: 'data-analytics',
          systemVersion: '1.0.0',
          preserveOverrides: false,
        },
      ]),
      editorContext,
    );
    expect(next.payload.nodes[0].bindings.fill).toBe('color.surface');
    expect(next.payload.nodes[0].props.fill).toBe(
      getSystem('data-analytics', '1.0.0')?.tokens['color.surface'].value,
    );
  });

  it('rejects unknown system versions', () => {
    expectError(
      () =>
        applyOperations(
          makeDoc(),
          batch([{ type: 'applySystem', systemId: 'retail-promo', systemVersion: '0.0.1' }]),
          editorContext,
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });

  it('does not clear locks via applySystem', () => {
    const locked = applyOperations(
      makeDoc(),
      batch([{ type: 'lock', nodeId: 'n1' }]),
      editorContext,
    );
    const switched = applyOperations(
      locked,
      batch(
        [
          {
            type: 'applySystem',
            systemId: 'data-analytics',
            systemVersion: '1.0.0',
            preserveOverrides: false,
          },
        ],
        { expectedRevision: 4 },
      ),
      editorContext,
    );
    expect(switched.payload.nodes[0].locked).toBe(true);
    expect(switched.payload.nodes[0].props.fill).toBe('#FFFFFF');
  });

  it('applySystem freezes locked node appearance as literals (no re-resolve)', () => {
    const start = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [
          makeNode({
            id: 'n1',
            type: 'rect',
            locked: true,
            bindings: { fill: 'color.accent' },
            props: { fill: '#1F4E79' } as never,
          }),
          makeNode({
            id: 'n2',
            type: 'rect',
            bindings: { fill: 'color.accent' },
            props: { fill: '#1F4E79' } as never,
          }),
        ],
      },
    });
    const next = applyOperations(
      start,
      batch(
        [
          {
            type: 'applySystem',
            systemId: 'retail-promo',
            systemVersion: '1.0.0',
            preserveOverrides: true,
          },
        ],
        { declaredScope: ['n1', 'n2'] },
      ),
      editorContext,
    );
    const lockedNode = next.payload.nodes.find((node) => node.id === 'n1')!;
    const unlockedNode = next.payload.nodes.find((node) => node.id === 'n2')!;
    expect(lockedNode.locked).toBe(true);
    expect(lockedNode.bindings.fill).toBeUndefined();
    expect(Object.keys(lockedNode.bindings)).toEqual([]);
    expect(lockedNode.props.fill).toBe('#1F4E79');
    expect(unlockedNode.bindings.fill).toBe('color.accent');
    expect(unlockedNode.props.fill).toBe(
      getSystem('retail-promo', '1.0.0')?.tokens['color.accent'].value,
    );
  });
});

describe('z-order, text, assets', () => {
  it('uses list order as z-order for reorderNode', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'c' })],
      },
    });
    const next = applyOperations(
      doc,
      batch([{ type: 'reorderNode', nodeId: 'c', value: 0 }], { declaredScope: ['a', 'b', 'c'] }),
      editorContext,
    );
    expect(next.payload.nodes.map((node) => node.id)).toEqual(['c', 'a', 'b']);
  });

  it('setText updates Cyrillic content on text nodes', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [makeNode({ id: 'n1', type: 'text' })],
      },
    });
    const next = applyOperations(
      doc,
      batch([{ type: 'setText', nodeId: 'n1', value: 'Цена 199 ₽' }]),
      editorContext,
    );
    expect(next.payload.nodes[0].props.text).toBe('Цена 199 ₽');
  });

  it('replaceAsset records assetRefs for image nodes', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [makeNode({ id: 'n1', type: 'image' })],
      },
    });
    const next = applyOperations(
      doc,
      batch([{ type: 'replaceAsset', nodeId: 'n1', assetId: 'asset-9', assetVersion: 1 }]),
      editorContext,
    );
    expect(next.payload.nodes[0].props.assetId).toBe('asset-9');
    expect(next.payload.nodes[0].props.assetVersion).toBe(1);
    expect(next.assetRefs).toEqual([{ assetId: 'asset-9', version: 1 }]);
  });
});
