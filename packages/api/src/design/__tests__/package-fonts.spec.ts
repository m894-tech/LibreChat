import path from 'path';
import { loadPackageFonts } from '../package-fonts';
it('loads only shipped licensed font resources', async () => {
  const root = path.resolve(__dirname, '../../../../../client/public/design-fonts');
  const fonts = await loadPackageFonts(root, ['Inter', 'Inter', 'Montserrat']);
  expect(fonts).toHaveLength(2);
  expect(fonts[0].bytes.length).toBeGreaterThan(100);
  expect(fonts[0].licenseText).toContain('SIL OPEN FONT LICENSE');
});
it('rejects traversal and missing fonts', async () => {
  await expect(loadPackageFonts('/tmp', ['../secret'])).rejects.toMatchObject({ status: 422 });
  await expect(loadPackageFonts('/tmp/nonexistent-design-fonts', ['Inter'])).rejects.toMatchObject({
    status: 422,
  });
});
