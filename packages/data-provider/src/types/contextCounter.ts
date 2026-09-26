/**
 * Shared contract for the context counter v2 (ТЗ «доработка счётчика
 * контекста v2», §5 formulas, §7 stores). Three independent stores share the
 * identity, budget and composition shapes defined here; the pure formulas that
 * operate on them live in `../counter`.
 *
 * Wire and store field names are canonical: `lastCall.input | output |
 * cacheRead | cacheWrite`, `sessionUsage.input | output | cacheRead |
 * cacheWrite`, estimate statuses `fresh | calculating | stale | partial |
 * unavailable | error`. Integers only — display rounding happens at render.
 */

/** Bump when a persisted snapshot's shape changes incompatibly. */
export const CONTEXT_COUNTER_CONTRACT_VERSION = 1 as const;
export type TContextCounterContractVersion = typeof CONTEXT_COUNTER_CONTRACT_VERSION;

/** §7 estimate lifecycle. */
export const contextEstimateStatuses = [
  'fresh',
  'calculating',
  'stale',
  'partial',
  'unavailable',
  'error',
] as const;
export type TContextEstimateStatus = (typeof contextEstimateStatuses)[number];

/**
 * Where a number came from (§1.4, §3, §6.4). Only `provider` may be labelled
 * «данные провайдера»; `server_estimate` is the dry-run of the Send pipeline;
 * `tokenizer_estimate` is a local tokenizer count that is not the Send plan;
 * `unavailable` means «Нет данных» — never a silent `chars/4` guess.
 */
export const contextMeasurementSources = [
  'provider',
  'server_estimate',
  'tokenizer_estimate',
  'unavailable',
] as const;
export type TContextMeasurementSource = (typeof contextMeasurementSources)[number];

/** Why an estimate or measurement no longer describes the current configuration (§4, §7). */
export const contextStaleReasons = [
  'model_changed',
  'limits_changed',
  'tools_changed',
  'instructions_changed',
  'history_changed',
  'draft_changed',
  'attachments_changed',
  'branch_changed',
  'compressed',
  'tokenizer_changed',
  'sent',
  'unknown',
] as const;
export type TContextStaleReason = (typeof contextStaleReasons)[number];

/** Why an estimate is `partial` (§4 «Оценка неполная», §6). */
export const contextIncompleteReasons = [
  'attachment_pending',
  'tool_schemas_pending',
  'tokenizer_unavailable',
  'summary_pending',
  'other',
] as const;
export type TContextIncompleteReason = (typeof contextIncompleteReasons)[number];

/** Model/agent configuration a measurement was taken for (§1.3, §3 badge «измерено для {модель}»). */
export type TContextConfiguration = {
  endpoint?: string;
  provider?: string;
  model?: string;
  agentId?: string | null;
  /** Tokenizer / counting method identity; part of the fingerprint (§7). */
  countingMethod?: string;
};

/**
 * §5 budget terms. `window` (W) and `inputLimit` (L) are `null` when unknown;
 * `budget` (B) is `null` whenever it cannot be derived — the UI then shows the
 * volume without a percent. `B ≤ 0` is a valid, non-null state («бюджет
 * исчерпан резервом»).
 */
export type TContextBudget = {
  /** W — full model window. */
  window: number | null;
  /** R — output reserve subtracted from the window. */
  reserve: number;
  /** L — separate input limit, when the model has one. */
  inputLimit: number | null;
  /** B = min(W − R, L) when L is set, else W − R. */
  budget: number | null;
};

/**
 * §5 `occupied` composition. Every key is a `●` segment; their sum is
 * `occupied` and equals the header number. Cache is NOT a key here — it is an
 * overlay (`TContextCacheOverlay`). Retained summary tokens count under
 * `messages`; built-in tool schemas and skills count under `systemPrompt`;
 * only MCP tool schemas count under `mcpTools`; memory, dynamic instructions
 * and provider framing count under `other`.
 */
export const contextOccupiedKeys = [
  'messages',
  'toolCalls',
  'systemPrompt',
  'mcpTools',
  'attachments',
  'other',
] as const;
export type TContextOccupiedKey = (typeof contextOccupiedKeys)[number];
export type TContextOccupied = Record<TContextOccupiedKey, number>;

/**
 * §5 cache rows: an intersection of `occupied`, never a summand. `null` means
 * «—» / unknown (no honest expected hit before a call, or a provider that does
 * not report cache).
 */
export type TContextCacheOverlay = {
  read: number | null;
  write: number | null;
};

/** One message the next request will not carry (§4 popover «Что не войдёт?»). */
export type TContextExcludedMessage = {
  messageId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  /** Short preview for the popover; never the full body. */
  preview?: string;
  tokens?: number;
  createdAt?: string;
};

export const contextExclusionReasons = [
  'over_budget',
  'summarized',
  'tool_pair_dropped',
  'unsupported_content',
  'other',
] as const;
export type TContextExclusionReason = (typeof contextExclusionReasons)[number];

/**
 * Server plan of what history the next request drops (§4 «История не
 * помещается»). Only the server plan may produce this — the client never
 * infers a count. The warning is driven by `count > 0`, not by fill%.
 */
export type TContextExclusionPlan = {
  count: number;
  reason: TContextExclusionReason;
  /** Oldest-first; may be truncated for transport — `count` stays authoritative. */
  messages: TContextExcludedMessage[];
  /** Tokens of the whole branch before pruning, when known (drives the «108%» text). */
  prePruneTokens?: number;
};

/** Identity shared by every store entry (§7 «идентификаторы вызова и ветки»). */
export type TContextIdentity = {
  version: TContextCounterContractVersion;
  conversationId: string;
  /** Leaf message id of the branch the entry describes; branch = root → this leaf. */
  branchLeafId: string;
};

/**
 * §7 `lastCallMeasurement` — immutable once the call completes. Percent is
 * always computed against `budget.budget` of THIS record, never the current
 * configuration's budget (§3). `output` is stored and never added to `input`.
 */
export type TContextLastCallMeasurement = TContextIdentity & {
  /** Run / model-call id the measurement belongs to. */
  callId: string;
  /** Response message the call produced, when known. */
  responseMessageId?: string;
  measuredAt: number;
  configuration: TContextConfiguration;
  /** `provider` when provider usage arrived; `server_estimate` otherwise (§10.5). */
  source: Extract<TContextMeasurementSource, 'provider' | 'server_estimate'>;
  /** False when part of the composition or cache could not be resolved. */
  complete: boolean;
  budget: TContextBudget;
  /** Full prompt of the call, cache included exactly once (§5 normalization table). */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /**
   * Composition of `input`; `null` when only the total is confirmed («Общий
   * объём получен от провайдера. Состав — оценка.» when `compositionSource`
   * is an estimate, hidden when `unavailable`).
   */
  composition: TContextOccupied | null;
  compositionSource: TContextMeasurementSource;
  /** True when cache exceeds `occupied` after normalization — show, mark «не сходится», do not clamp (§5). */
  compositionMismatch?: boolean;
};

/**
 * §7 `nextRequestEstimate` — the dry-run plan for the current configuration,
 * draft and attachments. Replaced on every fresh estimate; `revision` and
 * `fingerprint` let the client drop late responses (§6 invariants 2–3).
 */
export type TContextNextRequestEstimate = TContextIdentity & {
  revision: number;
  fingerprint: string;
  status: TContextEstimateStatus;
  staleReason?: TContextStaleReason;
  incompleteReasons?: TContextIncompleteReason[];
  /** Never `provider` for an estimate (§10.5, §10.28). */
  source: Exclude<TContextMeasurementSource, 'provider'>;
  computedAt: number;
  configuration: TContextConfiguration;
  budget: TContextBudget;
  occupied: TContextOccupied;
  cache: TContextCacheOverlay;
  /** `null` when the whole history fits. */
  excluded: TContextExclusionPlan | null;
  /** Machine-readable error code for `status: 'error'`; the UI localizes it. */
  errorCode?: string;
};

/** One bucket of accumulated spend. All four are independent counters (§5 «Расход сессии»). */
export type TContextUsageTotals = {
  /** Uncached input only — never includes `cacheRead` (§10.22). */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  calls: number;
};

/**
 * §7 `sessionUsage` — spend along the current branch (root → leaf), not window
 * fill. `auxiliary` calls are already inside the totals and shown as «в том
 * числе»; `compress` events are their own line. `complete === false` renders
 * «неполно» when events were lost.
 */
export type TContextSessionUsage = TContextIdentity &
  TContextUsageTotals & {
    scope: 'branch';
    complete: boolean;
    /** Whether the provider let input be split from cache; when false the cache rows are hidden (§5). */
    cacheSplittable: boolean;
    auxiliary?: TContextUsageTotals;
    compress?: TContextUsageTotals;
    updatedAt: number;
    /** Last applied idempotency key, for replay detection (§10.13). */
    lastEventId?: string;
  };

/** Fields that participate in the next-request fingerprint (§7 «Fingerprint / инвалидация»). */
export type TContextFingerprintInput = {
  configuration: TContextConfiguration;
  window: number | null;
  reserve: number;
  inputLimit: number | null;
  /** Hash or version of the effective instructions (system prompt + dynamic). */
  instructionsHash?: string;
  /** Sorted tool identities (built-in, MCP, skills). */
  toolIds: string[];
  skillIds?: string[];
  /** Any context-assembly setting that changes the plan (summarization mode, fading tier, …). */
  assemblySettingsHash?: string;
  branchLeafId: string;
  /** Latest history revision on the branch (e.g. last message id + edit stamp). */
  historyRevision: string;
  draftHash?: string;
  attachmentIds: string[];
  summaryRevision?: string;
};

/** Provider usage as emitted by the SDK / providers before normalization (§5 table). */
export type TProviderUsageLangChain = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_token_details?: { cache_read?: number; cache_creation?: number };
  provider?: string;
  model?: string;
};

export type TProviderUsageAnthropic = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export type TProviderUsageOpenAI = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

export type TProviderUsageGemini = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
};

export type TProviderUsageRaw =
  | TProviderUsageLangChain
  | TProviderUsageAnthropic
  | TProviderUsageOpenAI
  | TProviderUsageGemini;

/**
 * Normalized call usage (§5 «Нормализация provider usage»). `input` is the
 * full prompt with cache counted exactly once; `inputUncached` is what the
 * session «Вход» row accumulates; `cacheSplittable === false` means the
 * provider gave only a confirmed total, so cache rows are hidden.
 */
export type TContextNormalizedUsage = {
  input: number;
  inputUncached: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheSplittable: boolean;
  provider: string | null;
};
