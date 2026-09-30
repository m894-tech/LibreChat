import { atomFamily } from 'jotai/utils';
import { atom, getDefaultStore } from 'jotai';
import type { TContextSessionUsage, TContextLastCallMeasurement } from 'librechat-data-provider';
import type { ConversationCounterState, ContextCounterEvent, EstimateEntry } from './reducer';
import { reduceContextCounter } from './reducer';

export type JotaiStore = ReturnType<typeof getDefaultStore>;

/** Which number the menu header shows; survives menu close (§3 «Закрытие меню не сбрасывает режим»). */
export type ContextViewMode = 'next' | 'last';

const EMPTY_LAST_CALL: ReadonlyMap<string, TContextLastCallMeasurement> = new Map();
const EMPTY_SESSION: ReadonlyMap<string, TContextSessionUsage> = new Map();
const EMPTY_ESTIMATE: ReadonlyMap<string, EstimateEntry> = new Map();

/**
 * The three §7 stores, owned by the conversation and keyed inside by branch
 * leaf id. Nothing here is cleared when the menu closes or the indicator
 * unmounts (§10.14); entries are bounded by the leaves visited this session.
 */
export const lastCallFamily = atomFamily((_conversationId: string) =>
  atom<ReadonlyMap<string, TContextLastCallMeasurement>>(EMPTY_LAST_CALL),
);

export const sessionUsageFamily = atomFamily((_conversationId: string) =>
  atom<ReadonlyMap<string, TContextSessionUsage>>(EMPTY_SESSION),
);

export const nextEstimateFamily = atomFamily((_conversationId: string) =>
  atom<ReadonlyMap<string, EstimateEntry>>(EMPTY_ESTIMATE),
);

export const contextViewModeFamily = atomFamily((_conversationId: string) =>
  atom<ContextViewMode>('next'),
);

/** Idempotency keys per conversation; not reactive, so held outside the atoms. */
const appliedEventsByConversation = new Map<string, ReadonlySet<string>>();

export function readCounterState(
  conversationId: string,
  store: JotaiStore = getDefaultStore(),
): ConversationCounterState {
  return {
    lastCall: store.get(lastCallFamily(conversationId)),
    sessionUsage: store.get(sessionUsageFamily(conversationId)),
    estimate: store.get(nextEstimateFamily(conversationId)),
    appliedEvents: appliedEventsByConversation.get(conversationId) ?? new Set(),
  };
}

/**
 * Single write path into the conversation's stores: runs the pure §7 reducer
 * and writes only the slices whose reference changed, so a `draft_changed`
 * never re-renders a lastCall subscriber (§10.27).
 */
export function applyContextEvent(
  conversationId: string,
  event: ContextCounterEvent,
  store: JotaiStore = getDefaultStore(),
  now: number = Date.now(),
): ConversationCounterState {
  const previous = readCounterState(conversationId, store);
  const next = reduceContextCounter(previous, event, now);
  if (next === previous) {
    return previous;
  }
  if (next.lastCall !== previous.lastCall) {
    store.set(lastCallFamily(conversationId), next.lastCall);
  }
  if (next.sessionUsage !== previous.sessionUsage) {
    store.set(sessionUsageFamily(conversationId), next.sessionUsage);
  }
  if (next.estimate !== previous.estimate) {
    store.set(nextEstimateFamily(conversationId), next.estimate);
  }
  if (next.appliedEvents !== previous.appliedEvents) {
    appliedEventsByConversation.set(conversationId, next.appliedEvents);
  }
  return next;
}

/**
 * Explicit teardown for conversation deletion or tests. Deliberately NOT
 * called on indicator unmount or menu close — the data belongs to the
 * conversation, not the component (§7, §10.14).
 */
export function removeContextCounterAtoms(conversationId: string): void {
  lastCallFamily.remove(conversationId);
  sessionUsageFamily.remove(conversationId);
  nextEstimateFamily.remove(conversationId);
  contextViewModeFamily.remove(conversationId);
  appliedEventsByConversation.delete(conversationId);
}
