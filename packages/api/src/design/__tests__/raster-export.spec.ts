import sharp from 'sharp';
import { convertRasterExport } from '../raster-export';
it.each(['jpeg', 'webp'] as const)('creates honest lossy%s with pinned size', async (format) => {
  const png = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  const result = await convertRasterExport({ png, width: 64, height: 64, quality: 80, format });
  expect(result.lossy).toBe(true);
  const meta = await sharp(result.bytes).metadata();
  expect(meta.format).toBe(format);
  expect(meta.width).toBe(64);
});
it('rejects mismatched dimensions and invalid quality', async () => {
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#000000' } })
    .png()
    .toBuffer();
  await expect(
    convertRasterExport({ png, width: 9, height: 8, quality: 80, format: 'jpeg' }),
  ).rejects.toThrow();
  await expect(
    convertRasterExport({ png, width: 8, height: 8, quality: 0, format: 'webp' }),
  ).rejects.toThrow();
});
