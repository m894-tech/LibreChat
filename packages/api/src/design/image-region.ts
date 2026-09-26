import sharp from 'sharp';
import { DesignError, MAX_ASSET_BYTES, MAX_ASSET_DIMENSION } from './assets';

const LIMIT_INPUT_PIXELS = MAX_ASSET_DIMENSION * MAX_ASSET_DIMENSION;
const ALLOWED_FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp']);

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface SourceCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasNodeGeometry {
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  nodeHeight: number;
  rotationDeg: number;
  crop: SourceCrop;
}

export interface CompositeStrictRegionInput {
  original: Buffer;
  generated: Buffer;
  mask: Buffer;
}

export interface DecodedRgba {
  width: number;
  height: number;
  data: Buffer;
}

function assertFiniteNumber(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DesignError(422, 'VALIDATION', `${label} must be a finite number`);
  }
  return value;
}

function assertPositiveFinite(value: number, label: string): number {
  assertFiniteNumber(value, label);
  if (value <= 0) {
    throw new DesignError(422, 'VALIDATION', `${label} must be positive`);
  }
  return value;
}

function sharpDecodeOptions(): {
  failOn: 'error';
  sequentialRead: true;
  unlimited: false;
  limitInputPixels: number;
} {
  return {
    failOn: 'error',
    sequentialRead: true,
    unlimited: false,
    limitInputPixels: LIMIT_INPUT_PIXELS,
  };
}

function assertBufferWithinLimit(bytes: Buffer, label: string): void {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new DesignError(422, 'VALIDATION', `${label} bytes are required`);
  }
  if (bytes.length > MAX_ASSET_BYTES) {
    throw new DesignError(422, 'VALIDATION', `${label} exceeds 10 MiB limit`);
  }
}

async function readRasterMetadata(
  bytes: Buffer,
  label: string,
): Promise<{ format: string; width: number; height: number; channels: number; space?: string }> {
  assertBufferWithinLimit(bytes, label);

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes, sharpDecodeOptions()).metadata();
  } catch {
    throw new DesignError(422, 'VALIDATION', `${label} could not be decoded`);
  }

  const format = metadata.format ?? '';
  if (!ALLOWED_FORMATS.has(format)) {
    throw new DesignError(422, 'VALIDATION', `${label} must be PNG, JPEG, or WebP`);
  }

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new DesignError(422, 'VALIDATION', `${label} dimensions are invalid`);
  }
  if (width > MAX_ASSET_DIMENSION || height > MAX_ASSET_DIMENSION) {
    throw new DesignError(422, 'VALIDATION', `${label} exceeds 4096px dimension cap`);
  }

  const channels = metadata.channels ?? 0;
  if (!Number.isFinite(channels) || channels < 1) {
    throw new DesignError(422, 'VALIDATION', `${label} channel count is invalid`);
  }

  return {
    format,
    width,
    height,
    channels,
    space: metadata.space,
  };
}

/**
 * Maps a canvas-space point through the inverse of node translate → rotate(top-left pivot) →
 * scale(crop→node) into original source pixel coordinates.
 * Points that fall outside the node rectangle after undoing rotation are rejected.
 */
export function canvasPointToSource(point: CanvasPoint, geometry: CanvasNodeGeometry): CanvasPoint {
  if (point == null || geometry == null || geometry.crop == null) {
    throw new DesignError(422, 'VALIDATION', 'point and geometry are required');
  }

  const px = assertFiniteNumber(point.x, 'point.x');
  const py = assertFiniteNumber(point.y, 'point.y');

  const nodeX = assertFiniteNumber(geometry.nodeX, 'nodeX');
  const nodeY = assertFiniteNumber(geometry.nodeY, 'nodeY');
  const nodeWidth = assertPositiveFinite(geometry.nodeWidth, 'nodeWidth');
  const nodeHeight = assertPositiveFinite(geometry.nodeHeight, 'nodeHeight');
  const rotationDeg = assertFiniteNumber(geometry.rotationDeg, 'rotationDeg');

  const cropX = assertFiniteNumber(geometry.crop.x, 'crop.x');
  const cropY = assertFiniteNumber(geometry.crop.y, 'crop.y');
  const cropWidth = assertPositiveFinite(geometry.crop.width, 'crop.width');
  const cropHeight = assertPositiveFinite(geometry.crop.height, 'crop.height');

  const localX = px - nodeX;
  const localY = py - nodeY;

  if (cropX < 0 || cropY < 0)
    throw new DesignError(422, 'VALIDATION', 'Crop coordinates must be non-negative');
  const radians = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians),
    sin = Math.sin(radians);
  const unrotatedX = localX * cos - localY * sin;
  const unrotatedY = localX * sin + localY * cos;
  if (unrotatedX < 0 || unrotatedY < 0 || unrotatedX > nodeWidth || unrotatedY > nodeHeight) {
    throw new DesignError(422, 'VALIDATION', 'Canvas point falls outside the image node');
  }

  const sourceX = cropX + (unrotatedX / nodeWidth) * cropWidth;
  const sourceY = cropY + (unrotatedY / nodeHeight) * cropHeight;

  if (!Number.isFinite(sourceX) || !Number.isFinite(sourceY)) {
    throw new DesignError(422, 'VALIDATION', 'Mapped source coordinates are invalid');
  }

  return { x: sourceX, y: sourceY };
}

async function decodeRgba(bytes: Buffer, label: string): Promise<DecodedRgba> {
  const meta = await readRasterMetadata(bytes, label);

  let data: Buffer;
  let info: sharp.OutputInfo;
  try {
    const result = await sharp(bytes, sharpDecodeOptions())
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = result.data;
    info = result.info;
  } catch {
    throw new DesignError(422, 'VALIDATION', `${label} could not be decoded to RGBA`);
  }

  if (info.width !== meta.width || info.height !== meta.height || info.channels !== 4) {
    throw new DesignError(422, 'VALIDATION', `${label} RGBA decode mismatch`);
  }
  if (data.length !== meta.width * meta.height * 4) {
    throw new DesignError(422, 'VALIDATION', `${label} RGBA buffer size mismatch`);
  }

  return { width: meta.width, height: meta.height, data };
}

async function decodeMaskLuma(bytes: Buffer, label: string): Promise<DecodedRgba> {
  const meta = await readRasterMetadata(bytes, label);

  if (meta.channels !== 1) {
    throw new DesignError(422, 'VALIDATION', `${label} must be a single-band grayscale raster`);
  }

  let data: Buffer;
  let info: sharp.OutputInfo;
  try {
    const result = await sharp(bytes, sharpDecodeOptions())
      .toColourspace('b-w')
      .raw()
      .toBuffer({ resolveWithObject: true });
    data = result.data;
    info = result.info;
  } catch {
    throw new DesignError(422, 'VALIDATION', `${label} could not be decoded as grayscale`);
  }

  if (info.width !== meta.width || info.height !== meta.height || info.channels !== 1) {
    throw new DesignError(422, 'VALIDATION', `${label} grayscale decode mismatch`);
  }
  if (data.length !== meta.width * meta.height) {
    throw new DesignError(422, 'VALIDATION', `${label} grayscale buffer size mismatch`);
  }

  return { width: meta.width, height: meta.height, data };
}

function blendChannel(original: number, generated: number, mask: number): number {
  if (mask === 0) {
    return original;
  }
  if (mask === 255) {
    return generated;
  }
  return Math.round((original * (255 - mask) + generated * mask) / 255);
}

/**
 * Strict masked composite: mask 0 keeps original RGBA bytes exactly (including alpha 0),
 * mask 255 uses generated, intermediate values linearly blend per channel.
 * Output is lossless PNG. Equality guarantees apply to decoded RGBA, not JPEG file bytes.
 */
export async function compositeStrictRegion(input: CompositeStrictRegionInput): Promise<Buffer> {
  if (input == null) {
    throw new DesignError(422, 'VALIDATION', 'composite input is required');
  }

  const [original, generated, mask] = await Promise.all([
    decodeRgba(input.original, 'original'),
    decodeRgba(input.generated, 'generated'),
    decodeMaskLuma(input.mask, 'mask'),
  ]);

  if (
    original.width !== generated.width ||
    original.height !== generated.height ||
    original.width !== mask.width ||
    original.height !== mask.height
  ) {
    throw new DesignError(422, 'VALIDATION', 'original, generated, and mask dimensions must match');
  }

  const width = original.width;
  const height = original.height;
  const pixelCount = width * height;
  const out = Buffer.allocUnsafe(pixelCount * 4);

  for (let i = 0; i < pixelCount; i += 1) {
    const maskValue = mask.data[i];
    const o = i * 4;
    if (maskValue === 0) {
      out[o] = original.data[o];
      out[o + 1] = original.data[o + 1];
      out[o + 2] = original.data[o + 2];
      out[o + 3] = original.data[o + 3];
      continue;
    }
    if (maskValue === 255) {
      out[o] = generated.data[o];
      out[o + 1] = generated.data[o + 1];
      out[o + 2] = generated.data[o + 2];
      out[o + 3] = generated.data[o + 3];
      continue;
    }
    out[o] = blendChannel(original.data[o], generated.data[o], maskValue);
    out[o + 1] = blendChannel(original.data[o + 1], generated.data[o + 1], maskValue);
    out[o + 2] = blendChannel(original.data[o + 2], generated.data[o + 2], maskValue);
    out[o + 3] = blendChannel(original.data[o + 3], generated.data[o + 3], maskValue);
  }

  try {
    return await sharp(out, {
      raw: { width, height, channels: 4 },
      limitInputPixels: LIMIT_INPUT_PIXELS,
    })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer();
  } catch {
    throw new DesignError(422, 'VALIDATION', 'Failed to encode composite PNG');
  }
}
