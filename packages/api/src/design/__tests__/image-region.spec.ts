import sharp from 'sharp';
import { canvasPointToSource, compositeStrictRegion } from '../image-region';
import { DesignError } from '../assets';

async function rgbaPng(width: number, height: number, pixels: number[]): Promise<Buffer> {
  const data = Buffer.from(pixels);
  if (data.length !== width * height * 4) {
    throw new Error('rgba fixture size mismatch');
  }
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function grayPng(width: number, height: number, pixels: number[]): Promise<Buffer> {
  const data = Buffer.from(pixels);
  if (data.length !== width * height) {
    throw new Error('gray fixture size mismatch');
  }
  return sharp(data, { raw: { width, height, channels: 1 } })
    .toColourspace('b-w')
    .png()
    .toBuffer();
}

async function decodeRgba(bytes: Buffer): Promise<{ width: number; height: number; data: Buffer }> {
  const result = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: result.info.width, height: result.info.height, data: result.data };
}

describe('canvasPointToSource', () => {
  const base = {
    nodeX: 100,
    nodeY: 200,
    nodeWidth: 200,
    nodeHeight: 100,
    rotationDeg: 0,
    crop: { x: 10, y: 20, width: 40, height: 20 },
  };

  it('maps identity (no rotation) analytically through crop scale', () => {
    const topLeft = canvasPointToSource({ x: 100, y: 200 }, base);
    expect(topLeft).toEqual({ x: 10, y: 20 });

    const bottomRight = canvasPointToSource({ x: 300, y: 300 }, base);
    expect(bottomRight).toEqual({ x: 50, y: 40 });

    const mid = canvasPointToSource({ x: 200, y: 250 }, base);
    expect(mid.x).toBeCloseTo(30, 10);
    expect(mid.y).toBeCloseTo(30, 10);
  });

  it('maps fractional crop/node scale analytically', () => {
    const geometry = {
      nodeX: 0,
      nodeY: 0,
      nodeWidth: 3,
      nodeHeight: 5,
      rotationDeg: 0,
      crop: { x: 1.5, y: 2.25, width: 6, height: 10 },
    };
    const mapped = canvasPointToSource({ x: 1.5, y: 2.5 }, geometry);
    expect(mapped.x).toBeCloseTo(1.5 + (1.5 / 3) * 6, 10);
    expect(mapped.y).toBeCloseTo(2.25 + (2.5 / 5) * 10, 10);
  });

  it('uses actual Konva top-left pivot at 90 degrees', () => {
    const g = {
      nodeX: 10,
      nodeY: 20,
      nodeWidth: 100,
      nodeHeight: 50,
      rotationDeg: 90,
      crop: { x: 5, y: 6, width: 200, height: 100 },
    };
    const mapped = canvasPointToSource({ x: -15, y: 70 }, g);
    expect(mapped.x).toBeCloseTo(105);
    expect(mapped.y).toBeCloseTo(56);
  });
  it('roundtrips arbitrary fractional rotation with top-left pivot', () => {
    const angle = (32.5 * Math.PI) / 180;
    const x = 41.25,
      y = 19.75;
    const g = {
      nodeX: 80,
      nodeY: 90,
      nodeWidth: 120,
      nodeHeight: 65,
      rotationDeg: 32.5,
      crop: { x: 17, y: 9, width: 240, height: 130 },
    };
    const mapped = canvasPointToSource(
      {
        x: 80 + x * Math.cos(angle) - y * Math.sin(angle),
        y: 90 + x * Math.sin(angle) + y * Math.cos(angle),
      },
      g,
    );
    expect(mapped.x).toBeCloseTo(17 + x * 2);
    expect(mapped.y).toBeCloseTo(9 + y * 2);
  });
  it('rejects points outside the node after inverse rotation without clamping', () => {
    expect(() => canvasPointToSource({ x: 99, y: 200 }, base)).toThrow(DesignError);
    expect(() => canvasPointToSource({ x: 301, y: 250 }, base)).toThrow(DesignError);
    expect(() => canvasPointToSource({ x: 200, y: 301 }, base)).toThrow(DesignError);

    const rotated = { ...base, rotationDeg: 45 };
    expect(() => canvasPointToSource({ x: 90, y: 190 }, rotated)).toThrow(DesignError);
  });

  it('rejects non-finite and non-positive geometry', () => {
    expect(() => canvasPointToSource({ x: Number.NaN, y: 0 }, base)).toThrow(DesignError);
    expect(() => canvasPointToSource({ x: 150, y: 250 }, { ...base, nodeWidth: 0 })).toThrow(
      DesignError,
    );
    expect(() =>
      canvasPointToSource({ x: 150, y: 250 }, { ...base, crop: { ...base.crop, height: -1 } }),
    ).toThrow(DesignError);
    expect(() =>
      canvasPointToSource({ x: 150, y: 250 }, { ...base, rotationDeg: Number.POSITIVE_INFINITY }),
    ).toThrow(DesignError);
  });
});

describe('compositeStrictRegion', () => {
  it('preserves outside-mask RGBA bytes exactly and replaces inside-mask pixels', async () => {
    // 2x2 original with alpha-0 pixel at (0,0)
    const original = await rgbaPng(2, 2, [
      10,
      20,
      30,
      0, // (0,0) alpha 0 — must survive when mask=0
      40,
      50,
      60,
      255, // (1,0)
      70,
      80,
      90,
      128, // (0,1)
      110,
      120,
      130,
      255, // (1,1)
    ]);
    const generated = await rgbaPng(
      2,
      2,
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 200, 210, 220, 230],
    );
    // mask: keep, replace, keep, replace
    const mask = await grayPng(2, 2, [0, 255, 0, 255]);

    const composited = await compositeStrictRegion({ original, generated, mask });
    const out = await decodeRgba(composited);
    const origRgba = await decodeRgba(original);

    expect(out.width).toBe(2);
    expect(out.height).toBe(2);

    // Outside mask: exact decoded RGBA equality (incl. alpha 0)
    expect(out.data[0]).toBe(origRgba.data[0]);
    expect(out.data[1]).toBe(origRgba.data[1]);
    expect(out.data[2]).toBe(origRgba.data[2]);
    expect(out.data[3]).toBe(origRgba.data[3]);
    expect(out.data[3]).toBe(0);

    expect(out.data[8]).toBe(origRgba.data[8]);
    expect(out.data[9]).toBe(origRgba.data[9]);
    expect(out.data[10]).toBe(origRgba.data[10]);
    expect(out.data[11]).toBe(origRgba.data[11]);

    // Inside mask: generated values
    expect(Array.from(out.data.subarray(4, 8))).toEqual([5, 6, 7, 8]);
    expect(Array.from(out.data.subarray(12, 16))).toEqual([200, 210, 220, 230]);

    // Outside must differ from generated (proves we did not use generated everywhere)
    expect(Array.from(out.data.subarray(0, 4))).not.toEqual([1, 2, 3, 4]);
  });

  it('linearly blends intermediate mask values and keeps mask=0 exact', async () => {
    const original = await rgbaPng(2, 2, [0, 0, 0, 0, 0, 0, 0, 255, 100, 0, 0, 255, 0, 0, 0, 255]);
    const generated = await rgbaPng(
      2,
      2,
      [255, 255, 255, 255, 255, 255, 255, 255, 200, 0, 0, 255, 0, 0, 0, 255],
    );
    const mask = await grayPng(2, 2, [0, 255, 128, 0]);

    const composited = await compositeStrictRegion({ original, generated, mask });
    const out = await decodeRgba(composited);

    expect(Array.from(out.data.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(out.data.subarray(4, 8))).toEqual([255, 255, 255, 255]);
    expect(out.data[8]).toBe(Math.round((100 * (255 - 128) + 200 * 128) / 255));
    expect(Array.from(out.data.subarray(12, 16))).toEqual([0, 0, 0, 255]);
  });

  it('preserves decoded RGBA outside mask for JPEG originals (not file bytes)', async () => {
    const originalJpeg = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 12, g: 34, b: 56 },
      },
    })
      .jpeg({ quality: 90 })
      .toBuffer();
    const generated = await rgbaPng(2, 2, [9, 9, 9, 255, 8, 8, 8, 255, 7, 7, 7, 255, 6, 6, 6, 255]);
    const mask = await grayPng(2, 2, [0, 0, 0, 255]);

    const composited = await compositeStrictRegion({
      original: originalJpeg,
      generated,
      mask,
    });
    const out = await decodeRgba(composited);
    const origRgba = await decodeRgba(originalJpeg);

    for (const index of [0, 1, 2]) {
      const o = index * 4;
      expect(out.data[o]).toBe(origRgba.data[o]);
      expect(out.data[o + 1]).toBe(origRgba.data[o + 1]);
      expect(out.data[o + 2]).toBe(origRgba.data[o + 2]);
      expect(out.data[o + 3]).toBe(origRgba.data[o + 3]);
    }
    expect(Array.from(out.data.subarray(12, 16))).toEqual([6, 6, 6, 255]);
  });

  it('rejects mismatched dimensions and non-grayscale masks', async () => {
    const original = await rgbaPng(2, 2, new Array(16).fill(1));
    const generated = await rgbaPng(2, 1, new Array(8).fill(2));
    const mask = await grayPng(2, 2, [0, 0, 0, 0]);

    await expect(compositeStrictRegion({ original, generated, mask })).rejects.toBeInstanceOf(
      DesignError,
    );

    const rgbMask = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const generatedOk = await rgbaPng(2, 2, new Array(16).fill(3));
    await expect(
      compositeStrictRegion({ original, generated: generatedOk, mask: rgbMask }),
    ).rejects.toBeInstanceOf(DesignError);
  });

  it('rejects malicious / oversized dimensions and payloads', async () => {
    const tiny = await rgbaPng(2, 2, new Array(16).fill(1));
    const gray = await grayPng(2, 2, [0, 0, 0, 0]);
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 0xff);

    await expect(
      compositeStrictRegion({ original: huge, generated: tiny, mask: gray }),
    ).rejects.toBeInstanceOf(DesignError);

    // Craft a PNG IHDR claiming 5000x5000 while keeping small file via sharp create then...
    // sharp won't emit >limit easily; build minimal malicious IHDR PNG claiming huge size.
    const malicious = craftPngWithIhdr(5000, 5000);
    await expect(
      compositeStrictRegion({ original: malicious, generated: tiny, mask: gray }),
    ).rejects.toThrow();
  });
});

function craftPngWithIhdr(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const type = Buffer.from('IHDR');
  const crc = crc32(Buffer.concat([type, ihdrData]));
  const chunkLen = Buffer.alloc(4);
  chunkLen.writeUInt32BE(ihdrData.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  // Minimal IEND
  const iendType = Buffer.from('IEND');
  const iendCrc = crc32(iendType);
  const iendLen = Buffer.alloc(4);
  const iendCrcBuf = Buffer.alloc(4);
  iendCrcBuf.writeUInt32BE(iendCrc >>> 0, 0);
  return Buffer.concat([
    signature,
    chunkLen,
    type,
    ihdrData,
    crcBuf,
    iendLen,
    iendType,
    iendCrcBuf,
  ]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return crc >>> 0;
}
