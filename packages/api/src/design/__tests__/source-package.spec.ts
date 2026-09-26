import JSZip from 'jszip';
import sharp from 'sharp';
import { createHash } from 'crypto';
import type { SourceImportEnvelope } from '../source-import';
import {
  buildSourcePackage,
  SOURCE_PACKAGE_MANIFEST_FILENAME,
  SOURCE_PACKAGE_MAX_ASSETS,
  SOURCE_PACKAGE_MAX_COMPRESSED_BYTES,
  SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES,
  SOURCE_PACKAGE_PLACEHOLDER_PROJECT_ID,
  SOURCE_PACKAGE_SOURCE_FILENAME,
  type SourcePackageAssetLoader,
  type SourcePackageFontInput,
  type SourcePackageManifest,
} from '../source-package';
import { DesignError, DesignErrorCodes } from '../errors';
import { makeDoc, makeNode } from './domain.fixtures';

function expectError(error: unknown, status: number, code: string): DesignError {
  expect(error).toBeInstanceOf(DesignError);
  const designError = error as DesignError;
  expect(designError.status).toBe(status);
  expect(designError.code).toBe(code);
  return designError;
}

async function expectRejects(
  work: () => Promise<unknown>,
  status: number,
  code: string,
): Promise<DesignError> {
  try {
    await work();
    throw new Error(`expected DesignError ${code}`);
  } catch (error) {
    return expectError(error, status, code);
  }
}

function wrapSource(
  over: Parameters<typeof makeDoc>[0] = {},
  extra: { projectId?: string; snapshotProjectId?: string } = {},
): SourceImportEnvelope {
  const doc = makeDoc(over);
  const envelope: SourceImportEnvelope = {
    documentId: doc.id,
    revision: doc.revision,
    format: 'source',
    snapshot: {
      title: doc.title,
      kind: 'canvas',
      schemaVersion: 1,
      designSystem: doc.designSystem,
      payload: doc.payload,
      assetRefs: doc.assetRefs,
      archived: doc.archived,
    },
  };
  if (extra.projectId) {
    envelope.projectId = extra.projectId;
  }
  if (extra.snapshotProjectId) {
    envelope.snapshot.projectId = extra.snapshotProjectId;
  }
  return envelope;
}

async function rasterPng(width = 12, height = 10): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 12, g: 80, b: 200 } },
  })
    .png()
    .toBuffer();
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function pinImage(assetId: string, version: number) {
  return {
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
            assetId,
            assetVersion: version,
          },
        }),
        makeNode({
          id: 'label',
          type: 'text',
          props: {
            x: 24,
            y: 36,
            width: 280,
            height: 48,
            rotation: 0,
            opacity: 1,
            text: 'Привет мир',
            fill: '#1A1A1A',
            fontFamily: 'Inter',
            fontSize: 14,
          },
        }),
      ],
    },
    assetRefs: [{ assetId, version }],
    title: 'Карточка Привет',
  } satisfies Parameters<typeof makeDoc>[0];
}

function loaderFor(
  assets: Record<string, { bytes: Buffer; mime: string }>,
): SourcePackageAssetLoader {
  return async (id, version) => {
    const hit = assets[`${id}@${version}`];
    if (!hit) {
      throw new DesignError(404, DesignErrorCodes.NOT_FOUND, 'Not found');
    }
    return { bytes: hit.bytes, mime: hit.mime };
  };
}

describe('buildSourcePackage', () => {
  it('packs Cyrillic source, pinned raster checksums, fonts and licenses', async () => {
    const png = await rasterPng();
    const fontBytes = Buffer.from('OTTO-font-bytes', 'utf8');
    const fonts: SourcePackageFontInput[] = [
      {
        filename: 'Inter-Regular.ttf',
        bytes: fontBytes,
        licenseText: 'SIL Open Font License 1.1',
      },
    ];
    const source = wrapSource(pinImage('logo', 2));

    const zipBytes = await buildSourcePackage({
      source,
      loadAsset: loaderFor({ 'logo@2': { bytes: png, mime: 'image/png' } }),
      fonts,
    });

    expect(Buffer.isBuffer(zipBytes)).toBe(true);
    expect(zipBytes.length).toBeGreaterThan(0);
    expect(zipBytes.length).toBeLessThanOrEqual(SOURCE_PACKAGE_MAX_COMPRESSED_BYTES);

    const zip = await JSZip.loadAsync(zipBytes);
    const paths = Object.keys(zip.files)
      .filter((name) => !zip.files[name].dir)
      .sort();
    expect(paths).toEqual(
      [
        'assets/logo-v2.png',
        'fonts/Inter-Regular.ttf',
        'fonts/Inter-Regular.ttf.license',
        SOURCE_PACKAGE_MANIFEST_FILENAME,
        SOURCE_PACKAGE_SOURCE_FILENAME,
      ].sort(),
    );

    const sourceJson = await zip.file(SOURCE_PACKAGE_SOURCE_FILENAME)?.async('string');
    expect(sourceJson).toBeDefined();
    expect(sourceJson).toContain('Карточка Привет');
    expect(sourceJson).toContain('Привет мир');
    expect(sourceJson).not.toContain(SOURCE_PACKAGE_PLACEHOLDER_PROJECT_ID);
    const parsedSource = JSON.parse(sourceJson as string) as SourceImportEnvelope;
    expect(parsedSource.format).toBe('source');
    expect(parsedSource.documentId).toBe('doc1');
    expect(parsedSource.snapshot.assetRefs).toEqual([{ assetId: 'logo', version: 2 }]);

    const manifestText = await zip.file(SOURCE_PACKAGE_MANIFEST_FILENAME)?.async('string');
    const manifest = JSON.parse(manifestText as string) as SourcePackageManifest;
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.files[SOURCE_PACKAGE_SOURCE_FILENAME]).toEqual({
      sha256: sha256(Buffer.from(sourceJson as string, 'utf8')),
      size: Buffer.byteLength(sourceJson as string, 'utf8'),
      mime: 'application/json',
    });
    expect(manifest.files['assets/logo-v2.png']).toEqual({
      sha256: sha256(png),
      size: png.length,
      mime: 'image/png',
    });
    expect(manifest.files['fonts/Inter-Regular.ttf']).toEqual({
      sha256: sha256(fontBytes),
      size: fontBytes.length,
      mime: 'font/ttf',
    });
    const licenseBytes = Buffer.from('SIL Open Font License 1.1', 'utf8');
    expect(manifest.files['fonts/Inter-Regular.ttf.license']).toEqual({
      sha256: sha256(licenseBytes),
      size: licenseBytes.length,
      mime: 'text/plain',
    });

    const packedPng = await zip.file('assets/logo-v2.png')?.async('nodebuffer');
    expect(packedPng && Buffer.compare(packedPng, png)).toBe(0);
    const packedFont = await zip.file('fonts/Inter-Regular.ttf')?.async('nodebuffer');
    expect(packedFont && Buffer.compare(packedFont, fontBytes)).toBe(0);
  });

  it('accepts JSON string wrappers and placeholder projectId when source lacks one', async () => {
    const png = await rasterPng();
    const source = wrapSource(pinImage('hero', 1));
    expect(source.projectId).toBeUndefined();
    expect(source.snapshot.projectId).toBeUndefined();

    const zipBytes = await buildSourcePackage({
      source: JSON.stringify(source),
      loadAsset: loaderFor({ 'hero@1': { bytes: png, mime: 'image/png' } }),
      fonts: [],
    });
    const zip = await JSZip.loadAsync(zipBytes);
    expect(zip.file('assets/hero-v1.png')).toBeTruthy();
    const sourceJson = await zip.file(SOURCE_PACKAGE_SOURCE_FILENAME)?.async('string');
    expect(sourceJson).toContain('Привет мир');
  });

  it('rejects unsafe filenames, traversal and duplicate resource names', async () => {
    const png = await rasterPng();
    const source = wrapSource();
    const loadAsset = loaderFor({});

    await expectRejects(
      () =>
        buildSourcePackage({
          source,
          loadAsset,
          fonts: [
            {
              filename: '../evil.ttf',
              bytes: Buffer.from('font'),
              licenseText: 'license',
            },
          ],
        }),
      422,
      DesignErrorCodes.SCHEMA,
    );

    await expectRejects(
      () =>
        buildSourcePackage({
          source,
          loadAsset,
          fonts: [
            {
              filename: 'fonts/nested.ttf',
              bytes: Buffer.from('font'),
              licenseText: 'license',
            },
          ],
        }),
      422,
      DesignErrorCodes.SCHEMA,
    );

    await expectRejects(
      () =>
        buildSourcePackage({
          source,
          loadAsset,
          fonts: [
            {
              filename: 'Inter.ttf',
              bytes: Buffer.from('font-a'),
              licenseText: 'license-a',
            },
            {
              filename: 'Inter.ttf',
              bytes: Buffer.from('font-b'),
              licenseText: 'license-b',
            },
          ],
        }),
      422,
      DesignErrorCodes.SCHEMA,
    );

    await expectRejects(
      () =>
        buildSourcePackage({
          source: wrapSource(pinImage('..hidden', 1)),
          loadAsset: loaderFor({ '..hidden@1': { bytes: png, mime: 'image/png' } }),
          fonts: [],
        }),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });

  it('rejects empty licences, missing/corrupt/mime-mismatched assets and duplicate refs', async () => {
    const png = await rasterPng();
    const source = wrapSource();

    await expectRejects(
      () =>
        buildSourcePackage({
          source,
          loadAsset: loaderFor({}),
          fonts: [{ filename: 'Inter.ttf', bytes: Buffer.from('font'), licenseText: '   ' }],
        }),
      422,
      DesignErrorCodes.SCHEMA,
    );

    await expectRejects(
      () =>
        buildSourcePackage({
          source: wrapSource(pinImage('logo', 1)),
          loadAsset: loaderFor({}),
          fonts: [],
        }),
      404,
      DesignErrorCodes.NOT_FOUND,
    );

    await expectRejects(
      () =>
        buildSourcePackage({
          source: wrapSource(pinImage('logo', 1)),
          loadAsset: async () => ({
            bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
            mime: 'image/png',
          }),
          fonts: [],
        }),
      422,
      DesignErrorCodes.SCHEMA,
    );

    await expectRejects(
      () =>
        buildSourcePackage({
          source: wrapSource(pinImage('logo', 1)),
          loadAsset: async () => ({ bytes: png, mime: 'image/jpeg' }),
          fonts: [],
        }),
      422,
      DesignErrorCodes.SCHEMA,
    );

    const dup = wrapSource({
      assetRefs: [
        { assetId: 'logo', version: 1 },
        { assetId: 'logo', version: 1 },
      ],
    });
    await expectRejects(
      () => buildSourcePackage({ source: dup, loadAsset: loaderFor({}), fonts: [] }),
      422,
      DesignErrorCodes.SCHEMA,
    );
  });

  it('enforces asset count and uncompressed size limits before ZIP', async () => {
    const tooMany = wrapSource({
      assetRefs: Array.from({ length: SOURCE_PACKAGE_MAX_ASSETS + 1 }, (_, index) => ({
        assetId: `asset${index}`,
        version: 1,
      })),
    });
    let loaded = 0;
    await expectRejects(
      () =>
        buildSourcePackage({
          source: tooMany,
          loadAsset: async () => {
            loaded += 1;
            return { bytes: Buffer.from('x'), mime: 'image/png' };
          },
          fonts: [],
        }),
      429,
      DesignErrorCodes.QUOTA,
    );
    expect(loaded).toBe(0);

    const huge = Buffer.alloc(SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES + 1, 7);
    await expectRejects(
      () =>
        buildSourcePackage({
          source: wrapSource(),
          loadAsset: loaderFor({}),
          fonts: [{ filename: 'Huge.ttf', bytes: huge, licenseText: 'license' }],
        }),
      429,
      DesignErrorCodes.QUOTA,
    );
  });

  it('lets unauthorized loaders throw without packing bytes', async () => {
    const denied = new DesignError(403, DesignErrorCodes.FORBIDDEN, 'not allowed');
    await expect(
      buildSourcePackage({
        source: wrapSource(pinImage('secret', 3)),
        loadAsset: async () => {
          throw denied;
        },
        fonts: [],
      }),
    ).rejects.toBe(denied);
  });
});
