import sharp from 'sharp';
import { prepareOutpaint, resizeRaster } from '../image-transforms';

describe('prepareOutpaint', () => {
  it('expands canvas without modifying original RGBA including hidden alpha0 channels', async () => {
    const raw = Buffer.from([10, 20, 30, 0, 40, 50, 60, 255]);
    const bytes = await sharp(raw, { raw: { width: 2, height: 1, channels: 4 } })
      .png()
      .toBuffer();
    const out = await prepareOutpaint({
      bytes,
      mime: 'image/png',
      left: 1,
      right: 1,
      top: 1,
      bottom: 1,
    });
    expect(out.width).toBe(4);
    expect(out.height).toBe(3);
    const decoded = await sharp(out.original).ensureAlpha().raw().toBuffer();
    expect(decoded.subarray((1 * 4 + 1) * 4, (1 * 4 + 3) * 4)).toEqual(raw);
    const mask = await sharp(out.mask).toColourspace('b-w').raw().toBuffer();
    expect([...mask]).toEqual([255, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255]);
    expect(out.offset).toEqual({ x: 1, y: 1 });
  });

  it('rejects non-integer or negative padding', async () => {
    const bytes = await sharp({
      create: { width: 4, height: 4, channels: 4, background: '#123456' },
    })
      .png()
      .toBuffer();
    await expect(
      prepareOutpaint({ bytes, mime: 'image/png', left: -1, right: 0, top: 0, bottom: 0 }),
    ).rejects.toThrow();
    await expect(
      prepareOutpaint({ bytes, mime: 'image/png', left: 1.5, right: 0, top: 0, bottom: 0 }),
    ).rejects.toThrow();
  });

  it('rejects expansion exceeding 4096 total dimensions', async () => {
    const bytes = await sharp({
      create: { width: 2049, height: 2049, channels: 4, background: '#123456' },
    })
      .png()
      .toBuffer();
    await expect(
      prepareOutpaint({ bytes, mime: 'image/png', left: 2048, right: 0, top: 0, bottom: 0 }),
    ).rejects.toThrow();
  });

  it('rejects empty expansion (all paddings zero)', async () => {
    const bytes = await sharp({
      create: { width: 4, height: 4, channels: 4, background: '#123456' },
    })
      .png()
      .toBuffer();
    await expect(
      prepareOutpaint({ bytes, mime: 'image/png', left: 0, right: 0, top: 0, bottom: 0 }),
    ).rejects.toThrow();
  });
});

describe('resizeRaster', () => {
  it('upsizes classically with bounds and no AI claim', async () => {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#123456' },
    })
      .png()
      .toBuffer();
    const result = await resizeRaster({ bytes, mime: 'image/png', scale: 2 });
    expect((await sharp(result).metadata()).width).toBe(16);
    expect((await sharp(result).metadata()).height).toBe(16);
  });

  it('rejects unsupported scale factors', async () => {
    const bytes = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#123456' },
    })
      .png()
      .toBuffer();
    await expect(resizeRaster({ bytes, mime: 'image/png', scale: 3 as any })).rejects.toThrow();
    await expect(resizeRaster({ bytes, mime: 'image/png', scale: 1 as any })).rejects.toThrow();
  });

  it('rejects output exceeding 4096 dimensions', async () => {
    const bytes = await sharp({
      create: { width: 2049, height: 2049, channels: 4, background: '#123456' },
    })
      .png()
      .toBuffer();
    await expect(resizeRaster({ bytes, mime: 'image/png', scale: 2 })).rejects.toThrow();
  });

  it('rejects output exceeding byte limit when dimensions are within 4096', async () => {
    // 2000x2000 with random noise: scale 2 => 4000x4000 (within 4096 cap).
    // A high-entropy PNG at that size exceeds 10 MiB, triggering resize_bytes.
    const raw = Buffer.alloc(2000 * 2000 * 4);
    for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 31 + 7) % 256;
    const bytes = await sharp(raw, { raw: { width: 2000, height: 2000, channels: 4 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    await expect(resizeRaster({ bytes, mime: 'image/png', scale: 2 })).rejects.toThrow();
  });
});
