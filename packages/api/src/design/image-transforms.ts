import sharp from 'sharp';
import { validateDesignRaster } from './assets';
import { DesignError } from './errors';
export interface ExpandedImage {
  original: Buffer;
  mask: Buffer;
  offset: { x: number; y: number };
  width: number;
  height: number;
}
/** Transparent canvas expansion + white-outside grayscale mask for an inpaint backend.
 * Exact center source decoded RGBA bytes preserved. This alone is not AI outpaint.
 */
export async function prepareOutpaint(input: {
  bytes: Buffer;
  mime: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}): Promise<ExpandedImage> {
  const meta = await validateDesignRaster({ bytes: input.bytes, mime: input.mime });
  for (const v of [input.left, input.right, input.top, input.bottom])
    if (!Number.isInteger(v) || v < 0 || v > 2048)
      throw new DesignError(422, 'outpaint_padding', 'Padding must be0..2048pixels');
  const width = meta.width + input.left + input.right,
    height = meta.height + input.top + input.bottom;
  if (width > 4096 || height > 4096 || (width === meta.width && height === meta.height))
    throw new DesignError(422, 'outpaint_size', 'Expansion must be nonempty and at most4096');
  const decoded = await sharp(input.bytes, { limitInputPixels: 4096 * 4096 })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer();
  const rgba = Buffer.alloc(width * height * 4),
    mask = Buffer.alloc(width * height, 255);
  for (let y = 0; y < meta.height; y++) {
    decoded.copy(
      rgba,
      ((y + input.top) * width + input.left) * 4,
      y * meta.width * 4,
      (y + 1) * meta.width * 4,
    );
    mask.fill(
      0,
      (y + input.top) * width + input.left,
      (y + input.top) * width + input.left + meta.width,
    );
  }
  return {
    original: await sharp(rgba, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    mask: await sharp(mask, { raw: { width, height, channels: 1 } })
      .toColourspace('b-w')
      .png()
      .toBuffer(),
    offset: { x: input.left, y: input.top },
    width,
    height,
  };
}
/** Classical Lanczos resampling. Labelled non-AI; never promises hallucinated detail recovery. */
export async function resizeRaster(input: {
  bytes: Buffer;
  mime: string;
  scale: 2 | 4;
}): Promise<Buffer> {
  const meta = await validateDesignRaster({ bytes: input.bytes, mime: input.mime });
  if (input.scale !== 2 && input.scale !== 4)
    throw new DesignError(422, 'resize_scale', 'Supported scale2or4');
  if (meta.width * input.scale > 4096 || meta.height * input.scale > 4096)
    throw new DesignError(422, 'resize_size', 'Output exceeds4096');
  const result = await sharp(input.bytes, { limitInputPixels: 4096 * 4096 })
    .resize(meta.width * input.scale, meta.height * input.scale, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  if (result.length > 10 * 1024 * 1024)
    throw new DesignError(422, 'resize_bytes', 'Output exceeds10MiB');
  return result;
}
