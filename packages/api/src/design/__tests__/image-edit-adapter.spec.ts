import sharp from 'sharp';
import {
  createImageEditAdapter,
  IMAGE_EDIT_MAX_PROMPT_LENGTH,
  IMAGE_EDIT_PATH,
  IMAGE_EDIT_RESPONSE_FORMAT,
  type ImageEditAdapterConfig,
  type ImageEditFetchImpl,
  type ImageEditInpaintInput,
} from '../image-edit-adapter';
import { DesignError } from '../assets';

const ALLOWED_ORIGIN: string = 'https://llm.example.com';
const BASE_URL: string = 'https://llm.example.com/v1';
const EDITS_URL: string = `https://llm.example.com/v1/${IMAGE_EDIT_PATH}`;

async function rgbaPng(width: number, height: number, pixels: number[]): Promise<Buffer> {
  const data: Buffer = Buffer.from(pixels);
  if (data.length !== width * height * 4) {
    throw new Error('rgba fixture size mismatch');
  }
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

async function grayPng(width: number, height: number, pixels: number[]): Promise<Buffer> {
  const data: Buffer = Buffer.from(pixels);
  if (data.length !== width * height) {
    throw new Error('gray fixture size mismatch');
  }
  return sharp(data, { raw: { width, height, channels: 1 } })
    .toColourspace('b-w')
    .png()
    .toBuffer();
}

async function decodeRgba(bytes: Buffer): Promise<{ width: number; height: number; data: Buffer }> {
  const result = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: result.info.width, height: result.info.height, data: result.data };
}

function imageBody(png: Buffer): string {
  const body: { data: Array<{ b64_json: string }> } = {
    data: [{ b64_json: png.toString('base64') }],
  };
  return JSON.stringify(body);
}

function baseConfig(overrides: Partial<ImageEditAdapterConfig> = {}): ImageEditAdapterConfig {
  const fetchImpl: ImageEditFetchImpl = jest.fn(async (): Promise<Response> => {
    return new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const config: ImageEditAdapterConfig = {
    model: 'design-image-edit-r1',
    baseURL: BASE_URL,
    allowedOrigins: [ALLOWED_ORIGIN],
    resolveCredential: jest.fn(async (): Promise<string | null> => 'injected-token'),
    fetchImpl,
    ...overrides,
  };
  return config;
}

function inpaintInput(
  original: Buffer,
  mask: Buffer,
  overrides: Partial<ImageEditInpaintInput> = {},
): ImageEditInpaintInput {
  const input: ImageEditInpaintInput = {
    principalId: 'principal-1',
    jobId: 'job-1',
    prompt: 'replace the selected region with blue',
    original,
    mask,
    ...overrides,
  };
  return input;
}

describe('createImageEditAdapter', (): void => {
  it('inpaints via multipart edits, composites strictly, and preserves outside pixels', async (): Promise<void> => {
    const original: Buffer = await rgbaPng(
      2,
      2,
      [10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, 128, 110, 120, 130, 255],
    );
    const mask: Buffer = await grayPng(2, 2, [0, 255, 0, 255]);
    const generatedDirty: Buffer = await rgbaPng(
      2,
      2,
      [1, 1, 1, 255, 200, 0, 0, 255, 2, 2, 2, 255, 0, 0, 200, 255],
    );

    const fetchImpl: ImageEditFetchImpl = jest.fn(async (): Promise<Response> => {
      return new Response(imageBody(generatedDirty), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const config: ImageEditAdapterConfig = baseConfig({ fetchImpl });
    const adapter = createImageEditAdapter(config);

    const result: Buffer = await adapter.inpaint(inpaintInput(original, mask));
    const out = await decodeRgba(result);
    const origRgba = await decodeRgba(original);

    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(Array.from(out.data.subarray(0, 4))).toEqual(Array.from(origRgba.data.subarray(0, 4)));
    expect(Array.from(out.data.subarray(8, 12))).toEqual(Array.from(origRgba.data.subarray(8, 12)));
    expect(Array.from(out.data.subarray(4, 8))).toEqual([200, 0, 0, 255]);
    expect(Array.from(out.data.subarray(12, 16))).toEqual([0, 0, 200, 255]);

    expect(config.fetchImpl).toHaveBeenCalledTimes(1);
    expect(config.resolveCredential).toHaveBeenCalledWith('principal-1');

    const [url, init] = (config.fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EDITS_URL);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer injected-token',
        Accept: 'application/json',
      }),
    );
    expect(init.body).toBeInstanceOf(FormData);
    const form: FormData = init.body as FormData;
    expect(form.get('model')).toBe('design-image-edit-r1');
    expect(form.get('prompt')).toBe('replace the selected region with blue');
    expect(form.get('n')).toBe('1');
    expect(form.get('response_format')).toBe(IMAGE_EDIT_RESPONSE_FORMAT);
    expect(form.get('image')).toBeTruthy();
    expect(form.get('mask')).toBeTruthy();
    expect(form.has('url')).toBe(false);
    expect(form.has('size')).toBe(false);
  });

  it('rejects a missing user key before fetch', async (): Promise<void> => {
    const original: Buffer = await rgbaPng(2, 2, new Array(16).fill(10));
    const mask: Buffer = await grayPng(2, 2, [0, 0, 255, 255]);
    const config: ImageEditAdapterConfig = baseConfig({
      resolveCredential: jest.fn(async (): Promise<string | null> => null),
    });
    const adapter = createImageEditAdapter(config);

    await expect(adapter.inpaint(inpaintInput(original, mask))).rejects.toMatchObject({
      name: 'DesignError',
      code: 'UNAUTHORIZED',
    });
    expect(config.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a URL-only provider response without fetching the remote image', async (): Promise<void> => {
    const original: Buffer = await rgbaPng(2, 2, new Array(16).fill(10));
    const mask: Buffer = await grayPng(2, 2, [255, 0, 0, 0]);
    const remoteUrl: string = 'https://cdn.example.com/edited.png';
    const fetchImpl: ImageEditFetchImpl = jest.fn(async (): Promise<Response> => {
      return new Response(JSON.stringify({ data: [{ url: remoteUrl }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const adapter = createImageEditAdapter(baseConfig({ fetchImpl }));

    await expect(adapter.inpaint(inpaintInput(original, mask))).rejects.toMatchObject({
      name: 'DesignError',
      code: 'VALIDATION',
      message: 'Provider response did not include image bytes',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = (fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EDITS_URL);
    expect(url).not.toBe(remoteUrl);
  });

  it('rejects generated dimension mismatch without returning dirty bytes', async (): Promise<void> => {
    const original: Buffer = await rgbaPng(2, 2, new Array(16).fill(10));
    const mask: Buffer = await grayPng(2, 2, [0, 255, 0, 0]);
    const mismatched: Buffer = await rgbaPng(2, 1, new Array(8).fill(99));
    const fetchImpl: ImageEditFetchImpl = jest.fn(async (): Promise<Response> => {
      return new Response(imageBody(mismatched), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const adapter = createImageEditAdapter(baseConfig({ fetchImpl }));

    await expect(adapter.inpaint(inpaintInput(original, mask))).rejects.toMatchObject({
      name: 'DesignError',
      code: 'VALIDATION',
      message: 'generated image dimensions must match original',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects mask/original dimension mismatch before fetch', async (): Promise<void> => {
    const original: Buffer = await rgbaPng(2, 2, new Array(16).fill(10));
    const mask: Buffer = await grayPng(2, 1, [0, 255]);
    const config: ImageEditAdapterConfig = baseConfig();
    const adapter = createImageEditAdapter(config);

    await expect(adapter.inpaint(inpaintInput(original, mask))).rejects.toMatchObject({
      name: 'DesignError',
      code: 'VALIDATION',
      message: 'mask dimensions must match original',
    });
    expect(config.fetchImpl).not.toHaveBeenCalled();
    expect(config.resolveCredential).not.toHaveBeenCalled();
  });

  it('rejects a disallowed origin before fetch', (): void => {
    const fetchImpl: ImageEditFetchImpl = jest.fn();
    expect((): void => {
      createImageEditAdapter(
        baseConfig({
          baseURL: 'https://evil.example/v1',
          allowedOrigins: [ALLOWED_ORIGIN],
          fetchImpl,
        }),
      );
    }).toThrow(DesignError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a prompt longer than 8000 characters before fetch', async (): Promise<void> => {
    const original: Buffer = await rgbaPng(2, 2, new Array(16).fill(10));
    const mask: Buffer = await grayPng(2, 2, [0, 0, 0, 0]);
    const config: ImageEditAdapterConfig = baseConfig();
    const adapter = createImageEditAdapter(config);

    await expect(
      adapter.inpaint(
        inpaintInput(original, mask, {
          prompt: 'p'.repeat(IMAGE_EDIT_MAX_PROMPT_LENGTH + 1),
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
