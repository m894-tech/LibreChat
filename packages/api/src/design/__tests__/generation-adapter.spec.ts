import {
  createGenerationAdapter,
  GENERATION_MAX_RESPONSE_BYTES,
  GENERATION_MAX_TOKENS,
  GENERATION_SYSTEM_PROMPT,
  type GenerationAdapterConfig,
  type GenerationFetchImpl,
} from '../generation-adapter';
import { ProviderUncertainError, type ProviderSubmitInput } from '../providers';
import { DesignError } from '../assets';

const ALLOWED_ORIGIN: string = 'https://llm.example.com';
const BASE_URL: string = 'https://llm.example.com/v1';
const COMPLETIONS_URL: string = 'https://llm.example.com/v1/chat/completions';

const PROPOSAL: {
  kind: 'design_proposal';
  schemaVersion: 1;
  title: string;
  operations: Array<{ type: 'setText'; nodeId: string; value: string }>;
} = {
  kind: 'design_proposal',
  schemaVersion: 1,
  title: 'Scoped edit',
  operations: [{ type: 'setText', nodeId: 'node-1', value: 'Hello' }],
};

function submitInput(overrides: Partial<ProviderSubmitInput> = {}): ProviderSubmitInput {
  const input: ProviderSubmitInput = {
    jobId: 'job-1',
    principalId: 'principal-1',
    projectId: 'project-1',
    documentId: 'document-1',
    capability: 'textProposal',
    payload: { prompt: 'Tighten the heading' },
    ...overrides,
  };
  return input;
}

function completionBody(proposal: typeof PROPOSAL = PROPOSAL): string {
  const body: { choices: Array<{ message: { content: string } }> } = {
    choices: [{ message: { content: JSON.stringify(proposal) } }],
  };
  return JSON.stringify(body);
}

function baseConfig(overrides: Partial<GenerationAdapterConfig> = {}): GenerationAdapterConfig {
  const fetchImpl: GenerationFetchImpl = jest.fn(async (): Promise<Response> => {
    return new Response(completionBody(), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const config: GenerationAdapterConfig = {
    enabled: true,
    model: 'design-text-r1',
    baseURL: BASE_URL,
    allowedOrigins: [ALLOWED_ORIGIN],
    resolveCredential: jest.fn(async (): Promise<string | null> => 'injected-token'),
    fetchImpl,
    ...overrides,
  };
  return config;
}

describe('createGenerationAdapter', (): void => {
  it('submits a bounded JSON chat completion and returns a parsed proposal', async (): Promise<void> => {
    const config: GenerationAdapterConfig = baseConfig();
    const provider = createGenerationAdapter(config);
    expect(provider.capabilities).toEqual({
      imageGeneration: false,
      textProposal: true,
    });

    const result = await provider.submit(
      submitInput({
        payload: {
          prompt: 'Tighten the heading',
          endpoint: 'https://evil.example/override',
          baseURL: 'https://evil.example/v1',
        },
      }),
    );

    expect(result).toEqual({
      kind: 'immediate',
      providerJobId: 'text:job-1',
      proposal: PROPOSAL,
    });
    expect(config.fetchImpl).toHaveBeenCalledTimes(1);
    expect(config.resolveCredential).toHaveBeenCalledWith('principal-1');

    const [url, init] = (config.fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(COMPLETIONS_URL);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer injected-token',
        'Content-Type': 'application/json',
      }),
    );

    const parsedBody: {
      model: string;
      max_tokens: number;
      stream: boolean;
      response_format: { type: string };
      tools?: unknown;
      functions?: unknown;
      messages: Array<{ role: string; content: string }>;
    } = JSON.parse(String(init.body));
    expect(parsedBody.model).toBe('design-text-r1');
    expect(parsedBody.max_tokens).toBe(GENERATION_MAX_TOKENS);
    expect(parsedBody.stream).toBe(false);
    expect(parsedBody.response_format).toEqual({ type: 'json_object' });
    expect(parsedBody.tools).toBeUndefined();
    expect(parsedBody.functions).toBeUndefined();
    expect(parsedBody.messages[0]).toEqual({
      role: 'system',
      content: GENERATION_SYSTEM_PROMPT,
    });
    expect(parsedBody.messages[1]?.content).toContain('project-1');
    expect(parsedBody.messages[1]?.content).toContain('Tighten the heading');
  });

  it('rejects a missing credential before fetch', async (): Promise<void> => {
    const config: GenerationAdapterConfig = baseConfig({
      resolveCredential: jest.fn(async (): Promise<string | null> => null),
    });
    const provider = createGenerationAdapter(config);

    await expect(provider.submit(submitInput())).rejects.toMatchObject({
      name: 'DesignError',
      code: 'UNAUTHORIZED',
    });
    expect(config.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a disallowed origin before fetch', (): void => {
    const fetchImpl: GenerationFetchImpl = jest.fn();
    expect((): void => {
      createGenerationAdapter(
        baseConfig({
          baseURL: 'https://evil.example/v1',
          allowedOrigins: [ALLOWED_ORIGIN],
          fetchImpl,
        }),
      );
    }).toThrow(DesignError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an oversized streamed response without retry', async (): Promise<void> => {
    const oversized: string = 'x'.repeat(GENERATION_MAX_RESPONSE_BYTES + 1);
    const fetchImpl: GenerationFetchImpl = jest.fn(async (): Promise<Response> => {
      return new Response(oversized, { status: 200 });
    });
    const provider = createGenerationAdapter(baseConfig({ fetchImpl }));

    await expect(provider.submit(submitInput())).rejects.toMatchObject({
      name: 'DesignError',
      code: 'VALIDATION',
      message: 'Provider response exceeded size limit',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps a post-send network error to ProviderUncertainError once', async (): Promise<void> => {
    const fetchImpl: GenerationFetchImpl = jest.fn(async (): Promise<Response> => {
      const error: Error & { code: string } = Object.assign(new Error('connect failed'), {
        code: 'ECONNRESET',
      });
      throw error;
    });
    const provider = createGenerationAdapter(baseConfig({ fetchImpl }));

    await expect(provider.submit(submitInput())).rejects.toBeInstanceOf(ProviderUncertainError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('times out a stalled response stream without waiting for cancel', async () => {
    jest.useFakeTimers();
    try {
      const stream = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) });
      const config = baseConfig({ fetchImpl: async () => new Response(stream) });
      const result = createGenerationAdapter(config).submit(submitInput());
      const outcome = result.catch((error) => error);
      await jest.advanceTimersByTimeAsync(20001);
      expect(await outcome).toBeInstanceOf(ProviderUncertainError);
    } finally {
      jest.useRealTimers();
    }
  });
  it('does not advertise capability when disabled', () => {
    expect(createGenerationAdapter(baseConfig({ enabled: false })).capabilities.textProposal).toBe(
      false,
    );
  });
});
