import JSZip from 'jszip';
import sharp from 'sharp';
import { crc32 } from 'zlib';
import { createHash } from 'crypto';
import type { SourceImportEnvelope } from '../source-import';
import {
  buildSourcePackage,
  SOURCE_PACKAGE_MANIFEST_FILENAME,
  SOURCE_PACKAGE_MAX_COMPRESSED_BYTES,
  SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES,
  SOURCE_PACKAGE_SOURCE_FILENAME,
  type SourcePackageAssetLoader,
  type SourcePackageFontInput,
  type SourcePackageManifest,
} from '../source-package';
import { parseSourcePackage, SOURCE_PACKAGE_MAX_ENTRIES } from '../source-package-import';
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

type RawZipEntry = {
  name: string;
  data: Buffer;
  compressionMethod?: number;
  gpFlag?: number;
  versionMadeBy?: number;
  externalFileAttributes?: number;
};

function buildStoredZip(entries: RawZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc = crc32(data) >>> 0;
    const method = entry.compressionMethod ?? 0;
    const flag = entry.gpFlag ?? 0;
    const versionMadeBy = entry.versionMadeBy ?? 20;
    const extAttr = entry.externalFileAttributes ?? 0;

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flag, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const localFull = Buffer.concat([local, data]);
    locals.push(localFull);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(versionMadeBy, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flag, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(extAttr >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += localFull.length;
  }

  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDir, eocd]);
}

async function zipFromFiles(files: Record<string, Buffer | string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) {
    zip.file(name, body);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

describe('parseSourcePackage', () => {
  it('round-trips a builder ZIP with Cyrillic source, pinned assets and fonts', async () => {
    const png = await rasterPng();
    const fontBytes = Buffer.from('OTTO-font-bytes', 'utf8');
    const fonts: SourcePackageFontInput[] = [
      {
        filename: 'Inter-Regular.ttf',
        bytes: fontBytes,
        licenseText: 'SIL Open Font License 1.1',
      },
    ];
    const source = wrapSource(pinImage('logo', 2), { projectId: 'proj1' });
    const zipBytes = await buildSourcePackage({
      source,
      loadAsset: loaderFor({ 'logo@2': { bytes: png, mime: 'image/png' } }),
      fonts,
    });

    const parsed = await parseSourcePackage(zipBytes);

    expect(parsed.source.documentId).toBe('doc1');
    expect(parsed.imported.document.title).toBe('Карточка Привет');
    expect(
      parsed.imported.document.payload.nodes.some((node) => node.props.text === 'Привет мир'),
    ).toBe(true);
    expect(parsed.imported.assetRefs).toEqual([{ assetId: 'logo', version: 2 }]);

    const assetPath = 'assets/logo-v2.png';
    expect(parsed.assets[assetPath]).toBeDefined();
    expect(parsed.assets[assetPath].originalId).toBe('logo');
    expect(parsed.assets[assetPath].assetId).toBe('logo');
    expect(parsed.assets[assetPath].version).toBe(2);
    expect(parsed.assets[assetPath].mime).toBe('image/png');
    expect(parsed.assets[assetPath].bytes.equals(png)).toBe(true);

    const fontPath = 'fonts/Inter-Regular.ttf';
    expect(parsed.fonts[fontPath]).toBeDefined();
    expect(parsed.fonts[fontPath].filename).toBe('Inter-Regular.ttf');
    expect(parsed.fonts[fontPath].bytes.equals(fontBytes)).toBe(true);
    expect(parsed.fonts[fontPath].licenseText).toBe('SIL Open Font License 1.1');
    expect(parsed.fonts[fontPath].licensePath).toBe('fonts/Inter-Regular.ttf.license');
    expect(parsed.manifest.schemaVersion).toBe(1);
    expect(parsed.manifest.files[SOURCE_PACKAGE_SOURCE_FILENAME]).toBeDefined();
  });

  it('rejects traversal, backslash, absolute and noncanonical paths', async () => {
    const payload = Buffer.from('{"format":"source"}', 'utf8');
    const cases: string[] = [
      '../evil.json',
      'assets\\logo-v1.png',
      '/tmp/evil.json',
      'assets/./logo-v1.png',
      'assets//logo-v1.png',
      'C:/windows/evil.json',
    ];

    for (const name of cases) {
      const zipBytes = buildStoredZip([{ name, data: payload }]);
      const error = await expectRejects(
        () => parseSourcePackage(zipBytes),
        422,
        DesignErrorCodes.SCHEMA,
      );
      expect(error.message.toLowerCase()).toMatch(/unsafe|invalid|path|zip/);
    }
  });

  it('rejects compressed and decompressed oversize archives before buffering the bomb', async () => {
    const hugeCompressed = Buffer.alloc(SOURCE_PACKAGE_MAX_COMPRESSED_BYTES + 1, 1);
    await expectRejects(() => parseSourcePackage(hugeCompressed), 429, DesignErrorCodes.QUOTA);

    const bomb = await zipFromFiles({
      'blob.bin': Buffer.alloc(SOURCE_PACKAGE_MAX_UNCOMPRESSED_BYTES + 1, 0),
    });
    expect(bomb.length).toBeLessThan(SOURCE_PACKAGE_MAX_COMPRESSED_BYTES);
    await expectRejects(() => parseSourcePackage(bomb), 429, DesignErrorCodes.QUOTA);
  });

  it('rejects manifest hash mismatch', async () => {
    const sourceBytes = Buffer.from(JSON.stringify(wrapSource()), 'utf8');
    const manifest: SourcePackageManifest = {
      schemaVersion: 1,
      files: {
        [SOURCE_PACKAGE_SOURCE_FILENAME]: {
          sha256: '0'.repeat(64),
          size: sourceBytes.length,
          mime: 'application/json',
        },
      },
    };
    const zipBytes = await zipFromFiles({
      [SOURCE_PACKAGE_SOURCE_FILENAME]: sourceBytes,
      [SOURCE_PACKAGE_MANIFEST_FILENAME]: Buffer.from(JSON.stringify(manifest), 'utf8'),
    });
    const error = await expectRejects(
      () => parseSourcePackage(zipBytes),
      422,
      DesignErrorCodes.SCHEMA,
    );
    expect(error.message).toMatch(/hash/i);
  });

  it('rejects duplicate ZIP entries', async () => {
    const data = Buffer.from('{"format":"source"}', 'utf8');
    const zipBytes = buildStoredZip([
      { name: SOURCE_PACKAGE_SOURCE_FILENAME, data },
      { name: SOURCE_PACKAGE_SOURCE_FILENAME, data },
    ]);
    const error = await expectRejects(
      () => parseSourcePackage(zipBytes),
      422,
      DesignErrorCodes.SCHEMA,
    );
    expect(error.message).toMatch(/duplicate/i);
  });

  it('rejects encryption, symlinks, unsupported compression, unlisted files and unsupported input', async () => {
    const data = Buffer.from('{"format":"source"}', 'utf8');

    await expectRejects(
      () => parseSourcePackage(buildStoredZip([{ name: 'source.json', data, gpFlag: 0x1 }])),
      422,
      DesignErrorCodes.SCHEMA,
    );

    await expectRejects(
      () =>
        parseSourcePackage(
          buildStoredZip([
            {
              name: 'source.json',
              data,
              versionMadeBy: (3 << 8) | 20,
              externalFileAttributes: (0xa1ff << 16) >>> 0,
            },
          ]),
        ),
      422,
      DesignErrorCodes.SCHEMA,
    );

    await expectRejects(
      () =>
        parseSourcePackage(buildStoredZip([{ name: 'source.json', data, compressionMethod: 9 }])),
      422,
      DesignErrorCodes.SCHEMA,
    );

    const sourceBytes = Buffer.from(JSON.stringify(wrapSource()), 'utf8');
    const manifest: SourcePackageManifest = {
      schemaVersion: 1,
      files: {
        [SOURCE_PACKAGE_SOURCE_FILENAME]: {
          sha256: sha256(sourceBytes),
          size: sourceBytes.length,
          mime: 'application/json',
        },
      },
    };
    const withExtra = await zipFromFiles({
      [SOURCE_PACKAGE_SOURCE_FILENAME]: sourceBytes,
      [SOURCE_PACKAGE_MANIFEST_FILENAME]: Buffer.from(JSON.stringify(manifest), 'utf8'),
      'evil.txt': Buffer.from('nope', 'utf8'),
    });
    const unlisted = await expectRejects(
      () => parseSourcePackage(withExtra),
      422,
      DesignErrorCodes.SCHEMA,
    );
    expect(unlisted.message).toMatch(/unlisted/i);

    await expectRejects(() => parseSourcePackage('not-a-zip'), 422, DesignErrorCodes.SCHEMA);
    await expectRejects(
      () => parseSourcePackage(Buffer.from('PK\x03\x04notzip')),
      422,
      DesignErrorCodes.SCHEMA,
    );
    expect(SOURCE_PACKAGE_MAX_ENTRIES).toBe(500);
  });
});
