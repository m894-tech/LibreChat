import {
  createDraftStreamProvider,
  DRAFT_STREAM_CHAT_COMPLETIONS_PATH,
  DRAFT_STREAM_MAX_TOKENS,
  DRAFT_STREAM_SYSTEM_PROMPT,
  DRAFT_STREAM_TIMEOUT_MS,
  type DraftStreamFetchImpl,
  type DraftStreamProviderConfig,
} from '../draft-stream-provider';
import { ProviderUncertainError, type ProviderSubmitInput } from '../providers';
import { DesignError } from '../assets';

const ALLOWED_ORIGIN: string = 'https://llm.example.com';
const BASE_URL: string = 'https://llm.example.com/v1';
const COMPLETIONS_URL: string = `https://llm.example.com/v1/${DRAFT_STREAM_CHAT_COMPLETIONS_PATH}`;

function submitInput(overrides: Partial<ProviderSubmitInput> = {}): ProviderSubmitInput {
  const input: ProviderSubmitInput = {
    jobId: 'job-1',
    principalId: 'principal-1',
    projectId: 'project-1',
    documentId: 'document-1',
    capability: 'textProposal',
    payload: {
      nodes: [{ id: 'n1', type: 'frame' }],
      size: { width: 100, height: 80 },
      system: { id: 'sys-1', version: 1 },
      grant: ['n1'],
      endpoint: 'https://evil.example/override',
      baseURL: 'https://evil.example/v1',
    },
    ...overrides,
  };
  return input;
}

function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function responseFromChunks(chunks: Uint8Array[], status = 200): Response {
  let index = 0;
  const stream: ReadableStream<Uint8Array> = new ReadableStream<Uint8Array>({
    pull(controller: ReadableStreamDefaultController<Uint8Array>): void {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[index]);
      index += 1;
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function baseConfig(overrides: Partial<DraftStreamProviderConfig> = {}): DraftStreamProviderConfig {
  const fetchImpl: DraftStreamFetchImpl = jest.fn(async (): Promise<Response> => {
    return responseFromChunks([
      encodeUtf8(sseChunk('{"type":"insertNode","node":{"id":"n2"}}')),
      encodeUtf8('data: [DONE]\n\n'),
    ]);
  });
  const config: DraftStreamProviderConfig = {
    enabled: true,
    model: 'grok-4.5',
    baseURL: BASE_URL,
    allowedOrigins: [ALLOWED_ORIGIN],
    resolveCredential: jest.fn(async (): Promise<string | null> => 'injected-token'),
    fetchImpl,
    ...overrides,
  };
  return config;
}

describe('createDraftStreamProvider', (): void => {
  afterEach((): void => {
    jest.useRealTimers();
  });

  it('streams OpenAI-compatible SSE deltas with backpressure and scoped user prompt', async (): Promise<void> => {
    const config: DraftStreamProviderConfig = baseConfig();
    const provider = createDraftStreamProvider(config);
    const deltas: string[] = [];
    let resolveGate: (() => void) | undefined;
    const gate: Promise<void> = new Promise((resolve: () => void): void => {
      resolveGate = resolve;
    });
    let resolveFirst: (() => void) | undefined;
    const firstDelta: Promise<void> = new Promise((resolve: () => void): void => {
      resolveFirst = resolve;
    });

    const onDelta = jest.fn(async (chunk: string): Promise<void> => {
      deltas.push(chunk);
      resolveFirst?.();
      await gate;
    });

    const streamPromise = provider.stream(submitInput(), onDelta);
    await firstDelta;
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(['{"type":"insertNode","node":{"id":"n2"}}']);
    resolveGate?.();
    await streamPromise;

    expect(config.fetchImpl).toHaveBeenCalledTimes(1);
    expect(config.resolveCredential).toHaveBeenCalledWith('principal-1');

    const [url, init] = (config.fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(COMPLETIONS_URL);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer injected-token',
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      }),
    );

    const parsedBody: {
      model: string;
      max_tokens: number;
      stream: boolean;
      tools?: unknown;
      functions?: unknown;
      messages: Array<{ role: string; content: string }>;
    } = JSON.parse(String(init.body));
    expect(parsedBody.model).toBe('grok-4.5');
    expect(parsedBody.max_tokens).toBe(DRAFT_STREAM_MAX_TOKENS);
    expect(parsedBody.stream).toBe(true);
    expect(parsedBody.tools).toBeUndefined();
    expect(parsedBody.functions).toBeUndefined();
    expect(parsedBody.messages[0]).toEqual({
      role: 'system',
      content: DRAFT_STREAM_SYSTEM_PROMPT,
    });
    expect(parsedBody.messages[1]?.content).toContain('"nodes"');
    expect(parsedBody.messages[1]?.content).toContain('"size"');
    expect(parsedBody.messages[1]?.content).toContain('"system"');
    expect(parsedBody.messages[1]?.content).toContain('"grant"');
    expect(parsedBody.messages[1]?.content).not.toContain('evil.example');
  });

  it('reassembles fragmented SSE delimiters and split unicode code points', async (): Promise<void> => {
    const cyrillic: string = 'привет';
    const encoded: Uint8Array = encodeUtf8(`${sseChunk(cyrillic)}data: [DONE]\n\n`);
    const mid: number = Math.max(1, Math.floor(encoded.byteLength / 2));
    const fetchImpl: DraftStreamFetchImpl = jest.fn(async (): Promise<Response> => {
      return responseFromChunks([encoded.slice(0, mid), encoded.slice(mid)]);
    });
    const provider = createDraftStreamProvider(baseConfig({ fetchImpl }));
    const deltas: string[] = [];

    await provider.stream(submitInput(), async (chunk: string): Promise<void> => {
      deltas.push(chunk);
    });

    expect(deltas.join('')).toBe(cyrillic);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing credential before fetch', async (): Promise<void> => {
    const config: DraftStreamProviderConfig = baseConfig({
      resolveCredential: jest.fn(async (): Promise<string | null> => null),
    });
    const provider = createDraftStreamProvider(config);

    await expect(
      provider.stream(submitInput(), async (): Promise<void> => undefined),
    ).rejects.toMatchObject({
      name: 'DesignError',
      code: 'UNAUTHORIZED',
    });
    expect(config.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a disallowed origin before fetch', (): void => {
    const fetchImpl: DraftStreamFetchImpl = jest.fn();
    expect((): void => {
      createDraftStreamProvider(
        baseConfig({
          baseURL: 'https://evil.example/v1',
          allowedOrigins: [ALLOWED_ORIGIN],
          fetchImpl,
        }),
      );
    }).toThrow(DesignError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('times out credential resolution with fake timers and does not fetch', async (): Promise<void> => {
    jest.useFakeTimers();
    const resolveCredential = jest.fn(
      (): Promise<string | null> =>
        new Promise((): void => {
          /* never resolves */
        }),
    );
    const fetchImpl: DraftStreamFetchImpl = jest.fn();
    const provider = createDraftStreamProvider(baseConfig({ resolveCredential, fetchImpl }));

    const pending: Promise<void> = provider.stream(
      submitInput(),
      async (): Promise<void> => undefined,
    );
    let observed: unknown;
    const tracked: Promise<void> = pending.then(
      (): void => undefined,
      (error: unknown): void => {
        observed = error;
      },
    );
    await jest.runOnlyPendingTimersAsync();
    await tracked;
    expect(observed).toMatchObject({ name: 'DesignError', code: 'TIMEOUT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects incomplete EOF without [DONE] as unknown without retry', async (): Promise<void> => {
    const fetchImpl: DraftStreamFetchImpl = jest.fn(async (): Promise<Response> => {
      return responseFromChunks([encodeUtf8(sseChunk('partial-line'))]);
    });
    const provider = createDraftStreamProvider(baseConfig({ fetchImpl }));

    await expect(
      provider.stream(submitInput(), async (): Promise<void> => undefined),
    ).rejects.toBeInstanceOf(ProviderUncertainError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
