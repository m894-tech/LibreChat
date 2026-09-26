import {
  ProviderUncertainError,
  type DesignGenerationProvider,
  type ProviderSubmitInput,
  type ProviderSubmitResult,
} from './providers';
import { DesignError, MAX_ASSET_BYTES, validateDesignRaster } from './assets';

/** @public */
export const IMAGE_GENERATION_MAX_RESPONSE_BYTES: number = 16 * 1024 * 1024;
/** @public */
export const IMAGE_GENERATION_TIMEOUT_MS: number = 90_000;
/** @public */
export const IMAGE_GENERATION_MAX_PROMPT_LENGTH: number = 8000;
/** @public */
export const IMAGE_GENERATION_PATH: string = 'images/generations';
/** @public */
export const IMAGE_GENERATION_SIZE: '1024x1024' = '1024x1024';
/** @public */
export const IMAGE_GENERATION_RESPONSE_FORMAT: 'b64_json' = 'b64_json';

export type ImageGenerationFetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export type ResolveImageCredential = (principal: string) => Promise<string | null>;

export interface ImageGenerationAdapterConfig {
  enabled: boolean;
  model: string;
  baseURL: string;
  allowedOrigins: readonly string[];
  resolveCredential: ResolveImageCredential;
  fetchImpl: ImageGenerationFetchImpl;
}

interface ImagesGenerationsRequestBody {
  model: string;
  prompt: string;
  n: 1;
  size: '1024x1024';
  response_format: 'b64_json';
}

interface ImageGenerationDatum {
  b64_json?: unknown;
  url?: unknown;
}

interface ImageGenerationResponse {
  data?: ImageGenerationDatum[];
}

/** @public */
export function createImageGenerationAdapter(
  config: ImageGenerationAdapterConfig,
): DesignGenerationProvider {
  const resolved: ImageGenerationAdapterConfig = assertAdapterConfig(config);
  const generationsURL: string = buildGenerationsURL(resolved.baseURL, resolved.allowedOrigins);

  const provider: DesignGenerationProvider = {
    capabilities: {
      imageGeneration: resolved.enabled,
      textProposal: false,
    },
    async submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult> {
      return submitImageGeneration(resolved, generationsURL, input);
    },
  };
  return provider;
}

function assertAdapterConfig(config: ImageGenerationAdapterConfig): ImageGenerationAdapterConfig {
  if (!config || typeof config !== 'object') {
    throw new DesignError(422, 'VALIDATION', 'Image generation adapter config is required');
  }
  if (typeof config.enabled !== 'boolean') {
    throw new DesignError(422, 'VALIDATION', 'enabled must be a boolean');
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
  const resolved: ImageGenerationAdapterConfig = {
    enabled: config.enabled,
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

function buildGenerationsURL(baseURL: string, allowedOrigins: readonly string[]): string {
  const parsed: URL = assertSafeBaseURL(baseURL, allowedOrigins);
  const normalizedBase: string = parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`;
  const generations: URL = new URL(IMAGE_GENERATION_PATH, normalizedBase);
  if (generations.protocol !== 'https:') {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must be https');
  }
  if (generations.username.length > 0 || generations.password.length > 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must not embed credentials');
  }
  if (generations.search.length > 0 || generations.hash.length > 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must not include search or hash');
  }
  if (!allowedOrigins.includes(generations.origin) || generations.origin !== parsed.origin) {
    throw new DesignError(422, 'VALIDATION', 'Provider origin is not allowed');
  }
  return generations.href;
}

async function submitImageGeneration(
  config: ImageGenerationAdapterConfig,
  generationsURL: string,
  input: ProviderSubmitInput,
): Promise<ProviderSubmitResult> {
  if (!config.enabled) {
    throw new DesignError(422, 'CAPABILITY_UNAVAILABLE', 'Design generation provider is disabled');
  }
  if (input.capability !== 'imageGeneration') {
    throw new DesignError(422, 'CAPABILITY_UNAVAILABLE', 'Text proposal is unavailable');
  }

  const prompt: string = extractPrompt(input.payload);
  assertSafeBaseURL(config.baseURL, config.allowedOrigins);
  const endpoint: string = buildGenerationsURL(config.baseURL, config.allowedOrigins);
  if (endpoint !== generationsURL) {
    throw new DesignError(422, 'VALIDATION', 'Provider origin is not allowed');
  }

  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
    controller.abort();
  }, IMAGE_GENERATION_TIMEOUT_MS);
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

    const requestBody: ImagesGenerationsRequestBody = {
      model: config.model,
      prompt,
      n: 1,
      size: IMAGE_GENERATION_SIZE,
      response_format: IMAGE_GENERATION_RESPONSE_FORMAT,
    };

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
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
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
    const bytes: Buffer = decodeCanonicalBase64(extractB64Json(raw));
    if (bytes.length > MAX_ASSET_BYTES) {
      throw new DesignError(422, 'VALIDATION', 'Asset exceeds 10 MiB limit');
    }
    const mime: 'image/png' | 'image/jpeg' | 'image/webp' | null = sniffRasterMime(bytes);
    if (!mime) {
      throw new DesignError(422, 'VALIDATION', 'File magic does not match PNG, JPEG, or WebP');
    }
    const validated: { mime: 'image/png' | 'image/jpeg' | 'image/webp' } =
      await validateDesignRaster({
        bytes,
        mime,
      });
    const result: ProviderSubmitResult = {
      kind: 'immediate',
      providerJobId: `image:${input.jobId}`,
      imageBytes: bytes,
      mime: validated.mime,
    };
    return result;
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

function extractPrompt(payload: Record<string, unknown> | undefined): string {
  const prompt: unknown = payload == null ? undefined : payload.prompt;
  if (typeof prompt !== 'string' || prompt.length === 0) {
    throw new DesignError(422, 'VALIDATION', 'prompt is required');
  }
  if (prompt.length > IMAGE_GENERATION_MAX_PROMPT_LENGTH) {
    throw new DesignError(422, 'VALIDATION', 'prompt exceeds 8000 characters');
  }
  return prompt;
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
  if (fallback.byteLength > IMAGE_GENERATION_MAX_RESPONSE_BYTES) {
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
      if (total > IMAGE_GENERATION_MAX_RESPONSE_BYTES) {
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
  const payload: ImageGenerationResponse = parsed as ImageGenerationResponse;
  const data: ImageGenerationDatum[] | undefined = payload.data;
  if (!Array.isArray(data) || data.length === 0 || data[0] == null || typeof data[0] !== 'object') {
    throw new DesignError(422, 'VALIDATION', 'Provider response is missing image data');
  }
  const first: ImageGenerationDatum = data[0];
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

const PNG_MAGIC: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
