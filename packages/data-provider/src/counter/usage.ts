import type {
  TProviderUsageRaw,
  TContextUsageTotals,
  TProviderUsageGemini,
  TProviderUsageOpenAI,
  TProviderUsageAnthropic,
  TProviderUsageLangChain,
  TContextNormalizedUsage,
} from '../types/contextCounter';
import { inputTokensIncludesCache } from '../schemas';
import { toTokenInteger } from './budget';

/** Which §5 normalization row a raw payload falls under, decided by its shape — not by the provider name alone. */
export type TProviderUsageShape = 'anthropic' | 'openai' | 'gemini' | 'langchain' | 'unknown';

function hasOwn(raw: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

/**
 * Anthropic's raw API reports cache OUTSIDE `input_tokens`
 * (`cache_read_input_tokens`, `cache_creation_input_tokens`); the LangChain
 * adapter folds them INTO `input_tokens` and moves them to
 * `input_token_details`. The two shapes need opposite arithmetic, so the shape
 * is detected first and the provider name only decides the LangChain case.
 */
export function detectProviderUsageShape(raw: unknown): TProviderUsageShape {
  if (raw == null || typeof raw !== 'object') {
    return 'unknown';
  }
  if (hasOwn(raw, 'promptTokenCount') || hasOwn(raw, 'candidatesTokenCount')) {
    return 'gemini';
  }
  if (hasOwn(raw, 'prompt_tokens') || hasOwn(raw, 'completion_tokens')) {
    return 'openai';
  }
  if (hasOwn(raw, 'cache_read_input_tokens') || hasOwn(raw, 'cache_creation_input_tokens')) {
    return 'anthropic';
  }
  if (hasOwn(raw, 'input_tokens') || hasOwn(raw, 'output_tokens')) {
    return 'langchain';
  }
  return 'unknown';
}

function normalizeOpenAI(raw: TProviderUsageOpenAI): TContextNormalizedUsage {
  const input = toTokenInteger(raw.prompt_tokens);
  const cacheRead = Math.min(input, toTokenInteger(raw.prompt_tokens_details?.cached_tokens));
  const output = toTokenInteger(raw.completion_tokens);
  return {
    input,
    inputUncached: input - cacheRead,
    output,
    cacheRead,
    cacheWrite: 0,
    cacheSplittable: true,
    provider: 'openai',
  };
}

function normalizeGemini(raw: TProviderUsageGemini): TContextNormalizedUsage {
  const input = toTokenInteger(raw.promptTokenCount);
  const cacheRead = Math.min(input, toTokenInteger(raw.cachedContentTokenCount));
  const candidates = toTokenInteger(raw.candidatesTokenCount);
  const thoughts = toTokenInteger(raw.thoughtsTokenCount);
  const total = toTokenInteger(raw.totalTokenCount);
  /** `totalTokenCount` includes thoughts even when `candidatesTokenCount` does not. */
  const output =
    total > input ? Math.max(total - input, candidates + thoughts) : candidates + thoughts;
  return {
    input,
    inputUncached: input - cacheRead,
    output,
    cacheRead,
    cacheWrite: 0,
    cacheSplittable: true,
    provider: 'google',
  };
}

function normalizeAnthropicRaw(raw: TProviderUsageAnthropic): TContextNormalizedUsage {
  const uncached = toTokenInteger(raw.input_tokens);
  const cacheRead = toTokenInteger(raw.cache_read_input_tokens);
  const cacheWrite = toTokenInteger(raw.cache_creation_input_tokens);
  return {
    input: uncached + cacheRead + cacheWrite,
    inputUncached: uncached,
    output: toTokenInteger(raw.output_tokens),
    cacheRead,
    cacheWrite,
    cacheSplittable: true,
    provider: 'anthropic',
  };
}

function normalizeLangChain(
  raw: TProviderUsageLangChain,
  provider: string | null,
): TContextNormalizedUsage {
  const rawInput = toTokenInteger(raw.input_tokens);
  const rawOutput = toTokenInteger(raw.output_tokens);
  const total = toTokenInteger(raw.total_tokens);
  const cacheRead = toTokenInteger(raw.input_token_details?.cache_read);
  const cacheWrite = toTokenInteger(raw.input_token_details?.cache_creation);
  const hasCache = cacheRead + cacheWrite > 0;
  const knownProvider = provider != null && provider !== '';
  /**
   * Known provider: the shared subset/additive table decides. Unknown
   * provider: only the confirmed total is trusted — a magnitude check picks
   * the total that is not obviously wrong, and the cache split is withheld
   * (§5 «Неизвестный: состав скрыть, не раскладывать догадкой»).
   */
  const includesCache = knownProvider
    ? inputTokensIncludesCache(provider)
    : cacheRead + cacheWrite <= rawInput;
  const input = includesCache ? rawInput : rawInput + cacheRead + cacheWrite;
  const cacheAdjustment = includesCache ? 0 : cacheRead + cacheWrite;
  /** Providers that under-report `output_tokens` carry the gap in `total_tokens`. */
  const output =
    total > rawInput + rawOutput + cacheAdjustment ? total - rawInput - cacheAdjustment : rawOutput;
  const cacheSplittable = knownProvider || !hasCache;
  const boundedRead = Math.min(cacheRead, input);
  const boundedWrite = Math.min(cacheWrite, Math.max(0, input - boundedRead));
  return {
    input,
    inputUncached: cacheSplittable ? input - boundedRead - boundedWrite : input,
    output,
    cacheRead: cacheSplittable ? boundedRead : 0,
    cacheWrite: cacheSplittable ? boundedWrite : 0,
    cacheSplittable,
    provider: knownProvider ? provider : null,
  };
}

/**
 * §5 «Нормализация provider usage». Returns `null` when the payload has no
 * recognizable input field — the caller then reports «недоступен» instead of
 * inventing a number. `input` always counts cache exactly once (§10.7,
 * §10.22); `inputUncached` feeds the session «Вход» row.
 */
export function normalizeProviderUsage(
  raw: TProviderUsageRaw | null | undefined,
  provider?: string | null,
): TContextNormalizedUsage | null {
  const shape = detectProviderUsageShape(raw);
  switch (shape) {
    case 'openai':
      return normalizeOpenAI(raw as TProviderUsageOpenAI);
    case 'gemini':
      return normalizeGemini(raw as TProviderUsageGemini);
    case 'anthropic':
      return normalizeAnthropicRaw(raw as TProviderUsageAnthropic);
    case 'langchain': {
      const langchain = raw as TProviderUsageLangChain;
      return normalizeLangChain(langchain, provider ?? langchain.provider ?? null);
    }
    case 'unknown':
      return null;
    default: {
      const exhaustive: never = shape;
      return exhaustive;
    }
  }
}

export const EMPTY_CONTEXT_USAGE_TOTALS: TContextUsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  calls: 0,
};

/**
 * §5 «Расход сессии»: four independent counters. «Вход» is the uncached input
 * only; cache read/write are their own rows; output is separate. When the
 * provider could not split cache, the whole confirmed input goes to «Вход» and
 * the cache rows stay at 0 (hidden).
 */
export function splitSessionUsage(usage: TContextNormalizedUsage): TContextUsageTotals {
  if (!usage.cacheSplittable) {
    return { input: usage.input, output: usage.output, cacheRead: 0, cacheWrite: 0, calls: 1 };
  }
  return {
    input: usage.inputUncached,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    calls: 1,
  };
}

/** Pure sum of two spend buckets. */
export function addContextUsageTotals(
  a: TContextUsageTotals,
  b: TContextUsageTotals,
): TContextUsageTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    calls: a.calls + b.calls,
  };
}

/**
 * Folds normalized call usages into session totals, applying each
 * `eventId` once (§10.13). `seen` is the caller-owned idempotency set so a
 * replayed stream cannot double a call; events without an id are always folded.
 */
export function accumulateSessionUsage(
  events: ReadonlyArray<{ eventId?: string | null; usage: TContextNormalizedUsage }>,
  seen: Set<string> = new Set<string>(),
  initial: TContextUsageTotals = EMPTY_CONTEXT_USAGE_TOTALS,
): { totals: TContextUsageTotals; cacheSplittable: boolean } {
  let totals = initial;
  let cacheSplittable = true;
  for (const event of events) {
    if (event.eventId != null && event.eventId !== '') {
      if (seen.has(event.eventId)) {
        continue;
      }
      seen.add(event.eventId);
    }
    if (!event.usage.cacheSplittable) {
      cacheSplittable = false;
    }
    totals = addContextUsageTotals(totals, splitSessionUsage(event.usage));
  }
  return { totals, cacheSplittable };
}
