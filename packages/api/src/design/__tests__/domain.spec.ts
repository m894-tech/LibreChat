import {
  ALLOWED_SYSTEM_IDS,
  DEFAULT_SYSTEM_VERSION,
  getSystem,
  isAllowedSystem,
  systemsCatalog,
} from '../systems';
import { applyOperations, canonicalHash, validateDocument } from '../operations';
import { editorContext, makeDoc, makeNode, snapshot } from './domain.fixtures';
import { DesignError, DesignErrorCodes } from '../errors';

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

describe('design systems catalog', () => {
  it('pins the three R1 systems at v1.0.0', () => {
    expect(ALLOWED_SYSTEM_IDS).toEqual(['neutral-business', 'data-analytics', 'retail-promo']);
    expect(systemsCatalog).toHaveLength(3);
    for (const id of ALLOWED_SYSTEM_IDS) {
      expect(isAllowedSystem(id, DEFAULT_SYSTEM_VERSION)).toBe(true);
      const system = getSystem(id, DEFAULT_SYSTEM_VERSION);
      expect(system?.version).toBe('1.0.0');
      expect(system?.tokens['color.accent']).toBeDefined();
      expect(system?.tokens['font.family.body']).toBeDefined();
    }
    expect(
      getSystem('data-analytics', DEFAULT_SYSTEM_VERSION)?.tokens['font.family.body'].value,
    ).toBe('Inter');
    expect(getSystem('data-analytics', DEFAULT_SYSTEM_VERSION)?.fonts).toEqual([
      'Inter',
      'IBM Plex Mono',
    ]);
    expect(isAllowedSystem('neutral-business', '9.9.9')).toBe(false);
  });
});

describe('validateDocument', () => {
  it('accepts a well-formed canvas document', () => {
    expect(() => validateDocument(makeDoc())).not.toThrow();
  });

  it('rejects duplicate node ids before write (T-DOC-01)', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n1', type: 'text' })],
      },
    });
    expectError(() => validateDocument(doc), 409, DesignErrorCodes.ID_REUSE);
  });

  it('rejects parent cycles and non-group parents', () => {
    const cyclic = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [
          makeNode({ id: 'a', type: 'group', parentId: 'b' }),
          makeNode({ id: 'b', type: 'group', parentId: 'a' }),
        ],
      },
    });
    expectError(() => validateDocument(cyclic), 422, DesignErrorCodes.SCHEMA);

    const badParent = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [
          makeNode({ id: 'a', type: 'rect' }),
          makeNode({ id: 'b', type: 'text', parentId: 'a' }),
        ],
      },
    });
    expectError(() => validateDocument(badParent), 422, DesignErrorCodes.SCHEMA);
  });

  it('rejects unknown props, types, nonfinite numbers and out-of-range artboards', () => {
    expectError(
      () =>
        validateDocument(
          makeDoc({
            payload: {
              width: 1080,
              height: 1080,
              nodes: [
                makeNode({
                  props: { x: Infinity, y: 0, width: 10, height: 10, rotation: 0, opacity: 1 },
                }),
              ],
            },
          }),
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );

    const unknownProp = makeDoc();
    (unknownProp.payload.nodes[0].props as Record<string, unknown>).shadow = true;
    expectError(() => validateDocument(unknownProp), 422, DesignErrorCodes.SCHEMA);

    const unknownType = makeDoc();
    (unknownType.payload.nodes[0] as { type: string }).type = 'star';
    expectError(() => validateDocument(unknownType), 422, DesignErrorCodes.SCHEMA);

    expectError(
      () =>
        validateDocument(makeDoc({ payload: { width: 32, height: 1080, nodes: [makeNode()] } })),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });

  it('rejects prototype pollution keys on document, node and props', () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"id":"x"}');
    expectError(() => validateDocument(polluted), 422, DesignErrorCodes.SCHEMA);

    const withCtor = makeDoc() as unknown as Record<string, unknown>;
    withCtor.constructor = { prototype: { hack: true } };
    expectError(() => validateDocument(withCtor), 422, DesignErrorCodes.SCHEMA);

    const nodeProto = makeDoc();
    Object.defineProperty(nodeProto.payload.nodes[0], '__proto__', {
      value: { admin: true },
      enumerable: true,
      configurable: true,
    });
    expectError(() => validateDocument(nodeProto), 422, DesignErrorCodes.SCHEMA);

    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('requires image assetRefs to match node asset pointers', () => {
    const doc = makeDoc({
      payload: {
        width: 1080,
        height: 1080,
        nodes: [
          makeNode({
            id: 'img1',
            type: 'image',
            props: {
              x: 0,
              y: 0,
              width: 64,
              height: 64,
              rotation: 0,
              opacity: 1,
              assetId: 'asset-1',
              assetVersion: 2,
            },
          }),
        ],
      },
      assetRefs: [],
    });
    expectError(() => validateDocument(doc), 422, DesignErrorCodes.SCHEMA);

    doc.assetRefs = [{ assetId: 'asset-1', version: 2 }];
    expect(() => validateDocument(doc)).not.toThrow();
  });

  it('rejects unknown pinned systems', () => {
    const doc = makeDoc({ designSystem: { id: 'neutral-business', version: '2.0.0' } });
    expectError(() => validateDocument(doc), 422, DesignErrorCodes.SCHEMA);
  });
});

describe('canonicalHash', () => {
  it('is stable under key reordering', () => {
    const a = {
      expectedRevision: 1,
      declaredScope: ['n1'],
      operations: [{ type: 'lock', nodeId: 'n1' }],
    };
    const b = {
      operations: [{ nodeId: 'n1', type: 'lock' }],
      declaredScope: ['n1'],
      expectedRevision: 1,
    };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
    expect(canonicalHash(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not include actor identity and rejects prototype keys', () => {
    const body = {
      expectedRevision: 1,
      declaredScope: [],
      operations: [{ type: 'lock', nodeId: 'n1' }],
    };
    const withActor = { ...body, actorId: 'evil' };
    expect(canonicalHash(body)).not.toBe(canonicalHash(withActor));
    expectError(
      () => canonicalHash(JSON.parse('{"__proto__":{"x":1},"a":1}')),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });
});

describe('input immutability', () => {
  it('does not mutate document, batch or context', () => {
    const doc = makeDoc();
    const operations = [{ type: 'setProperty' as const, nodeId: 'n1', property: 'x', value: 50 }];
    const batchBody = {
      operationId: 'op-imm',
      expectedRevision: 3,
      declaredScope: ['n1'],
      operations,
    };
    const context = { ...editorContext };
    const docSnap = snapshot(doc);
    const batchSnap = snapshot(batchBody);
    const ctxSnap = snapshot(context);

    const next = applyOperations(doc, batchBody, context);
    expect(next.revision).toBe(4);
    expect(next.payload.nodes[0].props.x).toBe(50);
    expect(doc).toEqual(docSnap);
    expect(batchBody).toEqual(batchSnap);
    expect(context).toEqual(ctxSnap);
    expect(doc.payload.nodes[0].props.x).toBe(10);
  });
});
