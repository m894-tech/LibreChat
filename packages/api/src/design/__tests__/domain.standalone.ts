/**
 * Additional domain smoke tests.
 */
import { applyOperations, canonicalHash, validateDocument } from '../operations';
import { editorContext, makeDoc, makeNode, snapshot } from './domain.fixtures';
import { DesignError, DesignErrorCodes } from '../errors';
import { systemsCatalog } from '../systems';

describe('domain standalone smoke', () => {
  it('validates, applies, hashes, and rejects stale/hostile ops', () => {
    validateDocument(makeDoc());

    const doc = makeDoc();
    const before = snapshot(doc);
    const next = applyOperations(
      doc,
      {
        operationId: 'standalone-1',
        expectedRevision: 3,
        declaredScope: ['n1'],
        operations: [{ type: 'setProperty', nodeId: 'n1', property: 'x', value: 42 }],
      },
      editorContext,
    );
    expect(next.revision).toBe(4);
    expect(next.payload.nodes[0].props.x).toBe(42);
    expect(doc).toEqual(before);

    try {
      applyOperations(
        makeDoc(),
        {
          operationId: 'stale',
          expectedRevision: 1,
          declaredScope: ['n1'],
          operations: [{ type: 'setProperty', nodeId: 'n1', property: 'x', value: 1 }],
        },
        editorContext,
      );
      throw new Error('expected revision mismatch');
    } catch (error) {
      expect(error).toBeInstanceOf(DesignError);
      expect((error as DesignError).status).toBe(409);
      expect((error as DesignError).code).toBe(DesignErrorCodes.REVISION_MISMATCH);
    }

    try {
      applyOperations(
        makeDoc(),
        {
          operationId: 'lock-prop',
          expectedRevision: 3,
          declaredScope: ['n1'],
          operations: [{ type: 'setProperty', nodeId: 'n1', property: 'locked', value: false }],
        },
        editorContext,
      );
      throw new Error('expected schema error');
    } catch (error) {
      expect(error).toBeInstanceOf(DesignError);
      expect((error as DesignError).code).toBe(DesignErrorCodes.SCHEMA);
    }

    expect(canonicalHash({ b: 1, a: 2 })).toBe(canonicalHash({ a: 2, b: 1 }));
    expect(systemsCatalog).toHaveLength(3);
    expect(makeNode({ id: 'z', type: 'text' }).props.text).toBeDefined();
  });
});
