import sharp from 'sharp';
import { createHash } from 'crypto';
import {
  preparePresentationHandoff,
  validateDesignRaster,
  validatePresentationSourceLink,
} from '../presentation-handoff';
import { makeDoc, makeNode, snapshot } from './domain.fixtures';
import { DesignError, DesignErrorCodes } from '../errors';

function expectError(error: unknown, status: number, code: string): asserts error is DesignError {
  expect(error).toBeInstanceOf(DesignError);
  const designError = error as DesignError;
  expect(designError.status).toBe(status);
  expect(designError.code).toBe(code);
}

async function expectReject(
  fn: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<DesignError> {
  try {
    await fn();
    throw new Error(`expected DesignError ${code}`);
  } catch (error) {
    expectError(error, status, code);
    return error;
  }
}

async function pngOf(width: number, height: number, color = '#112233'): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

describe('presentation raster handoff', () => {
  it('returns a version-pinned immutable raster contract without mutating inputs', async () => {
    const document = makeDoc({
      id: 'doc1',
      revision: 7,
      designSystem: { id: 'retail-promo', version: '1.0.0' },
      assetRefs: [{ assetId: 'asset-a', version: 2 }],
      payload: {
        width: 128,
        height: 96,
        nodes: [
          makeNode({ id: 'locked-title', type: 'text', locked: true, props: { text: 'Sale' } }),
          makeNode({ id: 'n2', type: 'rect' }),
        ],
      },
    });
    const before = snapshot(document);
    const png = await pngOf(128, 96);
    const pngBefore = Buffer.from(png);

    const handoff = await preparePresentationHandoff({
      document,
      png,
      sourceLink: '/design?documentId=doc1',
    });

    expect(handoff).toEqual({
      kind: 'raster',
      revision: 7,
      width: 128,
      height: 96,
      pngSha256: createHash('sha256').update(pngBefore).digest('hex'),
      sourceLink: '/design?documentId=doc1',
      editable: false,
      assetRefs: [{ assetId: 'asset-a', version: 2 }],
      designSystem: { id: 'retail-promo', version: '1.0.0' },
    });
    expect(handoff.editable).toBe(false);
    expect(Object.isFrozen(handoff)).toBe(false);

    // originals untouched (including locked nodes)
    expect(document).toEqual(before);
    expect(document.payload.nodes[0]?.locked).toBe(true);
    expect(png.equals(pngBefore)).toBe(true);

    // returned refs are copies
    handoff.assetRefs[0]!.version = 99;
    handoff.designSystem.version = '9.9.9';
    expect(document.assetRefs[0]).toEqual({ assetId: 'asset-a', version: 2 });
    expect(document.designSystem).toEqual({ id: 'retail-promo', version: '1.0.0' });
  });

  it('rejects mismatched png dimensions', async () => {
    const document = makeDoc({
      payload: { width: 128, height: 96, nodes: [makeNode()] },
    });
    const png = await pngOf(64, 96);
    await expectReject(
      () =>
        preparePresentationHandoff({
          document,
          png,
          sourceLink: '/design?documentId=doc1',
        }),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });

  it('rejects non-png mime / invalid raster bytes', async () => {
    const document = makeDoc({
      payload: { width: 64, height: 64, nodes: [makeNode()] },
    });
    const jpeg = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#abcdef' },
    })
      .jpeg()
      .toBuffer();

    await expectReject(
      () =>
        preparePresentationHandoff({
          document,
          png: jpeg,
          sourceLink: '/design?documentId=doc1',
        }),
      422,
      DesignErrorCodes.SCHEMA,
    );

    await expectReject(
      () => validateDesignRaster(Buffer.from('not-an-image'), { width: 64, height: 64 }),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });

  it('rejects unsafe or non app-relative sourceLink values', async () => {
    const document = makeDoc({
      payload: { width: 64, height: 64, nodes: [makeNode()] },
    });
    const png = await pngOf(64, 64);
    const unsafe = [
      'https://evil.example/design?documentId=doc1',
      '//evil.example/design?documentId=doc1',
      '/design?documentId=doc1&token=secret',
      '/design?documentId=other',
      'http://localhost/design?documentId=doc1',
      '/api/design?documentId=doc1',
      '/design#documentId=doc1',
      'user:pass@/design?documentId=doc1',
      '/design?documentId=doc1#frag',
    ];

    for (const sourceLink of unsafe) {
      await expectReject(
        () => preparePresentationHandoff({ document, png, sourceLink }),
        422,
        DesignErrorCodes.SCHEMA,
      );
    }

    expect(() =>
      validatePresentationSourceLink('https://x/design?documentId=doc1', 'doc1'),
    ).toThrow(DesignError);
  });

  it('leaves locked originals untouched when handoff validation fails', async () => {
    const document = makeDoc({
      payload: {
        width: 80,
        height: 80,
        nodes: [makeNode({ id: 'locked', locked: true, type: 'text', props: { text: 'Lock' } })],
      },
      assetRefs: [{ assetId: 'a1', version: 1 }],
    });
    const before = snapshot(document);
    const png = await pngOf(40, 40);

    await expectReject(
      () =>
        preparePresentationHandoff({
          document,
          png,
          sourceLink: '/design?documentId=doc1',
        }),
      422,
      DesignErrorCodes.SCHEMA,
    );

    expect(document).toEqual(before);
    expect(document.payload.nodes[0]?.locked).toBe(true);
  });
});
