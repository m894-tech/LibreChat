import sharp from 'sharp';
import {
  createImageGenerationAdapter,
  IMAGE_GENERATION_MAX_PROMPT_LENGTH,
  IMAGE_GENERATION_MAX_RESPONSE_BYTES,
  IMAGE_GENERATION_PATH,
  IMAGE_GENERATION_RESPONSE_FORMAT,
  IMAGE_GENERATION_SIZE,
  type ImageGenerationAdapterConfig,
  type ImageGenerationFetchImpl,
} from '../image-generation-adapter';
import { ProviderUncertainError, type ProviderSubmitInput } from '../providers';
import { DesignError } from '../assets';

const ALLOWED_ORIGIN: string = 'https://llm.example.com';
const BASE_URL: string = 'https://llm.example.com/v1';
const GENERATIONS_URL: string = `https://llm.example.com/v1/${IMAGE_GENERATION_PATH}`;

async function tinyPng(): Promise<Buffer> {
  const bytes: Buffer = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 128, b: 0 } },
  })
    .png()
    .toBuffer();
  return bytes;
}

function submitInput(overrides: Partial<ProviderSubmitInput> = {}): ProviderSubmitInput {
  const input: ProviderSubmitInput = {
    jobId: 'job-1',
    principalId: 'principal-1',
    projectId: 'project-1',
    documentId: 'document-1',
    capability: 'imageGeneration',
    payload: { prompt: 'A green square' },
    ...overrides,
  };
  return input;
}

function imageBody(png: Buffer): string {
  const body: { data: Array<{ b64_json: string }> } = {
    data: [{ b64_json: png.toString('base64') }],
  };
  return JSON.stringify(body);
}

function baseConfig(
  overrides: Partial<ImageGenerationAdapterConfig> = {},
): ImageGenerationAdapterConfig {
  const fetchImpl: ImageGenerationFetchImpl = jest.fn(async (): Promise<Response> => {
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const config: ImageGenerationAdapterConfig = {
    enabled: true,
    model: 'design-image-r1',
    baseURL: BASE_URL,
    allowedOrigins: [ALLOWED_ORIGIN],
    resolveCredential: jest.fn(async (): Promise<string | null> => 'injected-token'),
    fetchImpl,
    ...overrides,
  };
  return config;
}

describe('createImageGenerationAdapter', (): void => {
  it('submits a bounded images generation request and returns validated raster bytes', async (): Promise<void> => {
    const png: Buffer = await tinyPng();
    const fetchImpl: ImageGenerationFetchImpl = jest.fn(async (): Promise<Response> => {
      return new Response(imageBody(png), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const config: ImageGenerationAdapterConfig = baseConfig({ fetchImpl });
    const provider = createImageGenerationAdapter(config);
    expect(provider.capabilities).toEqual({
      imageGeneration: true,
      textProposal: false,
    });

    const result = await provider.submit(
      submitInput({
        payload: {
          prompt: 'A green square',
          endpoint: 'https://evil.example/override',
          baseURL: 'https://evil.example/v1',
          model: 'attacker-model',
          n: 8,
          size: '512x512',
          response_format: 'url',
          url: 'https://evil.example/x.png',
        },
      }),
    );

    expect(result.kind).toBe('immediate');
    expect(result).toEqual({
      kind: 'immediate',
      providerJobId: 'image:job-1',
      imageBytes: png,
      mime: 'image/png',
    });
    expect(config.fetchImpl).toHaveBeenCalledTimes(1);
    expect(config.resolveCredential).toHaveBeenCalledWith('principal-1');

    const [url, init] = (config.fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(GENERATIONS_URL);
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
      prompt: string;
      n: number;
      size: string;
      response_format: string;
    } = JSON.parse(String(init.body));
    expect(parsedBody).toEqual({
      model: 'design-image-r1',
      prompt: 'A green square',
      n: 1,
      size: IMAGE_GENERATION_SIZE,
      response_format: IMAGE_GENERATION_RESPONSE_FORMAT,
    });
    expect(Object.keys(parsedBody)).toEqual(['model', 'prompt', 'n', 'size', 'response_format']);
  });

  it('rejects a missing user key before fetch', async (): Promise<void> => {
    const config: ImageGenerationAdapterConfig = baseConfig({
      resolveCredential: jest.fn(async (): Promise<string | null> => null),
    });
    const provider = createImageGenerationAdapter(config);

    await expect(provider.submit(submitInput())).rejects.toMatchObject({
      name: 'DesignError',
      code: 'UNAUTHORIZED',
    });
    expect(config.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a URL-only provider response without fetching the remote image', async (): Promise<void> => {
    const remoteUrl: string = 'https://cdn.example.com/generated.png';
    const fetchImpl: ImageGenerationFetchImpl = jest.fn(async (): Promise<Response> => {
      return new Response(JSON.stringify({ data: [{ url: remoteUrl }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const provider = createImageGenerationAdapter(baseConfig({ fetchImpl }));

    await expect(provider.submit(submitInput())).rejects.toMatchObject({
      name: 'DesignError',
      code: 'VALIDATION',
      message: 'Provider response did not include image bytes',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = (fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(GENERATIONS_URL);
    expect(url).not.toBe(remoteUrl);
  });

  it('rejects an oversized streamed response without retry', async (): Promise<void> => {
    const oversized: string = 'x'.repeat(IMAGE_GENERATION_MAX_RESPONSE_BYTES + 1);
    const fetchImpl: ImageGenerationFetchImpl = jest.fn(async (): Promise<Response> => {
      return new Response(oversized, { status: 200 });
    });
    const provider = createImageGenerationAdapter(baseConfig({ fetchImpl }));

    await expect(provider.submit(submitInput())).rejects.toMatchObject({
      name: 'DesignError',
      code: 'VALIDATION',
      message: 'Provider response exceeded size limit',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps a post-send network error to ProviderUncertainError once', async (): Promise<void> => {
    const fetchImpl: ImageGenerationFetchImpl = jest.fn(async (): Promise<Response> => {
      const error: Error & { code: string } = Object.assign(new Error('connect failed'), {
        code: 'ECONNRESET',
      });
      throw error;
    });
    const provider = createImageGenerationAdapter(baseConfig({ fetchImpl }));

    await expect(provider.submit(submitInput())).rejects.toBeInstanceOf(ProviderUncertainError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a disallowed origin before fetch', (): void => {
    const fetchImpl: ImageGenerationFetchImpl = jest.fn();
    expect((): void => {
      createImageGenerationAdapter(
        baseConfig({
          baseURL: 'https://evil.example/v1',
          allowedOrigins: [ALLOWED_ORIGIN],
          fetchImpl,
        }),
      );
    }).toThrow(DesignError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exposes imageGeneration=false when the adapter is disabled', (): void => {
    const provider = createImageGenerationAdapter(baseConfig({ enabled: false }));
    expect(provider.capabilities).toEqual({
      imageGeneration: false,
      textProposal: false,
    });
  });

  it('rejects a prompt longer than 8000 characters before fetch', async (): Promise<void> => {
    const config: ImageGenerationAdapterConfig = baseConfig();
    const provider = createImageGenerationAdapter(config);
    await expect(
      provider.submit(
        submitInput({
          payload: { prompt: 'p'.repeat(IMAGE_GENERATION_MAX_PROMPT_LENGTH + 1) },
        }),
      ),
    ).rejects.toMatchObject({
      name: 'DesignError',
      code: 'VALIDATION',
    });
    expect(config.fetchImpl).not.toHaveBeenCalled();
    expect(config.resolveCredential).not.toHaveBeenCalled();
  });
});
