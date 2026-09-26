import sharp from 'sharp';
import JSZip from 'jszip';
import { exportRasterOffice } from '../raster-office-export';
const png = () =>
  sharp({ create: { width: 64, height: 64, channels: 4, background: '#338899' } })
    .png()
    .toBuffer();
it('produces PDF with correct binary xref offsets and one image page', async () => {
  const result = await exportRasterOffice({
    png: await png(),
    width: 64,
    height: 64,
    format: 'pdf',
    title: 'Тест',
  });
  expect(result.editable).toBe(false);
  expect(result.bytes.subarray(0, 8).toString()).toBe('%PDF-1.4');
  const text = result.bytes.toString('latin1');
  const offset = Number(text.match(/startxref\n(\d+)/)![1]);
  expect(text.slice(offset, offset + 4)).toBe('xref');
  expect(text).toContain('/MediaBox [0 0 48 48]');
});
it('embeds original PNG in single-slide noneditable PPTX', async () => {
  const image = await png();
  const result = await exportRasterOffice({
    png: image,
    width: 64,
    height: 64,
    format: 'pptx',
    title: 'Тест < >',
  });
  const zip = await JSZip.loadAsync(result.bytes);
  expect(await zip.file('ppt/media/image1.png')!.async('nodebuffer')).toEqual(image);
  const slide = await zip.file('ppt/slides/slide1.xml')!.async('string');
  expect(slide).toContain('<p:pic>');
  expect(slide).toContain('&lt; &gt;');
  expect(result.editable).toBe(false);
});
