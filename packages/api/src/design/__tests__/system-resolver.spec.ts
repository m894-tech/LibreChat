import { batch, editorContext, makeDoc, makeNode, snapshot } from './domain.fixtures';
import { createSystemResolver, type BrandPackage } from '../system-resolver';
import { applyOperations, validateDocument } from '../operations';
import { DesignError, DesignErrorCodes } from '../errors';
import { getSystem, systemsCatalog } from '../systems';

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

function baseBrand(over: Partial<BrandPackage> = {}): BrandPackage {
  return {
    id: 'acme-brand',
    version: '1.0.0',
    name: 'Acme Brand',
    baseSystemId: 'neutral-business',
    baseSystemVersion: '1.0.0',
    tokens: {
      'color.accent': {
        type: 'color',
        value: '#FF5500',
        properties: ['fill'],
      },
      'color.text': {
        type: 'color',
        value: '#101010',
        properties: ['fill'],
      },
      'font.family.body': {
        type: 'fontFamily',
        value: 'Inter',
        properties: ['fontFamily'],
      },
      'font.size.body': {
        type: 'fontSize',
        value: 18,
        properties: ['fontSize'],
      },
    },
    fonts: [{ family: 'Inter', licenseText: 'SIL OPEN FONT LICENSE Version 1.1' }],
    designNotes: 'Custom published brand for resolver tests.',
    ...over,
  };
}

describe('createSystemResolver', () => {
  it('keeps two resolvers with same brand id isolated (no leakage)', () => {
    const catalogBefore = JSON.stringify(systemsCatalog);

    const resolverA = createSystemResolver([
      baseBrand({
        tokens: {
          'color.accent': { type: 'color', value: '#AAAAAA', properties: ['fill'] },
        },
      }),
    ]);
    const resolverB = createSystemResolver([
      baseBrand({
        tokens: {
          'color.accent': { type: 'color', value: '#BBBBBB', properties: ['fill'] },
        },
      }),
    ]);

    expect(resolverA('acme-brand', '1.0.0')?.tokens['color.accent'].value).toBe('#AAAAAA');
    expect(resolverB('acme-brand', '1.0.0')?.tokens['color.accent'].value).toBe('#BBBBBB');
    expect(resolverA('acme-brand', '1.0.0')?.tokens['color.accent'].value).toBe('#AAAAAA');

    // Builtins still resolve; catalog untouched.
    expect(resolverA('neutral-business', '1.0.0')?.tokens['color.accent'].value).toBe(
      getSystem('neutral-business', '1.0.0')?.tokens['color.accent'].value,
    );
    expect(JSON.stringify(systemsCatalog)).toBe(catalogBefore);
  });

  it('rejects duplicate id@version with different content hash', () => {
    expect(() =>
      createSystemResolver([
        baseBrand({
          tokens: {
            'color.accent': { type: 'color', value: '#111111', properties: ['fill'] },
          },
        }),
        baseBrand({
          tokens: {
            'color.accent': { type: 'color', value: '#222222', properties: ['fill'] },
          },
        }),
      ]),
    ).toThrow(/different content hash/);
  });

  it('accepts duplicate id@version when content hash matches', () => {
    const brand = baseBrand();
    const resolver = createSystemResolver([brand, JSON.parse(JSON.stringify(brand))]);
    expect(resolver('acme-brand', '1.0.0')?.id).toBe('acme-brand');
  });

  it('rejects builtin id collision via validator', () => {
    expect(() =>
      createSystemResolver([
        baseBrand({
          id: 'neutral-business',
        }),
      ]),
    ).toThrow(/builtin/);
  });
});

describe('injected SystemResolver through operations', () => {
  it('applySystem to custom brand preserves token refs and explicit literals', () => {
    const resolver = createSystemResolver([baseBrand()]);
    const catalogBefore = JSON.stringify(systemsCatalog);

    const start = makeDoc({
      designSystem: { id: 'neutral-business', version: '1.0.0' },
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
            props: {
              fill: '#1A1A1A',
              fontFamily: 'Inter',
              fontSize: 14,
              text: 'Hello brand',
            } as never,
          }),
          makeNode({
            id: 'r1',
            type: 'rect',
            props: { fill: '#ABCDEF' } as never,
          }),
        ],
      },
    });
    const before = snapshot(start);

    const next = applyOperations(
      start,
      batch(
        [
          {
            type: 'applySystem',
            systemId: 'acme-brand',
            systemVersion: '1.0.0',
            preserveOverrides: true,
          },
        ],
        { declaredScope: ['t1', 'r1'] },
      ),
      editorContext,
      resolver,
    );

    expect(next.designSystem).toEqual({ id: 'acme-brand', version: '1.0.0' });
    const text = next.payload.nodes.find((node) => node.id === 't1')!;
    expect(text.bindings.fill).toBe('color.text');
    expect(text.bindings.fontFamily).toBe('font.family.body');
    expect(text.bindings.fontSize).toBe('font.size.body');
    expect(text.props.fill).toBe('#101010');
    expect(text.props.fontFamily).toBe('Inter');
    expect(text.props.fontSize).toBe(18);
    expect(text.props.text).toBe('Hello brand');

    const rect = next.payload.nodes.find((node) => node.id === 'r1')!;
    expect(rect.bindings.fill).toBeUndefined();
    expect(rect.props.fill).toBe('#ABCDEF');

    expect(start).toEqual(before);
    expect(JSON.stringify(systemsCatalog)).toBe(catalogBefore);

    // Document pinned to custom brand validates only with the same resolver.
    validateDocument(next, resolver);
  });

  it('rejects missing custom system fail-closed when resolver omits it', () => {
    const emptyResolver = createSystemResolver([]);
    expectError(
      () =>
        applyOperations(
          makeDoc(),
          batch([
            {
              type: 'applySystem',
              systemId: 'acme-brand',
              systemVersion: '1.0.0',
              preserveOverrides: true,
            },
          ]),
          editorContext,
          emptyResolver,
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );

    expectError(
      () =>
        validateDocument(
          makeDoc({ designSystem: { id: 'acme-brand', version: '1.0.0' } }),
          emptyResolver,
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });

  it('default getSystem path still works without injecting a resolver', () => {
    validateDocument(makeDoc());
    const next = applyOperations(
      makeDoc(),
      batch([{ type: 'setProperty', nodeId: 'n1', property: 'x', value: 33 }]),
      editorContext,
    );
    expect(next.revision).toBe(4);
    expect(next.payload.nodes[0].props.x).toBe(33);
  });
});
