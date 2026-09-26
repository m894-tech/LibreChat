import type { TContextNormalizedUsage } from '../types/contextCounter';
import {
  splitSessionUsage,
  addContextUsageTotals,
  accumulateSessionUsage,
  normalizeProviderUsage,
  detectProviderUsageShape,
  EMPTY_CONTEXT_USAGE_TOTALS,
} from './usage';

describe('detectProviderUsageShape', () => {
  it('keys on payload shape, not provider name', () => {
    expect(detectProviderUsageShape({ prompt_tokens: 1 })).toBe('openai');
    expect(detectProviderUsageShape({ promptTokenCount: 1 })).toBe('gemini');
    expect(detectProviderUsageShape({ input_tokens: 1, cache_read_input_tokens: 2 })).toBe(
      'anthropic',
    );
    expect(
      detectProviderUsageShape({ input_tokens: 1, input_token_details: { cache_read: 2 } }),
    ).toBe('langchain');
    expect(detectProviderUsageShape({ total: 5 })).toBe('unknown');
    expect(detectProviderUsageShape(null)).toBe('unknown');
  });
});

describe('normalizeProviderUsage — §5 table', () => {
  describe('Anthropic', () => {
    it('raw API: input = input_tokens + cache_read + cache_creation (cache counted once)', () => {
      const usage = normalizeProviderUsage({
        input_tokens: 1_000,
        output_tokens: 400,
        cache_read_input_tokens: 60_000,
        cache_creation_input_tokens: 2_000,
      });
      expect(usage).toEqual({
        input: 63_000,
        inputUncached: 1_000,
        output: 400,
        cacheRead: 60_000,
        cacheWrite: 2_000,
        cacheSplittable: true,
        provider: 'anthropic',
      });
    });

    it('LangChain shape: cache already inside input_tokens is not added a second time (§10.7, §10.22)', () => {
      const usage = normalizeProviderUsage(
        {
          input_tokens: 63_000,
          output_tokens: 400,
          total_tokens: 63_400,
          input_token_details: { cache_read: 60_000, cache_creation: 2_000 },
        },
        'anthropic',
      );
      expect(usage).toEqual({
        input: 63_000,
        inputUncached: 1_000,
        output: 400,
        cacheRead: 60_000,
        cacheWrite: 2_000,
        cacheSplittable: true,
        provider: 'anthropic',
      });
    });

    it('reads the provider from the payload when the caller omits it', () => {
      const usage = normalizeProviderUsage({
        input_tokens: 63_000,
        output_tokens: 400,
        provider: 'anthropic',
        input_token_details: { cache_read: 60_000 },
      });
      expect(usage?.input).toBe(63_000);
      expect(usage?.inputUncached).toBe(3_000);
    });
  });

  describe('OpenAI', () => {
    it('prompt_tokens is the full input; cached_tokens is a subset', () => {
      const usage = normalizeProviderUsage({
        prompt_tokens: 72_000,
        completion_tokens: 4_000,
        total_tokens: 76_000,
        prompt_tokens_details: { cached_tokens: 50_000 },
      });
      expect(usage).toEqual({
        input: 72_000,
        inputUncached: 22_000,
        output: 4_000,
        cacheRead: 50_000,
        cacheWrite: 0,
        cacheSplittable: true,
        provider: 'openai',
      });
    });

    it('without prompt_tokens_details cache is 0 and input is untouched', () => {
      const usage = normalizeProviderUsage({ prompt_tokens: 100, completion_tokens: 10 });
      expect(usage?.input).toBe(100);
      expect(usage?.inputUncached).toBe(100);
      expect(usage?.cacheRead).toBe(0);
    });

    it('a malformed cached_tokens larger than the prompt is bounded', () => {
      const usage = normalizeProviderUsage({
        prompt_tokens: 100,
        prompt_tokens_details: { cached_tokens: 250 },
      });
      expect(usage?.cacheRead).toBe(100);
      expect(usage?.inputUncached).toBe(0);
    });

    it('LangChain shape for OpenAI: subset provider', () => {
      const usage = normalizeProviderUsage(
        { input_tokens: 72_000, output_tokens: 4_000, input_token_details: { cache_read: 50_000 } },
        'openAI',
      );
      expect(usage?.input).toBe(72_000);
      expect(usage?.inputUncached).toBe(22_000);
      expect(usage?.cacheRead).toBe(50_000);
    });
  });

  describe('Gemini', () => {
    it('promptTokenCount already includes cachedContentTokenCount', () => {
      const usage = normalizeProviderUsage({
        promptTokenCount: 30_000,
        candidatesTokenCount: 800,
        cachedContentTokenCount: 20_000,
        totalTokenCount: 30_800,
      });
      expect(usage).toEqual({
        input: 30_000,
        inputUncached: 10_000,
        output: 800,
        cacheRead: 20_000,
        cacheWrite: 0,
        cacheSplittable: true,
        provider: 'google',
      });
    });

    it('recovers thoughts from totalTokenCount when candidates omit them', () => {
      const usage = normalizeProviderUsage({
        promptTokenCount: 1_000,
        candidatesTokenCount: 200,
        thoughtsTokenCount: 300,
        totalTokenCount: 1_500,
      });
      expect(usage?.output).toBe(500);
    });

    it('LangChain shape for Google/Vertex: subset provider', () => {
      const usage = normalizeProviderUsage(
        { input_tokens: 30_000, output_tokens: 800, input_token_details: { cache_read: 20_000 } },
        'google',
      );
      expect(usage?.input).toBe(30_000);
      expect(usage?.inputUncached).toBe(10_000);
    });
  });

  describe('additive LangChain provider (Bedrock)', () => {
    it('adds cache back to input and repairs output from total_tokens', () => {
      const usage = normalizeProviderUsage(
        {
          input_tokens: 1_000,
          output_tokens: 100,
          total_tokens: 63_100,
          input_token_details: { cache_read: 60_000, cache_creation: 2_000 },
        },
        'bedrock',
      );
      expect(usage?.input).toBe(63_000);
      expect(usage?.inputUncached).toBe(1_000);
      expect(usage?.cacheRead).toBe(60_000);
      expect(usage?.cacheWrite).toBe(2_000);
      expect(usage?.output).toBe(100);
    });

    it('repairs an under-reported output (Vertex) without touching cache', () => {
      const usage = normalizeProviderUsage(
        { input_tokens: 1_000, output_tokens: 100, total_tokens: 1_400 },
        'vertexai',
      );
      expect(usage?.output).toBe(400);
    });
  });

  describe('unknown', () => {
    it('unknown provider with cache: only the confirmed total, composition withheld', () => {
      const usage = normalizeProviderUsage({
        input_tokens: 63_000,
        output_tokens: 400,
        input_token_details: { cache_read: 60_000 },
      });
      expect(usage).toEqual({
        input: 63_000,
        inputUncached: 63_000,
        output: 400,
        cacheRead: 0,
        cacheWrite: 0,
        cacheSplittable: false,
        provider: null,
      });
    });

    it('unknown provider whose cache exceeds input is read as additive but still withheld', () => {
      const usage = normalizeProviderUsage({
        input_tokens: 1_000,
        input_token_details: { cache_read: 60_000 },
      });
      expect(usage?.input).toBe(61_000);
      expect(usage?.cacheSplittable).toBe(false);
      expect(usage?.cacheRead).toBe(0);
    });

    it('unknown provider without cache stays splittable (nothing to hide)', () => {
      const usage = normalizeProviderUsage({ input_tokens: 500, output_tokens: 20 });
      expect(usage?.cacheSplittable).toBe(true);
      expect(usage?.inputUncached).toBe(500);
    });

    it('unrecognized shape yields null — no invented number', () => {
      expect(normalizeProviderUsage({ tokens: 12 } as never)).toBeNull();
      expect(normalizeProviderUsage(null)).toBeNull();
      expect(normalizeProviderUsage(undefined)).toBeNull();
    });
  });

  it('§10.2: output is never folded into input', () => {
    const usage = normalizeProviderUsage({ prompt_tokens: 72_000, completion_tokens: 4_000 });
    expect(usage?.input).toBe(72_000);
    expect(usage?.output).toBe(4_000);
  });
});

describe('session usage split (§5 «Расход сессии», §10.22)', () => {
  const anthropic: TContextNormalizedUsage = {
    input: 63_000,
    inputUncached: 1_000,
    output: 400,
    cacheRead: 60_000,
    cacheWrite: 2_000,
    cacheSplittable: true,
    provider: 'anthropic',
  };

  it('«Вход» excludes cache read AND cache write; both cache rows are separate', () => {
    expect(splitSessionUsage(anthropic)).toEqual({
      input: 1_000,
      output: 400,
      cacheRead: 60_000,
      cacheWrite: 2_000,
      calls: 1,
    });
  });

  it('OpenAI: input = prompt_tokens − cached_tokens', () => {
    const openai = normalizeProviderUsage({
      prompt_tokens: 72_000,
      completion_tokens: 4_000,
      prompt_tokens_details: { cached_tokens: 50_000 },
    });
    expect(splitSessionUsage(openai as TContextNormalizedUsage)).toEqual({
      input: 22_000,
      output: 4_000,
      cacheRead: 50_000,
      cacheWrite: 0,
      calls: 1,
    });
  });

  it('when cache cannot be split, the whole input is «Вход» and cache rows are 0', () => {
    expect(splitSessionUsage({ ...anthropic, cacheSplittable: false })).toEqual({
      input: 63_000,
      output: 400,
      cacheRead: 0,
      cacheWrite: 0,
      calls: 1,
    });
  });

  it('adds buckets field by field', () => {
    expect(
      addContextUsageTotals(
        { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, calls: 1 },
        { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, calls: 2 },
      ),
    ).toEqual({ input: 11, output: 22, cacheRead: 33, cacheWrite: 44, calls: 3 });
  });

  it('§10.13: a replayed event id is folded exactly once', () => {
    const seen = new Set<string>();
    const first = accumulateSessionUsage(
      [
        { eventId: 'run-1:0', usage: anthropic },
        { eventId: 'run-1:1', usage: anthropic },
      ],
      seen,
    );
    expect(first.totals).toEqual({
      input: 2_000,
      output: 800,
      cacheRead: 120_000,
      cacheWrite: 4_000,
      calls: 2,
    });
    const replayed = accumulateSessionUsage(
      [
        { eventId: 'run-1:1', usage: anthropic },
        { eventId: 'run-1:2', usage: anthropic },
      ],
      seen,
      first.totals,
    );
    expect(replayed.totals.calls).toBe(3);
    expect(replayed.totals.cacheRead).toBe(180_000);
  });

  it('marks the session unsplittable when any call withheld its cache split', () => {
    const result = accumulateSessionUsage([
      { usage: anthropic },
      { usage: { ...anthropic, cacheSplittable: false } },
    ]);
    expect(result.cacheSplittable).toBe(false);
    expect(result.totals.input).toBe(64_000);
  });

  it('starts from the empty bucket', () => {
    expect(accumulateSessionUsage([]).totals).toEqual(EMPTY_CONTEXT_USAGE_TOTALS);
  });
});
