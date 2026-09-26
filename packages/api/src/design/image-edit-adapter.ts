import sharp from 'sharp';
import { DesignError, MAX_ASSET_BYTES, MAX_ASSET_DIMENSION, validateDesignRaster } from './assets';
import { compositeStrictRegion } from './image-region';
import { ProviderUncertainError } from './providers';

/** @public */
export const IMAGE_EDIT_MAX_RESPONSE_BYTES: number = 16 * 1024 * 1024;
/** @public */
export const IMAGE_EDIT_TIMEOUT_MS: number = 90_000;
/** @public */
export const IMAGE_EDIT_MAX_PROMPT_LENGTH: number = 8000;
/** @public */
export const IMAGE_EDIT_PATH: string = 'images/edits';
/** @public */
export const IMAGE_EDIT_RESPONSE_FORMAT: 'b64_json' = 'b64_json';

const LIMIT_INPUT_PIXELS = MAX_ASSET_DIMENSION * MAX_ASSET_DIMENSION;
const PNG_MAGIC: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ImageEditFetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export type ResolveImageEditCredential = (principal: string) => Promise<string | null>;

export interface ImageEditAdapterConfig {
  model: string;
  baseURL: string;
  allowedOrigins: readonly string[];
  resolveCredential: ResolveImageEditCredential;
  fetchImpl: ImageEditFetchImpl;
}

export interface ImageEditInpaintInput {
  principalId: string;
  jobId: string;
  prompt: string;
  original: Buffer;
  mask: Buffer;
}

export interface ImageEditAdapter {
  inpaint(input: ImageEditInpaintInput): Promise<Buffer>;
}

interface ImageEditDatum {
  b64_json?: unknown;
  url?: unknown;
}

interface ImageEditResponse {
  data?: ImageEditDatum[];
}

interface ValidatedRaster {
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}

interface DecodedMaskLuma {
  width: number;
  height: number;
  data: Buffer;
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

/** @public */
export function createImageEditAdapter(config: ImageEditAdapterConfig): ImageEditAdapter {
  const resolved: ImageEditAdapterConfig = assertAdapterConfig(config);
  const editsURL: string = buildEditsURL(resolved.baseURL, resolved.allowedOrigins);

  const adapter: ImageEditAdapter = {
    async inpaint(input: ImageEditInpaintInput): Promise<Buffer> {
      return submitInpaint(resolved, editsURL, input);
    },
  };
  return adapter;
}

function assertAdapterConfig(config: ImageEditAdapterConfig): ImageEditAdapterConfig {
  if (!config || typeof config !== 'object') {
    throw new DesignError(422, 'VALIDATION', 'Image edit adapter config is required');
  }
  if (typeof config.model !== 'string' || config.model.trim().length === 0) {
    throw new DesignError(422, 'VALIDATION', 'model is required');
  }
  if (typeof config.resolveCredential !== 'function') {
    throw new DesignError(422, 'VALIDATION', 'resolveCredential is required');
  }
  if (typeof config.fetchImpl !== 'function') {
    throw new DesignError(422, 'VALIDATION', 'fetchImpl is required');
  }
  if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.length === 0) {
    throw new DesignError(422, 'VALIDATION', 'allowedOrigins is required');
  }
  const allowedOrigins: readonly string[] = Object.freeze(
    config.allowedOrigins.map((origin: string): string => {
      if (typeof origin !== 'string' || origin.trim().length === 0) {
        throw new DesignError(422, 'VALIDATION', 'allowedOrigins must be exact https origins');
      }
      return origin;
    }),
  );
  assertSafeBaseURL(config.baseURL, allowedOrigins);
  const resolved: ImageEditAdapterConfig = {
    model: config.model,
    baseURL: config.baseURL,
    allowedOrigins,
    resolveCredential: config.resolveCredential,
    fetchImpl: config.fetchImpl,
  };
  return resolved;
}

function assertSafeBaseURL(baseURL: string, allowedOrigins: readonly string[]): URL {
  if (typeof baseURL !== 'string' || baseURL.trim().length === 0) {
    throw new DesignError(422, 'VALIDATION', 'baseURL is required');
  }
  let parsed: URL;
  try {
    parsed = new URL(baseURL);
  } catch {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL is invalid');
  }
  if (parsed.protocol !== 'https:') {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must be https');
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must not embed credentials');
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must not include search or hash');
  }
  if (!allowedOrigins.includes(parsed.origin)) {
    throw new DesignError(422, 'VALIDATION', 'Provider origin is not allowed');
  }
  return parsed;
}

function buildEditsURL(baseURL: string, allowedOrigins: readonly string[]): string {
  const parsed: URL = assertSafeBaseURL(baseURL, allowedOrigins);
  const normalizedBase: string = parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`;
  const edits: URL = new URL(IMAGE_EDIT_PATH, normalizedBase);
  if (edits.protocol !== 'https:') {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must be https');
  }
  if (edits.username.length > 0 || edits.password.length > 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must not embed credentials');
  }
  if (edits.search.length > 0 || edits.hash.length > 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must not include search or hash');
  }
  if (!allowedOrigins.includes(edits.origin) || edits.origin !== parsed.origin) {
    throw new DesignError(422, 'VALIDATION', 'Provider origin is not allowed');
  }
  return edits.href;
}

async function submitInpaint(
  config: ImageEditAdapterConfig,
  editsURL: string,
  input: ImageEditInpaintInput,
): Promise<Buffer> {
  if (!input || typeof input !== 'object') {
    throw new DesignError(422, 'VALIDATION', 'inpaint input is required');
  }
  if (typeof input.principalId !== 'string' || input.principalId.length === 0) {
    throw new DesignError(422, 'VALIDATION', 'principalId is required');
  }
  if (typeof input.jobId !== 'string' || input.jobId.length === 0) {
    throw new DesignError(422, 'VALIDATION', 'jobId is required');
  }

  const prompt: string = assertPrompt(input.prompt);
  const originalBytes: Buffer = assertBuffer(input.original, 'original');
  const maskBytes: Buffer = assertBuffer(input.mask, 'mask');

  assertSafeBaseURL(config.baseURL, config.allowedOrigins);
  const endpoint: string = buildEditsURL(config.baseURL, config.allowedOrigins);
  if (endpoint !== editsURL) {
    throw new DesignError(422, 'VALIDATION', 'Provider origin is not allowed');
  }

  const originalMeta: ValidatedRaster = await validateSourceRaster(originalBytes);
  const maskLuma: DecodedMaskLuma = await decodeOpaqueGrayscaleMask(maskBytes);
  if (maskLuma.width !== originalMeta.width || maskLuma.height !== originalMeta.height) {
    throw new DesignError(422, 'VALIDATION', 'mask dimensions must match original');
  }

  const sourcePng: Buffer = await convertSourceToPng(originalBytes);
  const apiMaskPng: Buffer = await convertMaskWhiteToTransparentAlpha(
    maskLuma,
    originalMeta.width,
    originalMeta.height,
  );

  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
    controller.abort();
  }, IMAGE_EDIT_TIMEOUT_MS);
  let attemptedSend: boolean = false;

  try {
    const credential: string | null = await Promise.race([
      config.resolveCredential(input.principalId),
      abortAsTimeout(controller.signal),
    ]);
    if (typeof credential !== 'string' || credential.length === 0) {
      throw new DesignError(401, 'UNAUTHORIZED', 'Provider credential is unavailable');
    }
    if (controller.signal.aborted) {
      throw new DesignError(504, 'TIMEOUT', 'Provider request timed out');
    }

    const form: FormData = new FormData();
    form.append('image', new Blob([toBlobPart(sourcePng)], { type: 'image/png' }), 'image.png');
    form.append('mask', new Blob([toBlobPart(apiMaskPng)], { type: 'image/png' }), 'mask.png');
    form.append('model', config.model);
    form.append('prompt', prompt);
    form.append('n', '1');
    form.append('response_format', IMAGE_EDIT_RESPONSE_FORMAT);

    attemptedSend = true;
    let response: Response;
    try {
      response = await Promise.race([
        config.fetchImpl(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${credential}`,
            Accept: 'application/json',
          },
          body: form,
        }),
        abortAsTimeout(controller.signal),
      ]);
    } catch (error: unknown) {
      throw toUncertainError(error);
    }

    const raw: string = await readBoundedBody(response, controller.signal);
    if (!response.ok) {
      throw new DesignError(502, 'PROVIDER_ERROR', 'Provider request failed');
    }

    const generatedBytes: Buffer = decodeCanonicalBase64(extractB64Json(raw));
    if (generatedBytes.length > MAX_ASSET_BYTES) {
      throw new DesignError(422, 'VALIDATION', 'Asset exceeds 10 MiB limit');
    }
    const generatedMime: 'image/png' | 'image/jpeg' | 'image/webp' | null =
      sniffRasterMime(generatedBytes);
    if (!generatedMime) {
      throw new DesignError(422, 'VALIDATION', 'File magic does not match PNG, JPEG, or WebP');
    }
    const generatedMeta: ValidatedRaster = await validateDesignRaster({
      bytes: generatedBytes,
      mime: generatedMime,
    });
    if (
      generatedMeta.width !== originalMeta.width ||
      generatedMeta.height !== originalMeta.height
    ) {
      throw new DesignError(422, 'VALIDATION', 'generated image dimensions must match original');
    }

    const composited: Buffer = await compositeStrictRegion({
      original: originalBytes,
      generated: generatedBytes,
      mask: maskBytes,
    });
    return composited;
  } catch (error: unknown) {
    if (error instanceof DesignError || error instanceof ProviderUncertainError) {
      throw error;
    }
    if (attemptedSend) {
      throw toUncertainError(error);
    }
    if (isAbortLike(error)) {
      throw new DesignError(504, 'TIMEOUT', 'Provider request timed out');
    }
    throw new DesignError(422, 'VALIDATION', 'Provider submission failed');
  } finally {
    clearTimeout(timer);
  }
}

function assertPrompt(prompt: unknown): string {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new DesignError(422, 'VALIDATION', 'prompt is required');
  }
  if (prompt.length > IMAGE_EDIT_MAX_PROMPT_LENGTH) {
    throw new DesignError(422, 'VALIDATION', 'prompt exceeds 8000 characters');
  }
  return prompt;
}

function toBlobPart(bytes: Buffer): BlobPart {
  return Uint8Array.from(bytes).buffer;
}
function assertBuffer(bytes: unknown, label: string): Buffer {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new DesignError(422, 'VALIDATION', `${label} bytes are required`);
  }
  if (bytes.length > MAX_ASSET_BYTES) {
    throw new DesignError(422, 'VALIDATION', `${label} exceeds 10 MiB limit`);
  }
  return bytes;
}

async function validateSourceRaster(bytes: Buffer): Promise<ValidatedRaster> {
  const mime: 'image/png' | 'image/jpeg' | 'image/webp' | null = sniffRasterMime(bytes);
  if (!mime) {
    throw new DesignError(422, 'VALIDATION', 'File magic does not match PNG, JPEG, or WebP');
  }
  return validateDesignRaster({ bytes, mime });
}

async function decodeOpaqueGrayscaleMask(bytes: Buffer): Promise<DecodedMaskLuma> {
  assertBuffer(bytes, 'mask');

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes, sharpDecodeOptions()).metadata();
  } catch {
    throw new DesignError(422, 'VALIDATION', 'mask could not be decoded');
  }

  const format: string = metadata.format ?? '';
  if (format !== 'png' && format !== 'jpeg' && format !== 'jpg' && format !== 'webp') {
    throw new DesignError(422, 'VALIDATION', 'mask must be PNG, JPEG, or WebP');
  }

  const width: number = metadata.width ?? 0;
  const height: number = metadata.height ?? 0;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new DesignError(422, 'VALIDATION', 'mask dimensions are invalid');
  }
  if (width > MAX_ASSET_DIMENSION || height > MAX_ASSET_DIMENSION) {
    throw new DesignError(422, 'VALIDATION', 'mask exceeds 4096px dimension cap');
  }

  const channels: number = metadata.channels ?? 0;
  if (channels !== 1) {
    throw new DesignError(422, 'VALIDATION', 'mask must be an opaque single-band grayscale raster');
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
    throw new DesignError(422, 'VALIDATION', 'mask could not be decoded as grayscale');
  }

  if (info.width !== width || info.height !== height || info.channels !== 1) {
    throw new DesignError(422, 'VALIDATION', 'mask grayscale decode mismatch');
  }
  if (data.length !== width * height) {
    throw new DesignError(422, 'VALIDATION', 'mask grayscale buffer size mismatch');
  }

  return { width, height, data };
}

/**
 * OpenAI-style edits mask: alpha 0 marks the region to edit.
 * White (selected) in the opaque grayscale mask becomes fully transparent.
 */
async function convertMaskWhiteToTransparentAlpha(
  mask: DecodedMaskLuma,
  width: number,
  height: number,
): Promise<Buffer> {
  const pixelCount: number = width * height;
  const rgba: Buffer = Buffer.alloc(pixelCount * 4);
  for (let i = 0; i < pixelCount; i += 1) {
    const o: number = i * 4;
    const luma: number = mask.data[i];
    rgba[o] = 0;
    rgba[o + 1] = 0;
    rgba[o + 2] = 0;
    rgba[o + 3] = 255 - luma;
  }

  try {
    return await sharp(rgba, {
      raw: { width, height, channels: 4 },
      limitInputPixels: LIMIT_INPUT_PIXELS,
    })
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer();
  } catch {
    throw new DesignError(422, 'VALIDATION', 'Failed to encode API mask PNG');
  }
}

async function convertSourceToPng(bytes: Buffer): Promise<Buffer> {
  try {
    return await sharp(bytes, sharpDecodeOptions())
      .png({ compressionLevel: 9, adaptiveFiltering: false })
      .toBuffer();
  } catch {
    throw new DesignError(422, 'VALIDATION', 'Failed to convert source image to PNG');
  }
}

function abortAsTimeout(signal: AbortSignal): Promise<never> {
  const promise: Promise<never> = new Promise((_, reject: (reason: Error) => void): void => {
    const rejectTimeout = (): void => {
      const error: Error = new Error('Provider request timed out');
      error.name = 'TimeoutError';
      reject(error);
    };
    if (signal.aborted) {
      rejectTimeout();
      return;
    }
    signal.addEventListener('abort', rejectTimeout, { once: true });
  });
  return promise;
}

function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate: { name?: unknown } = error as { name?: unknown };
  return candidate.name === 'AbortError' || candidate.name === 'TimeoutError';
}

function toUncertainError(_error: unknown): ProviderUncertainError {
  return new ProviderUncertainError('Provider submission state is unknown');
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) {
    throw new ProviderUncertainError('Provider submission state is unknown');
  }
  const body: ReadableStream<Uint8Array> | null = response.body;
  if (body && typeof body.getReader === 'function') {
    return readStreamBytes(body, signal);
  }
  const fallback: ArrayBuffer = await Promise.race([
    response.arrayBuffer(),
    abortAsTimeout(signal),
  ]);
  if (fallback.byteLength > IMAGE_EDIT_MAX_RESPONSE_BYTES) {
    throw new DesignError(422, 'VALIDATION', 'Provider response exceeded size limit');
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(fallback));
}

async function readStreamBytes(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<string> {
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const chunks: Uint8Array[] = [];
  let total: number = 0;
  try {
    for (;;) {
      if (signal.aborted) {
        throw new ProviderUncertainError('Provider submission state is unknown');
      }
      const step: ReadableStreamReadResult<Uint8Array> = await Promise.race([
        reader.read(),
        abortAsTimeout(signal),
      ]);
      if (step.done) {
        break;
      }
      const chunk: Uint8Array = step.value;
      total += chunk.byteLength;
      if (total > IMAGE_EDIT_MAX_RESPONSE_BYTES) {
        throw new DesignError(422, 'VALIDATION', 'Provider response exceeded size limit');
      }
      chunks.push(chunk);
    }
  } finally {
    void reader.cancel().catch((): void => undefined);
  }
  return new TextDecoder('utf-8').decode(concatBytes(chunks, total));
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out: Uint8Array = new Uint8Array(total);
  let offset: number = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function extractB64Json(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DesignError(422, 'VALIDATION', 'Provider response is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DesignError(422, 'VALIDATION', 'Provider response is not a JSON object');
  }
  const payload: ImageEditResponse = parsed as ImageEditResponse;
  const data: ImageEditDatum[] | undefined = payload.data;
  if (!Array.isArray(data) || data.length === 0 || data[0] == null || typeof data[0] !== 'object') {
    throw new DesignError(422, 'VALIDATION', 'Provider response is missing image data');
  }
  const first: ImageEditDatum = data[0];
  const encoded: unknown = first.b64_json;
  if (typeof encoded === 'string' && encoded.length > 0) {
    return encoded;
  }
  if (typeof first.url === 'string' && first.url.length > 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider response did not include image bytes');
  }
  throw new DesignError(422, 'VALIDATION', 'Provider response is missing image data');
}

function decodeCanonicalBase64(encoded: string): Buffer {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider response is missing image data');
  }
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new DesignError(422, 'VALIDATION', 'Provider response is not canonical base64');
  }
  const padding: number = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  if (encoded.slice(0, encoded.length - padding).includes('=')) {
    throw new DesignError(422, 'VALIDATION', 'Provider response is not canonical base64');
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(encoded, 'base64');
  } catch {
    throw new DesignError(422, 'VALIDATION', 'Provider response is not canonical base64');
  }
  if (decoded.length === 0 || decoded.toString('base64') !== encoded) {
    throw new DesignError(422, 'VALIDATION', 'Provider response is not canonical base64');
  }
  return decoded;
}

function sniffRasterMime(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_MAGIC)) {
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
