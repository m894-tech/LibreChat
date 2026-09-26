import {
  parseDesignProposal,
  ProviderUncertainError,
  type DesignGenerationProvider,
  type ProviderSubmitInput,
  type ProviderSubmitResult,
} from './providers';
import { DesignError } from './assets';

/** @public */
export const GENERATION_MAX_RESPONSE_BYTES: number = 128 * 1024;
/** @public */
export const GENERATION_TIMEOUT_MS: number = 20_000;
/** @public */
export const GENERATION_MAX_TOKENS: number = 2048;
/** @public */
export const GENERATION_CHAT_COMPLETIONS_PATH: string = 'chat/completions';
/** @public */
export const GENERATION_SYSTEM_PROMPT: string =
  'Return ONLY raw JSON (no markdown fences). Shape must be exactly: {"kind":"design_proposal","schemaVersion":1,"operations":[{"type":"setText","nodeId":"<id>","value":"<text>"}]}. Use only operations from setText/setProperty/insertNode/removeNode/moveNode/reorderNode/replaceAsset/bindToken/setLiteral/applySystem/lock/unlock. For title text edits prefer setText. Do not wrap in proposal/ops. Do not call tools or emit scripts.';

export type GenerationFetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export type ResolveCredential = (principalId: string) => Promise<string | null>;

export interface GenerationAdapterConfig {
  enabled: boolean;
  model: string;
  baseURL: string;
  allowedOrigins: readonly string[];
  resolveCredential: ResolveCredential;
  fetchImpl: GenerationFetchImpl;
}

interface ChatCompletionMessage {
  content?: string;
}

interface ChatCompletionChoice {
  message?: ChatCompletionMessage;
}

interface ChatCompletionResponse {
  choices?: ChatCompletionChoice[];
}

interface CompletionsRequestBody {
  model: string;
  temperature: number;
  max_tokens: number;
  stream: boolean;
  response_format: { type: 'json_object' };
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}

/** @public */
export function createGenerationAdapter(config: GenerationAdapterConfig): DesignGenerationProvider {
  const resolved: GenerationAdapterConfig = assertAdapterConfig(config);
  const completionsURL: string = buildCompletionsURL(resolved.baseURL, resolved.allowedOrigins);

  const provider: DesignGenerationProvider = {
    capabilities: {
      imageGeneration: false,
      textProposal: config.enabled,
    },
    async submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult> {
      return submitGeneration(resolved, completionsURL, input);
    },
  };
  return provider;
}

function assertAdapterConfig(config: GenerationAdapterConfig): GenerationAdapterConfig {
  if (!config || typeof config !== 'object') {
    throw new DesignError(422, 'VALIDATION', 'Generation adapter config is required');
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
  const resolved: GenerationAdapterConfig = {
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

function buildCompletionsURL(baseURL: string, allowedOrigins: readonly string[]): string {
  const parsed: URL = assertSafeBaseURL(baseURL, allowedOrigins);
  const normalizedBase: string = parsed.href.endsWith('/') ? parsed.href : `${parsed.href}/`;
  const completions: URL = new URL(GENERATION_CHAT_COMPLETIONS_PATH, normalizedBase);
  if (completions.protocol !== 'https:') {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must be https');
  }
  if (completions.username.length > 0 || completions.password.length > 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must not embed credentials');
  }
  if (completions.search.length > 0 || completions.hash.length > 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider baseURL must not include search or hash');
  }
  if (!allowedOrigins.includes(completions.origin) || completions.origin !== parsed.origin) {
    throw new DesignError(422, 'VALIDATION', 'Provider origin is not allowed');
  }
  return completions.href;
}

async function submitGeneration(
  config: GenerationAdapterConfig,
  completionsURL: string,
  input: ProviderSubmitInput,
): Promise<ProviderSubmitResult> {
  if (!config.enabled) {
    throw new DesignError(422, 'CAPABILITY_UNAVAILABLE', 'Design generation provider is disabled');
  }
  if (input.capability !== 'textProposal') {
    throw new DesignError(422, 'CAPABILITY_UNAVAILABLE', 'Image generation is unavailable');
  }
  assertSafeBaseURL(config.baseURL, config.allowedOrigins);
  const endpoint: string = buildCompletionsURL(config.baseURL, config.allowedOrigins);
  if (endpoint !== completionsURL) {
    throw new DesignError(422, 'VALIDATION', 'Provider origin is not allowed');
  }

  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
    controller.abort();
  }, GENERATION_TIMEOUT_MS);
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

    const requestBody: CompletionsRequestBody = {
      model: config.model,
      temperature: 0,
      max_tokens: GENERATION_MAX_TOKENS,
      stream: false,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: GENERATION_SYSTEM_PROMPT },
        { role: 'user', content: scopedUserContent(input) },
      ],
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
    const proposal = parseDesignProposal(extractMessageContent(raw));
    const result: ProviderSubmitResult = {
      kind: 'immediate',
      providerJobId: `text:${input.jobId}`,
      proposal,
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

function scopedUserContent(input: ProviderSubmitInput): string {
  const payload: Record<string, unknown> = input.payload ?? {};
  const scoped: {
    projectId: string;
    documentId: string;
    jobId: string;
    payload: Record<string, unknown>;
  } = {
    projectId: input.projectId,
    documentId: input.documentId,
    jobId: input.jobId,
    payload,
  };
  const text = JSON.stringify(scoped);
  if (Buffer.byteLength(text, 'utf8') > 64000)
    throw new DesignError(422, 'VALIDATION', 'Selected context exceeds request size cap');
  return text;
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
  if (fallback.byteLength > GENERATION_MAX_RESPONSE_BYTES) {
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
      if (total > GENERATION_MAX_RESPONSE_BYTES) {
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

function extractMessageContent(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DesignError(422, 'VALIDATION', 'Provider response is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DesignError(422, 'VALIDATION', 'Provider response is not a JSON object');
  }
  const payload: ChatCompletionResponse = parsed as ChatCompletionResponse;
  const choices: ChatCompletionChoice[] | undefined = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider response is missing choices');
  }
  const content: string | undefined = choices[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new DesignError(422, 'VALIDATION', 'Provider response is missing message content');
  }
  return content;
}
