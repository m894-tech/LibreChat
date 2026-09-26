import type { Response } from 'express';
import type { ServerRequest } from '~/types/http';
import {
  requireContextEstimateEnabled,
  createContextEstimateLimiter,
  normalizeContextEstimateBody,
} from './middleware';
import { resolveContextEstimateConfig } from './config';

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return res as unknown as Response & typeof res;
}

function makeReq(config: unknown, body: Record<string, unknown> = {}): ServerRequest {
  return { config, user: { id: 'u1' }, body } as unknown as ServerRequest;
}

describe('resolveContextEstimateConfig', () => {
  it('is off until interface.contextCounterV2 is enabled and fills §6.6 defaults', () => {
    expect(resolveContextEstimateConfig(undefined)).toEqual({
      enabled: false,
      burst: 5,
      perMinute: 30,
      maxExcludedPreviews: 20,
    });
    expect(
      resolveContextEstimateConfig({
        interfaceConfig: { contextCounterV2: true },
        endpoints: { agents: { contextEstimate: { rateLimit: { burst: 2 } } } },
      } as never),
    ).toMatchObject({ enabled: true, burst: 2, perMinute: 30 });
    expect(
      resolveContextEstimateConfig({
        interfaceConfig: { contextCounterV2: true },
        endpoints: { agents: { contextEstimate: { enabled: false } } },
      } as never),
    ).toMatchObject({ enabled: false });
  });
});

describe('requireContextEstimateEnabled (§11)', () => {
  it('rejects with 403 while the v2 counter flag is off', () => {
    const res = makeRes();
    const next = jest.fn();
    requireContextEstimateEnabled(makeReq({ interfaceConfig: {} }), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes when the flag is on', () => {
    const res = makeRes();
    const next = jest.fn();
    requireContextEstimateEnabled(
      makeReq({ interfaceConfig: { contextCounterV2: true } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('createContextEstimateLimiter (§6.6)', () => {
  it('admits the burst per user + conversation and answers 429 with Retry-After', () => {
    let clock = 0;
    const middleware = createContextEstimateLimiter({ now: () => clock });
    const config = { interfaceConfig: { contextCounterV2: true } };
    const passes = (conversationId: string) => {
      const res = makeRes();
      const next = jest.fn();
      middleware(makeReq(config, { conversationId }), res, next);
      return { allowed: next.mock.calls.length === 1, res };
    };
    for (let i = 0; i < 5; i++) {
      expect(passes('c1').allowed).toBe(true);
    }
    const denied = passes('c1');
    expect(denied.allowed).toBe(false);
    expect(denied.res.statusCode).toBe(429);
    expect(denied.res.headers['Retry-After']).toBe('2');
    expect(passes('c2').allowed).toBe(true);
    clock += 2000;
    expect(passes('c1').allowed).toBe(true);
  });
});

describe('normalizeContextEstimateBody', () => {
  it('lifts bare file ids into the { file_id } shape the agent initializer hydrates', () => {
    const req = makeReq({}, { files: ['f1', { file_id: 'f2', type: 'image/png' }] });
    const next = jest.fn();
    normalizeContextEstimateBody(req, makeRes(), next);
    expect((req.body as { files: unknown }).files).toEqual([
      { file_id: 'f1' },
      { file_id: 'f2', type: 'image/png' },
    ]);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
