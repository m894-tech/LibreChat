/**
 * Canvas → presentation raster handoff primitive.
 *
 * Packages a validated full-artboard PNG plus version-pinned document refs for a
 * later presentation adapter. This module does not call Presenton (or any network
 * API), does not invent tool names, and never claims the PNG has editable layers.
 *
 * Contract:
 *   - kind is always `'raster'`
 *   - editable is always `false` (flat bitmap; native editability stays on sourceLink)
 *   - PNG MIME/dimensions must match the canonical document artboard
 *   - sourceLink is app-relative `/design?documentId=<id>` only
 *   - returned assetRefs / designSystem are immutable copies (version-pinned)
 */

import sharp from 'sharp';
import { createHash } from 'crypto';
import type { AssetRef, DesignDocument, DesignSystemRef } from './types';
import type { SystemResolver } from './system-resolver';
import { validateDesignRaster as validateAssetRaster, MAX_ASSET_BYTES } from './assets';
import { DesignErrorCodes, designError } from './errors';
import { validateDocument } from './operations';

const PNG_MIME = 'image/png' as const;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PresentationHandoffInput {
  document: DesignDocument;
  png: Buffer;
  sourceLink: string;
}

/**
 * Raster-only handoff payload. Adapters may upload `png` separately; this object
 * carries integrity + provenance metadata only.
 */
export interface PresentationRasterHandoff {
  kind: 'raster';
  revision: number;
  width: number;
  height: number;
  pngSha256: string;
  sourceLink: string;
  /** Flat bitmap export — never editable vector/layer structure. */
  editable: false;
  assetRefs: AssetRef[];
  designSystem: DesignSystemRef;
}

export interface DesignRasterInfo {
  mime: typeof PNG_MIME;
  width: number;
  height: number;
  sha256: string;
}

function schema(message: string): never {
  designError(422, DesignErrorCodes.SCHEMA, message);
}

function isNodeBuffer(value: unknown): value is Buffer {
  return typeof Buffer !== 'undefined' && Buffer.isBuffer(value);
}

function cloneAssetRefs(refs: readonly AssetRef[]): AssetRef[] {
  return refs.map((ref) => ({ assetId: ref.assetId, version: ref.version }));
}

function cloneDesignSystem(ref: DesignSystemRef): DesignSystemRef {
  return { id: ref.id, version: ref.version };
}

/**
 * App-relative design deep-link only: `/design?documentId=<doc.id>`.
 * Rejects absolute URLs, protocol-relative hosts, credentials, fragments, and
 * any extra query parameters.
 */
export function validatePresentationSourceLink(sourceLink: string, documentId: string): string {
  if (typeof sourceLink !== 'string' || sourceLink.length === 0) {
    schema('sourceLink must be a non-empty string');
  }
  if (sourceLink.includes('\\')) {
    schema('sourceLink must be an app-relative /design path');
  }
  if (
    /[a-zA-Z][a-zA-Z0-9+.-]*:/.test(sourceLink) ||
    sourceLink.startsWith('//') ||
    sourceLink.includes('@') ||
    sourceLink.includes('#')
  ) {
    schema('sourceLink must not include a scheme, host, credentials, or fragment');
  }
  if (!sourceLink.startsWith('/design?')) {
    schema('sourceLink must be app-relative /design?documentId=...');
  }

  const query = sourceLink.slice('/design?'.length);
  if (query.length === 0 || query.includes('?')) {
    schema('sourceLink must be app-relative /design?documentId=...');
  }

  const params = new URLSearchParams(query);
  const keys = Array.from(params.keys());
  if (keys.length !== 1 || keys[0] !== 'documentId') {
    schema('sourceLink may only include the documentId query parameter');
  }

  const documentIdParam = params.get('documentId');
  if (documentIdParam === null || documentIdParam.length === 0) {
    schema('sourceLink documentId is required');
  }
  if (documentIdParam !== documentId) {
    schema('sourceLink documentId must match the document id');
  }
  if (documentIdParam !== decodeURIComponent(documentIdParam)) {
    schema('sourceLink documentId must be exact and unescaped');
  }

  return `/design?documentId=${documentId}`;
}

/**
 * Validates that `png` is an image/png whose pixel dimensions equal the artboard.
 * Returns MIME, dimensions, and SHA-256 without mutating the input buffer.
 */
export async function validateDesignRaster(
  png: Buffer,
  artboard: { width: number; height: number },
): Promise<DesignRasterInfo> {
  if (!isNodeBuffer(png)) {
    schema('png must be a Buffer');
  }
  if (png.byteLength > MAX_ASSET_BYTES) schema('PNG exceeds10MiB');
  try {
    await validateAssetRaster({ bytes: png, mime: 'image/png' });
  } catch {
    schema('PNG is corrupt or exceeds raster limits');
  }
  if (png.byteLength < PNG_SIGNATURE.byteLength || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    schema('png must be image/png');
  }

  let format: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  try {
    const metadata = await sharp(png, { failOn: 'error' }).metadata();
    format = metadata.format;
    width = metadata.width;
    height = metadata.height;
  } catch {
    schema('png must be a valid image/png raster');
  }

  if (format !== 'png') {
    schema(`png MIME must be ${PNG_MIME}`);
  }
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height)
  ) {
    schema('png dimensions are required');
  }
  if (width !== artboard.width || height !== artboard.height) {
    schema(
      `png dimensions ${width}x${height} must equal artboard ${artboard.width}x${artboard.height}`,
    );
  }

  const sha256 = createHash('sha256').update(png).digest('hex');
  return {
    mime: PNG_MIME,
    width,
    height,
    sha256,
  };
}

/**
 * Build an immutable raster handoff from a canonical canvas document + PNG export.
 * Does not mutate inputs. Does not emit SVG or claim editable layers.
 */
export async function preparePresentationHandoff(
  input: PresentationHandoffInput,
  resolver?: SystemResolver,
): Promise<PresentationRasterHandoff> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    schema('handoff input must be an object');
  }

  const { document, png, sourceLink } = input;
  validateDocument(document, resolver);

  const safeSourceLink = validatePresentationSourceLink(sourceLink, document.id);
  const raster = await validateDesignRaster(png, {
    width: document.payload.width,
    height: document.payload.height,
  });

  return {
    kind: 'raster',
    revision: document.revision,
    width: raster.width,
    height: raster.height,
    pngSha256: raster.sha256,
    sourceLink: safeSourceLink,
    editable: false,
    assetRefs: cloneAssetRefs(document.assetRefs),
    designSystem: cloneDesignSystem(document.designSystem),
  };
}
