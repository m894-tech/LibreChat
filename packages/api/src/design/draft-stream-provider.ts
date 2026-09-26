import { ProviderUncertainError, type ProviderSubmitInput } from './providers';
import { DesignError } from './assets';

/** @public */
export const DRAFT_STREAM_MAX_BODY_BYTES: number = 2 * 1024 * 1024;
/** @public */
export const DRAFT_STREAM_MAX_SSE_EVENT_BYTES: number = 128 * 1024;
/** @public */
export const DRAFT_STREAM_TIMEOUT_MS: number = 60_000;
/** @public */
export const DRAFT_STREAM_MAX_TOKENS: number = 4096;
/** @public */
export const DRAFT_STREAM_CHAT_COMPLETIONS_PATH: string = 'chat/completions';
/** @public */
export const DRAFT_STREAM_SYSTEM_PROMPT: string =
  'Emit only NDJSON lines. Each complete line must be exactly one {"type":"insertNode","node":...} using canonical design nodes. Node fields: id unique ASCII, type text|rect|ellipse|group|image, parentId null or group id, locked false, props object, bindings object. Every props includes numeric x,y,width,height,rotation:0,opacity:1. Text props text,fontFamily (Inter or Montserrat),fontSize,fill hexadecimal. Image only pre-existing assetId/assetVersion provided in context. Do not invent asset IDs. Keep within context size. One full JSON object per line with newline, no wrapper. Do not call tools, execute code, or emit scripts. Do not wrap the stream in markdown.';

export type DraftStreamFetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

export type ResolveDraftCredential = (principalId: string) => Promise<string | null>;

export interface DraftStreamProviderConfig {
  enabled: boolean;
  model: string;
  baseURL: string;
  allowedOrigins: readonly string[];
  resolveCredential: ResolveDraftCredential;
  fetchImpl: DraftStreamFetchImpl;
}

export type DraftStreamDeltaHandler = (chunk: string) => Promise<void>;

export interface DraftStreamProvider {
  stream(
    input: ProviderSubmitInput,
    onDelta: DraftStreamDeltaHandler,
    signal?: AbortSignal,
  ): Promise<void>;
}

interface ChatCompletionDelta {
  content?: string;
}

interface ChatCompletionStreamChoice {
  delta?: ChatCompletionDelta;
}

interface ChatCompletionStreamChunk {
  choices?: ChatCompletionStreamChoice[];
}

interface CompletionsStreamRequestBody {
  model: string;
  temperature: number;
  max_tokens: number;
  stream: true;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
}

/** @public */
export function createDraftStreamProvider(config: DraftStreamProviderConfig): DraftStreamProvider {
  const resolved: DraftStreamProviderConfig = assertProviderConfig(config);
  const completionsURL: string = buildCompletionsURL(resolved.baseURL, resolved.allowedOrigins);

  const provider: DraftStreamProvider = {
    async stream(
      input: ProviderSubmitInput,
      onDelta: DraftStreamDeltaHandler,
      signal?: AbortSignal,
    ): Promise<void> {
      await streamDraft(resolved, completionsURL, input, onDelta, signal);
    },
  };
  return provider;
}

function assertProviderConfig(config: DraftStreamProviderConfig): DraftStreamProviderConfig {
  if (!config || typeof config !== 'object') {
    throw new DesignError(422, 'VALIDATION', 'Draft stream provider config is required');
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
  const resolved: DraftStreamProviderConfig = {
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
  const completions: URL = new URL(DRAFT_STREAM_CHAT_COMPLETIONS_PATH, normalizedBase);
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

async function streamDraft(
  config: DraftStreamProviderConfig,
  completionsURL: string,
  input: ProviderSubmitInput,
  onDelta: DraftStreamDeltaHandler,
  externalSignal?: AbortSignal,
): Promise<void> {
  if (!config.enabled) {
    throw new DesignError(422, 'CAPABILITY_UNAVAILABLE', 'Draft stream provider is disabled');
  }
  if (typeof onDelta !== 'function') {
    throw new DesignError(422, 'VALIDATION', 'onDelta is required');
  }
  if (input.capability !== 'textProposal') {
    throw new DesignError(422, 'CAPABILITY_UNAVAILABLE', 'Draft stream requires textProposal');
  }
  assertSafeBaseURL(config.baseURL, config.allowedOrigins);
  const endpoint: string = buildCompletionsURL(config.baseURL, config.allowedOrigins);
  if (endpoint !== completionsURL) {
    throw new DesignError(422, 'VALIDATION', 'Provider origin is not allowed');
  }

  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
    controller.abort();
  }, DRAFT_STREAM_TIMEOUT_MS);

  const onExternalAbort = (): void => {
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

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

    const requestBody: CompletionsStreamRequestBody = {
      model: config.model,
      temperature: 0,
      max_tokens: DRAFT_STREAM_MAX_TOKENS,
      stream: true,
      messages: [
        { role: 'system', content: DRAFT_STREAM_SYSTEM_PROMPT },
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
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }),
        abortAsTimeout(controller.signal),
      ]);
    } catch (error: unknown) {
      throw toUncertainError(error);
    }

    if (!response.ok) {
      throw new DesignError(502, 'PROVIDER_ERROR', 'Provider request failed');
    }

    await readSseDeltas(response, onDelta, controller.signal);
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
    throw new DesignError(422, 'VALIDATION', 'Provider stream failed');
  } finally {
    clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

function scopedUserContent(input: ProviderSubmitInput): string {
  const p = input.payload ?? {};
  const text = JSON.stringify({
    prompt: p.prompt,
    nodes: p.nodes,
    size: p.size ?? { width: p.width, height: p.height },
    system: p.designSystem ?? p.system,
    grant: p.scope ?? p.grant,
  });
  if (Buffer.byteLength(text, 'utf8') > 128 * 1024)
    throw new DesignError(422, 'VALIDATION', 'Draft context exceeds limit');
  return text;
}

function makeTimeoutError(): Error {
  const error = new Error('Draft stream timed out');
  error.name = 'TimeoutError';
  return error;
}

function abortAsTimeout(signal: AbortSignal): Promise<never> {
  const promise: Promise<never> = new Promise((_, reject: (reason: Error) => void): void => {
    const rejectTimeout = (): void => {
      reject(makeTimeoutError());
    };
    if (signal.aborted) {
      rejectTimeout();
      return;
    }
    signal.addEventListener('abort', rejectTimeout, { once: true });
  });
  return promise;
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw makeTimeoutError();
  }
  const raced: Promise<T> = new Promise(
    (resolve: (value: T) => void, reject: (reason: unknown) => void): void => {
      const onAbort = (): void => {
        reject(makeTimeoutError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(
        (value: T): void => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown): void => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    },
  );
  return raced;
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

async function readSseDeltas(
  response: Response,
  onDelta: DraftStreamDeltaHandler,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw new ProviderUncertainError('Provider submission state is unknown');
  }
  const body: ReadableStream<Uint8Array> | null = response.body;
  if (!body || typeof body.getReader !== 'function') {
    throw new DesignError(422, 'VALIDATION', 'Provider response body is missing');
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const decoder: TextDecoder = new TextDecoder('utf-8', { fatal: false });
  let totalBytes: number = 0;
  let textBuffer: string = '';
  let completed: boolean = false;

  try {
    for (;;) {
      if (signal.aborted) {
        throw new ProviderUncertainError('Provider submission state is unknown');
      }

      const step: ReadableStreamReadResult<Uint8Array> = await raceWithAbort(reader.read(), signal);

      if (step.done) {
        textBuffer += decoder.decode();
        if (textBuffer.length > 0) {
          completed = (await consumeSseBuffer(textBuffer, onDelta, true)).completed;
        }
        break;
      }

      const chunk: Uint8Array = step.value;
      totalBytes += chunk.byteLength;
      if (totalBytes > DRAFT_STREAM_MAX_BODY_BYTES) {
        throw new DesignError(422, 'VALIDATION', 'Provider response exceeded size limit');
      }

      textBuffer += decoder.decode(chunk, { stream: true });
      const consumed: { remainder: string; completed: boolean } = await consumeSseBuffer(
        textBuffer,
        onDelta,
        false,
      );
      textBuffer = consumed.remainder;
      if (consumed.completed) {
        completed = true;
        break;
      }
    }
  } finally {
    void reader.cancel().catch((): void => undefined);
  }

  if (!completed) {
    throw new ProviderUncertainError('Provider submission state is unknown');
  }
}

async function consumeSseBuffer(
  buffer: string,
  onDelta: DraftStreamDeltaHandler,
  flush: boolean,
): Promise<{ remainder: string; completed: boolean }> {
  let cursor: number = 0;
  let completed: boolean = false;

  for (;;) {
    const separator: number = buffer.indexOf('\n\n', cursor);
    if (separator < 0) {
      break;
    }
    const rawEvent: string = buffer.slice(cursor, separator);
    cursor = separator + 2;
    if (utf8Bytes(rawEvent) > DRAFT_STREAM_MAX_SSE_EVENT_BYTES) {
      throw new DesignError(422, 'VALIDATION', 'Provider SSE event exceeded size limit');
    }
    const eventDone: boolean = await handleSseEvent(rawEvent, onDelta);
    if (eventDone) {
      completed = true;
      return { remainder: '', completed: true };
    }
  }

  const remainder: string = buffer.slice(cursor);
  if (utf8Bytes(remainder) > DRAFT_STREAM_MAX_SSE_EVENT_BYTES) {
    throw new DesignError(422, 'VALIDATION', 'Provider SSE event exceeded size limit');
  }

  if (flush && remainder.trim().length > 0) {
    const eventDone: boolean = await handleSseEvent(remainder, onDelta);
    if (eventDone) {
      return { remainder: '', completed: true };
    }
  }

  return { remainder, completed };
}

async function handleSseEvent(
  rawEvent: string,
  onDelta: DraftStreamDeltaHandler,
): Promise<boolean> {
  const lines: string[] = rawEvent.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line: string = lines[index] ?? '';
    const trimmed: string = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (trimmed.length === 0 || trimmed.startsWith(':')) {
      continue;
    }
    if (!trimmed.startsWith('data:')) {
      continue;
    }
    const data: string = trimmed.slice(5).startsWith(' ') ? trimmed.slice(6) : trimmed.slice(5);
    if (data === '[DONE]') {
      return true;
    }
    const content: string | null = extractDeltaContent(data);
    if (content !== null && content.length > 0) {
      await onDelta(content);
    }
  }
  return false;
}

function extractDeltaContent(data: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    throw new DesignError(422, 'VALIDATION', 'Provider SSE data is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DesignError(422, 'VALIDATION', 'Provider SSE data is not a JSON object');
  }
  const payload: ChatCompletionStreamChunk = parsed as ChatCompletionStreamChunk;
  const choices: ChatCompletionStreamChoice[] | undefined = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const content: string | undefined = choices[0]?.delta?.content;
  if (typeof content !== 'string') {
    return null;
  }
  return content;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
