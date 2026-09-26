/**
 * Canonical canvas → SVG exporter.
 *
 * Emits an editable SVG for allowlisted design nodes (rect/ellipse/text/group as
 * native vector/text; image nodes remain embedded rasters). Does not claim Konva
 * text-wrapping parity — callers receive explicit warnings.
 *
 * Asset bytes are supplied by an actor-provided loader (storage/ACL resolved
 * outside this module). This file does not fetch network URLs.
 */

import sharp from 'sharp';
import type {
  CropRect,
  DesignDocument,
  DesignNode,
  FontStyle,
  NodeProps,
  TextAlign,
} from './types';
import type { SystemResolver } from './system-resolver';
import { DesignErrorCodes, designError } from './errors';
import { validateDesignRaster } from './assets';
import { validateDocument } from './operations';

/** Structural subset of `./assets` AssetBytes used by the actor-provided loader. */
export interface CanvasSVGAssetBytes {
  bytes: Buffer;
  mime: string;
  id?: string;
  version?: number;
  size?: number;
  filename?: string;
}

/** Export-time embedded raster ceiling (bytes). Distinct from upload quota. */
export const SVG_EXPORT_MAX_ASSET_BYTES: number = 20 * 1024 * 1024;

const ALLOWED_RASTER_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'] as const);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TEXT_WRAP_WARNING =
  'Text layout/wrapping may differ from Konva canvas rendering; tspans are line-split only, not wrapped.';

/**
 * Actor-provided loader. Implementations typically wrap AssetStore.getBytes.
 * Width/height may be omitted; the exporter measures validated raster bytes.
 */
export type CanvasSVGLoadAsset = (assetId: string, version: number) => Promise<CanvasSVGAssetBytes>;

export interface CanvasSVGExportResult {
  svg: string;
  warnings: string[];
  editable: true;
}

interface RasterEmbed {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  dataUri: string;
}

function schema(message: string): never {
  designError(422, DesignErrorCodes.SCHEMA, message);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    schema('non-finite numeric value in SVG export');
  }
  if (Object.is(value, -0)) {
    return '0';
  }
  return String(value);
}

function sniffRasterMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

async function validateEmbeddedRaster(bytes: Buffer, claimedMime: string): Promise<RasterEmbed> {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    schema('image asset bytes must be a non-empty Buffer');
  }
  if (bytes.length > SVG_EXPORT_MAX_ASSET_BYTES) {
    designError(
      429,
      DesignErrorCodes.QUOTA,
      `image asset exceeds ${SVG_EXPORT_MAX_ASSET_BYTES} byte export limit`,
    );
  }
  const sniffed = sniffRasterMime(bytes);
  if (!sniffed || !ALLOWED_RASTER_MIME.has(sniffed)) {
    schema('image asset must be a validated PNG, JPEG, or WebP raster');
  }
  if (typeof claimedMime !== 'string' || claimedMime !== sniffed) {
    schema(`image asset mime must match sniffed raster type (${sniffed})`);
  }

  let width = 0;
  let height = 0;
  try {
    await validateDesignRaster({ bytes, mime: claimedMime });
    const metadata = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: 4096 * 4096,
    }).metadata();
    width = metadata.width ?? 0;
    height = metadata.height ?? 0;
    const format = metadata.format;
    if (
      (sniffed === 'image/png' && format !== 'png') ||
      (sniffed === 'image/jpeg' && format !== 'jpeg') ||
      (sniffed === 'image/webp' && format !== 'webp')
    ) {
      schema('image asset failed raster format validation');
    }
  } catch {
    schema('image asset must be a valid raster');
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    schema('image asset must report positive pixel dimensions');
  }

  return {
    mime: sniffed,
    width,
    height,
    dataUri: `data:${sniffed};base64,${bytes.toString('base64')}`,
  };
}

function fontStyleAttrs(style: FontStyle | undefined): string {
  const resolved: FontStyle = style ?? 'normal';
  const italic = resolved === 'italic' || resolved === 'bold-italic';
  const bold = resolved === 'bold' || resolved === 'bold-italic';
  return ` font-style="${italic ? 'italic' : 'normal'}" font-weight="${bold ? 'bold' : 'normal'}"`;
}

function textAnchor(align: TextAlign | undefined): string {
  if (align === 'center') {
    return 'middle';
  }
  if (align === 'right') {
    return 'end';
  }
  return 'start';
}

function textX(props: NodeProps): number {
  if (props.align === 'center') {
    return props.width / 2;
  }
  if (props.align === 'right') {
    return props.width;
  }
  return 0;
}

function nodeTransform(props: NodeProps): string {
  const parts = [`translate(${formatNumber(props.x)} ${formatNumber(props.y)})`];
  if (props.rotation !== 0) {
    parts.push(`rotate(${formatNumber(props.rotation)})`);
  }
  return parts.join(' ');
}

function opacityAttr(opacity: number): string {
  if (opacity === 1) {
    return '';
  }
  return ` opacity="${formatNumber(opacity)}"`;
}

function openGroup(props: NodeProps, extra = ''): string {
  return `<g transform="${nodeTransform(props)}"${opacityAttr(props.opacity)}${extra}>`;
}

function renderRect(props: NodeProps): string {
  const fill = props.fill !== undefined ? ` fill="${escapeXml(props.fill)}"` : ' fill="none"';
  const stroke =
    props.stroke !== undefined ? ` stroke="${escapeXml(props.stroke)}"` : ' stroke="none"';
  const strokeWidth =
    props.strokeWidth !== undefined ? ` stroke-width="${formatNumber(props.strokeWidth)}"` : '';
  return (
    `${openGroup(props)}` +
    `<rect x="0" y="0" width="${formatNumber(props.width)}" height="${formatNumber(props.height)}"${fill}${stroke}${strokeWidth}/>` +
    `</g>`
  );
}

function renderEllipse(props: NodeProps): string {
  const cx = props.width / 2;
  const cy = props.height / 2;
  const rx = props.width / 2;
  const ry = props.height / 2;
  const fill = props.fill !== undefined ? ` fill="${escapeXml(props.fill)}"` : ' fill="none"';
  const stroke =
    props.stroke !== undefined ? ` stroke="${escapeXml(props.stroke)}"` : ' stroke="none"';
  const strokeWidth =
    props.strokeWidth !== undefined ? ` stroke-width="${formatNumber(props.strokeWidth)}"` : '';
  return (
    `${openGroup(props)}` +
    `<ellipse cx="${formatNumber(cx)}" cy="${formatNumber(cy)}" rx="${formatNumber(rx)}" ry="${formatNumber(ry)}"${fill}${stroke}${strokeWidth}/>` +
    `</g>`
  );
}

function renderText(props: NodeProps): string {
  const raw = props.text ?? '';
  const fontSize = props.fontSize ?? 14;
  const fontFamily = props.fontFamily ?? 'Inter';
  const fill = props.fill ?? '#000000';
  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    schema('text fontSize must be a positive finite number');
  }
  const lines = raw.split('\n');
  const anchor = textAnchor(props.align);
  const x = textX(props);
  const tspans = lines
    .map((line, index) => {
      const dy = index === 0 ? formatNumber(fontSize) : formatNumber(fontSize);
      return `<tspan x="${formatNumber(x)}" dy="${dy}">${escapeXml(line)}</tspan>`;
    })
    .join('');
  return (
    `${openGroup(props)}` +
    `<text x="${formatNumber(x)}" y="0"` +
    ` font-family="${escapeXml(fontFamily)}"` +
    ` font-size="${formatNumber(fontSize)}"` +
    ` fill="${escapeXml(fill)}"` +
    ` text-anchor="${anchor}"` +
    `${fontStyleAttrs(props.fontStyle)}` +
    `>${tspans}</text>` +
    `</g>`
  );
}

function renderImage(props: NodeProps, raster: RasterEmbed): string {
  const crop: CropRect | undefined = props.crop;
  let inner: string;
  if (crop) {
    if (
      crop.x < 0 ||
      crop.y < 0 ||
      crop.width <= 0 ||
      crop.height <= 0 ||
      crop.x + crop.width > raster.width ||
      crop.y + crop.height > raster.height
    )
      schema('Crop outside embedded raster bounds');
    inner =
      `<svg width="${formatNumber(props.width)}" height="${formatNumber(props.height)}"` +
      ` viewBox="${formatNumber(crop.x)} ${formatNumber(crop.y)} ${formatNumber(crop.width)} ${formatNumber(crop.height)}"` +
      ` preserveAspectRatio="none">` +
      `<image width="${formatNumber(raster.width)}" height="${formatNumber(raster.height)}"` +
      ` href="${raster.dataUri}" />` +
      `</svg>`;
  } else {
    inner =
      `<image x="0" y="0" width="${formatNumber(props.width)}" height="${formatNumber(props.height)}"` +
      ` href="${raster.dataUri}" preserveAspectRatio="none" />`;
  }
  return `${openGroup(props)}${inner}</g>`;
}

/**
 * Export a validated canonical canvas document to SVG.
 * Returns editable vector/text markup plus honest layout warnings.
 */
export async function exportCanvasSVG(
  doc: DesignDocument,
  loadAsset: CanvasSVGLoadAsset,
  resolver?: SystemResolver,
): Promise<CanvasSVGExportResult> {
  if (typeof loadAsset !== 'function') {
    schema('loadAsset must be a function');
  }
  validateDocument(doc, resolver);

  const warnings: string[] = [];
  const nodes = doc.payload.nodes;
  const byParent = new Map<string | null, DesignNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }

  const rasterCache = new Map<string, RasterEmbed>();

  async function loadRaster(assetId: string, version: number): Promise<RasterEmbed> {
    const key = `${assetId}@${version}`;
    const cached = rasterCache.get(key);
    if (cached) {
      return cached;
    }
    let payload: Awaited<ReturnType<CanvasSVGLoadAsset>>;
    try {
      payload = await loadAsset(assetId, version);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'asset load failed';
      designError(404, DesignErrorCodes.NOT_FOUND, `missing asset ref ${key}: ${message}`);
    }
    if (!payload || !Buffer.isBuffer(payload.bytes)) {
      designError(404, DesignErrorCodes.NOT_FOUND, `missing asset ref ${key}`);
    }
    const embed = await validateEmbeddedRaster(payload.bytes, payload.mime);
    rasterCache.set(key, embed);
    return embed;
  }

  async function renderNode(node: DesignNode): Promise<string> {
    switch (node.type) {
      case 'rect':
        return renderRect(node.props);
      case 'ellipse':
        return renderEllipse(node.props);
      case 'text':
        if (!warnings.includes(TEXT_WRAP_WARNING)) {
          warnings.push(TEXT_WRAP_WARNING);
        }
        return renderText(node.props);
      case 'image': {
        const assetId = node.props.assetId;
        const version = node.props.assetVersion;
        if (assetId === undefined || version === undefined) {
          schema(`image "${node.id}" requires assetId and assetVersion`);
        }
        const raster = await loadRaster(assetId, version);
        return renderImage(node.props, raster);
      }
      case 'group': {
        const children = byParent.get(node.id) ?? [];
        const childMarkup: string[] = [];
        for (const child of children) {
          childMarkup.push(await renderNode(child));
        }
        return `${openGroup(node.props)}${childMarkup.join('')}</g>`;
      }
      default:
        schema(`unsupported node type`);
    }
  }

  const roots = byParent.get(null) ?? [];
  const bodyParts: string[] = [];
  for (const root of roots) {
    bodyParts.push(await renderNode(root));
  }

  const width = doc.payload.width;
  const height = doc.payload.height;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${formatNumber(width)}" height="${formatNumber(height)}"` +
    ` viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}">` +
    `${bodyParts.join('')}` +
    `</svg>`;

  if (/<script[\s>]/i.test(svg) || /foreignObject/i.test(svg) || /javascript:/i.test(svg)) {
    schema('SVG export produced forbidden content');
  }

  const result: CanvasSVGExportResult = {
    svg,
    warnings,
    editable: true,
  };
  return result;
}
