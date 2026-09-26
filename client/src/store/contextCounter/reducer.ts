import { CONTEXT_COUNTER_CONTRACT_VERSION } from 'librechat-data-provider';
import type {
  TContextStaleReason,
  TContextUsageTotals,
  TContextSessionUsage,
  TContextEstimateStatus,
  TContextNormalizedUsage,
  TContextLastCallMeasurement,
  TContextNextRequestEstimate,
} from 'librechat-data-provider';

/**
 * Client-side envelope around the server estimate: the client fingerprint the
 * request was built for, the lifecycle status and the revision that may still
 * resolve into it. `estimate` is kept through `stale` / `calculating` so the
 * menu can show «≈… · устарело, пересчитываем…» instead of a blank.
 */
export type EstimateEntry = {
  estimate: TContextNextRequestEstimate | null;
  /** Client fingerprint hash `estimate` answers; `null` for snapshot hydration. */
  fingerprint: string | null;
  status: TContextEstimateStatus;
  staleReason?: TContextStaleReason;
  errorCode?: string;
  /** Revision of the request whose answer is still awaited; `null` when idle. */
  pendingRevision: number | null;
  /** Fingerprint the pending request was built for. */
  pendingFingerprint: string | null;
};

/** Per-conversation slice of the three §7 stores, each keyed by branch leaf id (§10.11). */
export type ConversationCounterState = {
  lastCall: ReadonlyMap<string, TContextLastCallMeasurement>;
  sessionUsage: ReadonlyMap<string, TContextSessionUsage>;
  estimate: ReadonlyMap<string, EstimateEntry>;
  /** Idempotency keys already accumulated into `sessionUsage` (§10.13). */
  appliedEvents: ReadonlySet<string>;
};

export const EMPTY_COUNTER_STATE: ConversationCounterState = {
  lastCall: new Map(),
  sessionUsage: new Map(),
  estimate: new Map(),
  appliedEvents: new Set(),
};

export const EMPTY_SESSION_TOTALS: TContextUsageTotals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  calls: 0,
};

/**
 * Provider usage of one finished model call, already normalized (§5 table).
 * `eventId` is the idempotency key; a replay with the same id is a no-op.
 */
export type CompletedCallUsage = TContextNormalizedUsage & {
  eventId: string;
  /** `auxiliary` calls are «в том числе»; `compress` is its own line (§5). */
  kind?: 'primary' | 'auxiliary' | 'compress';
};

export type ContextCounterEvent =
  | {
      /** §7 table rows that only dirty the forecast; lastCall and sessionUsage are untouched. */
      type: 'invalidate';
      leafId: string;
      reason: TContextStaleReason;
    }
  | {
      type: 'estimate_requested';
      leafId: string;
      revision: number;
      fingerprint: string;
    }
  | {
      type: 'estimate_resolved';
      leafId: string;
      revision: number;
      fingerprint: string;
      estimate: TContextNextRequestEstimate;
    }
  | {
      type: 'estimate_failed';
      leafId: string;
      revision: number;
      errorCode: string;
    }
  | {
      /** Completed call: replace lastCall, accumulate sessionUsage along the branch, forecast re-estimates later. */
      type: 'call_completed';
      previousLeafId: string;
      leafId: string;
      measurement: TContextLastCallMeasurement;
      usage: CompletedCallUsage;
    }
  | {
      /** Server snapshot on load: fills what is missing, never overwrites a newer local entry. */
      type: 'hydrate';
      leafId: string;
      lastCall?: TContextLastCallMeasurement | null;
      sessionUsage?: TContextSessionUsage | null;
      estimate?: TContextNextRequestEstimate | null;
    };

const IDLE_ENTRY: EstimateEntry = {
  estimate: null,
  fingerprint: null,
  status: 'unavailable',
  pendingRevision: null,
  pendingFingerprint: null,
};

function withEntry(
  state: ConversationCounterState,
  leafId: string,
  entry: EstimateEntry,
): ConversationCounterState {
  const estimate = new Map(state.estimate);
  estimate.set(leafId, entry);
  return { ...state, estimate };
}

function invalidate(
  state: ConversationCounterState,
  leafId: string,
  reason: TContextStaleReason,
): ConversationCounterState {
  const entry = state.estimate.get(leafId);
  if (entry == null) {
    return state;
  }
  if (entry.estimate == null && entry.pendingRevision == null) {
    return state;
  }
  if (entry.status === 'stale' && entry.staleReason === reason && entry.pendingRevision == null) {
    return state;
  }
  return withEntry(state, leafId, {
    ...entry,
    status: 'stale',
    staleReason: reason,
    /** `sent` also retires the in-flight request: its answer must never land after Send (§6.2). */
    pendingRevision: reason === 'sent' ? null : entry.pendingRevision,
    pendingFingerprint: reason === 'sent' ? null : entry.pendingFingerprint,
  });
}

function requested(
  state: ConversationCounterState,
  leafId: string,
  revision: number,
  fingerprint: string,
): ConversationCounterState {
  const entry = state.estimate.get(leafId) ?? IDLE_ENTRY;
  return withEntry(state, leafId, {
    ...entry,
    status: 'calculating',
    pendingRevision: revision,
    pendingFingerprint: fingerprint,
  });
}

/** Server status wins when it is a terminal one; otherwise derive from completeness (§4). */
function statusOf(estimate: TContextNextRequestEstimate): TContextEstimateStatus {
  if (estimate.status === 'error' || estimate.status === 'unavailable') {
    return estimate.status;
  }
  if (estimate.source === 'unavailable') {
    return 'unavailable';
  }
  if (estimate.status === 'partial' || (estimate.incompleteReasons?.length ?? 0) > 0) {
    return 'partial';
  }
  return 'fresh';
}

function resolved(
  state: ConversationCounterState,
  leafId: string,
  revision: number,
  fingerprint: string,
  estimate: TContextNextRequestEstimate,
): ConversationCounterState {
  const entry = state.estimate.get(leafId);
  /** Late answers of an older revision, of a retired (Send) request, or for
   *  another branch are dropped whole (§10.15, §10.26, §10.11). */
  if (entry == null || entry.pendingRevision !== revision) {
    return state;
  }
  if (estimate.branchLeafId !== leafId) {
    return state;
  }
  const status = statusOf(estimate);
  return withEntry(state, leafId, {
    estimate,
    fingerprint,
    status,
    staleReason: undefined,
    errorCode: status === 'error' ? estimate.errorCode : undefined,
    pendingRevision: null,
    pendingFingerprint: null,
  });
}

function failed(
  state: ConversationCounterState,
  leafId: string,
  revision: number,
  errorCode: string,
): ConversationCounterState {
  const entry = state.estimate.get(leafId);
  if (entry == null || entry.pendingRevision !== revision) {
    return state;
  }
  return withEntry(state, leafId, {
    ...entry,
    status: 'error',
    errorCode,
    pendingRevision: null,
    pendingFingerprint: null,
  });
}

function addTotals(base: TContextUsageTotals, usage: CompletedCallUsage): TContextUsageTotals {
  return {
    input: base.input + usage.inputUncached,
    output: base.output + usage.output,
    cacheRead: base.cacheRead + usage.cacheRead,
    cacheWrite: base.cacheWrite + usage.cacheWrite,
    calls: base.calls + 1,
  };
}

function accumulateSession(
  previous: TContextSessionUsage | undefined,
  conversationId: string,
  leafId: string,
  usage: CompletedCallUsage,
  now: number,
): TContextSessionUsage {
  const base: TContextUsageTotals = previous ?? EMPTY_SESSION_TOTALS;
  const totals = addTotals(base, usage);
  const kind = usage.kind ?? 'primary';
  return {
    version: CONTEXT_COUNTER_CONTRACT_VERSION,
    conversationId,
    branchLeafId: leafId,
    scope: 'branch',
    ...totals,
    complete: previous?.complete ?? true,
    /** One call that could not be split hides the cache rows for the whole branch (§5). */
    cacheSplittable: (previous?.cacheSplittable ?? true) && usage.cacheSplittable,
    auxiliary:
      kind === 'auxiliary'
        ? addTotals(previous?.auxiliary ?? EMPTY_SESSION_TOTALS, usage)
        : previous?.auxiliary,
    compress:
      kind === 'compress'
        ? addTotals(previous?.compress ?? EMPTY_SESSION_TOTALS, usage)
        : previous?.compress,
    updatedAt: now,
    lastEventId: usage.eventId,
  };
}

function callCompleted(
  state: ConversationCounterState,
  event: Extract<ContextCounterEvent, { type: 'call_completed' }>,
  now: number,
): ConversationCounterState {
  const { previousLeafId, leafId, measurement, usage } = event;
  if (state.appliedEvents.has(usage.eventId)) {
    return state;
  }
  const lastCall = new Map(state.lastCall);
  lastCall.set(leafId, measurement);

  const sessionUsage = new Map(state.sessionUsage);
  /** A tool loop lands several calls on the same new leaf: continue from the
   *  leaf's own running total once it exists, else from the branch it grew from. */
  const base = state.sessionUsage.get(leafId) ?? state.sessionUsage.get(previousLeafId);
  sessionUsage.set(leafId, accumulateSession(base, measurement.conversationId, leafId, usage, now));

  const appliedEvents = new Set(state.appliedEvents);
  appliedEvents.add(usage.eventId);
  return { ...state, lastCall, sessionUsage, appliedEvents };
}

/** Re-deriving from the same persisted messages must not produce a new reference. */
function sameMeasurement(
  a: TContextLastCallMeasurement | undefined,
  b: TContextLastCallMeasurement,
): boolean {
  return (
    a != null &&
    a.callId === b.callId &&
    a.responseMessageId === b.responseMessageId &&
    a.input === b.input &&
    a.output === b.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite &&
    a.source === b.source &&
    a.budget.budget === b.budget.budget &&
    a.budget.window === b.budget.window
  );
}

function sameTotals(a: TContextSessionUsage | undefined, b: TContextSessionUsage): boolean {
  return (
    a != null &&
    a.input === b.input &&
    a.output === b.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite &&
    a.calls === b.calls &&
    a.complete === b.complete &&
    a.cacheSplittable === b.cacheSplittable &&
    a.lastEventId === b.lastEventId
  );
}

function hydrate(
  state: ConversationCounterState,
  event: Extract<ContextCounterEvent, { type: 'hydrate' }>,
): ConversationCounterState {
  let next = state;
  const { leafId } = event;

  if (event.lastCall != null) {
    const current = state.lastCall.get(leafId);
    const newer = current == null || current.measuredAt < event.lastCall.measuredAt;
    if (newer && !sameMeasurement(current, event.lastCall)) {
      const lastCall = new Map(next.lastCall);
      lastCall.set(leafId, event.lastCall);
      next = { ...next, lastCall };
    }
  }

  if (event.sessionUsage != null) {
    const current = state.sessionUsage.get(leafId);
    const newer = current == null || current.updatedAt < event.sessionUsage.updatedAt;
    if (newer && !sameTotals(current, event.sessionUsage)) {
      const sessionUsage = new Map(next.sessionUsage);
      sessionUsage.set(leafId, event.sessionUsage);
      next = { ...next, sessionUsage };
    }
  }

  if (event.estimate != null) {
    const current = state.estimate.get(leafId);
    /** A live entry (fresh, pending, or already stale) outranks a persisted
     *  forecast; a persisted forecast cannot prove currency, so it arrives
     *  `stale` and the next menu open re-estimates (§7 «перезагрузка»). */
    if (current == null || (current.estimate == null && current.pendingRevision == null)) {
      next = withEntry(next, leafId, {
        estimate: event.estimate,
        fingerprint: null,
        status: 'stale',
        staleReason: 'unknown',
        pendingRevision: null,
        pendingFingerprint: null,
      });
    }
  }

  return next;
}

/**
 * Pure §7 invalidation table. Returns the same reference when nothing
 * changes so atom writers can skip a write.
 */
export function reduceContextCounter(
  state: ConversationCounterState,
  event: ContextCounterEvent,
  now: number = Date.now(),
): ConversationCounterState {
  switch (event.type) {
    case 'invalidate':
      return invalidate(state, event.leafId, event.reason);
    case 'estimate_requested':
      return requested(state, event.leafId, event.revision, event.fingerprint);
    case 'estimate_resolved':
      return resolved(state, event.leafId, event.revision, event.fingerprint, event.estimate);
    case 'estimate_failed':
      return failed(state, event.leafId, event.revision, event.errorCode);
    case 'call_completed':
      return callCompleted(state, event, now);
    case 'hydrate':
      return hydrate(state, event);
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
