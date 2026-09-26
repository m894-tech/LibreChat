import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { DesignError } from './errors';
export interface PackageFont {
  filename: string;
  bytes: Buffer;
  licenseText: string;
}
const FONT_FILES: Readonly<Record<string, string>> = {
  Inter: 'Inter',
  'IBM Plex Mono': 'IBM-Plex-Mono',
  Montserrat: 'Montserrat',
};
/** Reads only shipped allowlisted font files from operator-configured directory. */
export async function loadPackageFonts(
  directory: string,
  families: readonly string[],
): Promise<PackageFont[]> {
  const fonts: PackageFont[] = [];
  for (const family of new Set(families)) {
    const stem = Object.prototype.hasOwnProperty.call(FONT_FILES, family)
      ? FONT_FILES[family]
      : undefined;
    if (!stem) throw new DesignError(422, 'font_unavailable', 'Document uses an unsupported font');
    let bytes: Buffer, licenseText: string;
    try {
      [bytes, licenseText] = await Promise.all([
        readFile(path.join(directory, stem + '.ttf')),
        readFile(path.join(directory, stem + '-OFL.txt'), 'utf8'),
      ]);
    } catch {
      throw new DesignError(422, 'font_unavailable', 'Required font resources unavailable');
    }
    if (
      bytes.length === 0 ||
      bytes.length > 8 * 1024 * 1024 ||
      !licenseText.includes('SIL OPEN FONT LICENSE')
    )
      throw new DesignError(
        422,
        'font_unavailable',
        'Font package missing valid licence or exceeds limit',
      );
    fonts.push({ filename: stem + '.ttf', bytes, licenseText });
  }
  return fonts;
}
