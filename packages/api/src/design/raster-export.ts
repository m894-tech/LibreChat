import sharp from 'sharp';
import { validateDesignRaster, MAX_ASSET_BYTES } from './assets';
import { DesignError } from './errors';
export interface RasterExport {
  bytes: Buffer;
  mime: string;
  extension: string;
  lossy: boolean;
}
/** Explicit raster-only conversion. Never labelled editable. PNG input validated at full artboard size. */
export async function convertRasterExport(input: {
  png: Buffer;
  width: number;
  height: number;
  format: 'jpeg' | 'webp';
  quality: number;
}): Promise<RasterExport> {
  const metadata = await validateDesignRaster({ bytes: input.png, mime: 'image/png' });
  if (metadata.width !== input.width || metadata.height !== input.height)
    throw new DesignError(422, 'export_dimensions', 'PNG size does not match pinned artboard');
  if (!Number.isInteger(input.quality) || input.quality < 50 || input.quality > 100)
    throw new DesignError(422, 'export_quality', 'Quality must be50..100');
  if (!['jpeg', 'webp'].includes(input.format))
    throw new DesignError(422, 'export_format', 'Unsupported format');
  const image = sharp(input.png, { limitInputPixels: 4096 * 4096 });
  const bytes =
    input.format === 'jpeg'
      ? await image.flatten({ background: '#ffffff' }).jpeg({ quality: input.quality }).toBuffer()
      : await image.webp({ quality: input.quality }).toBuffer();
  if (bytes.length > MAX_ASSET_BYTES)
    throw new DesignError(422, 'export_size', 'Raster export too large');
  return {
    bytes,
    mime: input.format === 'jpeg' ? 'image/jpeg' : 'image/webp',
    extension: input.format === 'jpeg' ? 'jpg' : 'webp',
    lossy: true,
  };
}
