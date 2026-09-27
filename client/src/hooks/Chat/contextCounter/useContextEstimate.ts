import { useCallback, useEffect, useRef } from 'react';
import { getDefaultStore } from 'jotai';
import type {
  TContextStaleReason,
  TContextEstimateRequest,
  TContextNextRequestEstimate,
} from 'librechat-data-provider';
import type { JotaiStore } from '~/store/contextCounter';
import type { TokenBucket } from './limiter';
import { applyContextEvent, readCounterState } from '~/store/contextCounter';
import { estimateContext } from '~/data-provider/ContextCounter';
import { createBucket, takeToken } from './limiter';

/** §6.3 debounce while the menu is open. */
export const ESTIMATE_DEBOUNCE_MS = 700;

export type EstimateRequester = (
  body: TContextEstimateRequest,
) => Promise<TContextNextRequestEstimate>;

/**
 * Monotonic request revision per conversation. Lives outside React so an
 * answer that arrives after the indicator unmounted (menu closed, §10.14) is
 * still judged against the latest revision, and a Send can retire an
 * in-flight request even when no component is mounted to observe it.
 */
const revisionByConversation = new Map<string, number>();
const bucketByConversation = new Map<string, TokenBucket>();

export function currentRevision(conversationId: string): number {
  return revisionByConversation.get(conversationId) ?? 0;
}

export function bumpRevision(conversationId: string): number {
  const next = currentRevision(conversationId) + 1;
  revisionByConversation.set(conversationId, next);
  return next;
}

function bucketFor(conversationId: string, now: number): TokenBucket {
  let bucket = bucketByConversation.get(conversationId);
  if (bucket == null) {
    bucket = createBucket(now);
    bucketByConversation.set(conversationId, bucket);
  }
  return bucket;
}

/** Tests only: forgets revisions and rate-limit state. */
export function resetEstimateController(conversationId?: string): void {
  if (conversationId == null) {
    revisionByConversation.clear();
    bucketByConversation.clear();
    return;
  }
  revisionByConversation.delete(conversationId);
  bucketByConversation.delete(conversationId);
}

function errorCodeOf(error: unknown): string {
  if (error != null && typeof error === 'object') {
    const status = (error as { response?: { status?: number } }).response?.status;
    if (typeof status === 'number') {
      return `http_${status}`;
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') {
      return code;
    }
  }
  return 'estimate_failed';
}

export type UseContextEstimateParams = {
  conversationId: string;
  /** Leaf of the viewed branch; the request and its answer are scoped to it (§10.11). */
  leafId: string;
  /** Client fingerprint hash of every §7 term for the current state. */
  fingerprint: string;
  /** Why the fingerprint moved since the previous render; labels the stale entry. */
  changeReason: TContextStaleReason | null;
  /** Builds the §6 body at fire time from the current inputs. */
  buildRequest: (revision: number, fingerprint: string) => TContextEstimateRequest;
  menuOpen: boolean;
  isSubmitting: boolean;
  enabled: boolean;
  requester?: EstimateRequester;
  store?: JotaiStore;
  debounceMs?: number;
  now?: () => number;
};

export type ContextEstimateController = {
  /** «Пересчитать»: immediate request, bypassing the debounce (§6). */
  recalculate: () => void;
};

/**
 * Fetches the next-request estimate per §6: on menu open when no fresh cached
 * answer exists for the fingerprint, on «Пересчитать», and debounced while
 * the menu stays open. Never per keystroke with the menu closed. Late answers
 * of an older revision are dropped; a Send retires the in-flight revision so
 * its answer can never land on the post-Send state (§10.15, §10.26).
 */
export default function useContextEstimate(
  params: UseContextEstimateParams,
): ContextEstimateController {
  const {
    conversationId,
    leafId,
    fingerprint,
    changeReason,
    buildRequest,
    menuOpen,
    isSubmitting,
    enabled,
    requester = estimateContext,
    store = getDefaultStore(),
    debounceMs = ESTIMATE_DEBOUNCE_MS,
    now = Date.now,
  } = params;

  const buildRef = useRef(buildRequest);
  buildRef.current = buildRequest;
  const fingerprintRef = useRef(fingerprint);
  fingerprintRef.current = fingerprint;
  const leafRef = useRef(leafId);
  leafRef.current = leafId;
  const requesterRef = useRef(requester);
  requesterRef.current = requester;
  const nowRef = useRef(now);
  nowRef.current = now;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevFingerprintRef = useRef<string | null>(null);
  const prevMenuOpenRef = useRef(false);
  const prevSubmittingRef = useRef(isSubmitting);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const fire = useCallback(() => {
    clearTimer();
    const wait = takeToken(bucketFor(conversationId, nowRef.current()), nowRef.current());
    if (wait > 0) {
      timerRef.current = setTimeout(fire, wait);
      return;
    }
    const revision = bumpRevision(conversationId);
    const requestFingerprint = fingerprintRef.current;
    const requestLeaf = leafRef.current;
    applyContextEvent(
      conversationId,
      {
        type: 'estimate_requested',
        leafId: requestLeaf,
        revision,
        fingerprint: requestFingerprint,
      },
      store,
    );
    const isCurrent = () => currentRevision(conversationId) === revision;
    requesterRef
      .current(buildRef.current(revision, requestFingerprint))
      .then((estimate) => {
        if (!isCurrent()) {
          return;
        }
        applyContextEvent(
          conversationId,
          {
            type: 'estimate_resolved',
            leafId: requestLeaf,
            revision,
            fingerprint: requestFingerprint,
            estimate,
          },
          store,
        );
      })
      .catch((error: unknown) => {
        if (!isCurrent()) {
          return;
        }
        applyContextEvent(
          conversationId,
          {
            type: 'estimate_failed',
            leafId: requestLeaf,
            revision,
            errorCode: errorCodeOf(error),
          },
          store,
        );
      });
  }, [clearTimer, conversationId, store]);

  const schedule = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(fire, debounceMs);
  }, [clearTimer, fire, debounceMs]);

  /** Send retires the pending forecast: cancel the debounce, bump the revision
   *  so the in-flight answer is dropped, and mark the entry `sent` (§6.2). */
  useEffect(() => {
    const wasSubmitting = prevSubmittingRef.current;
    prevSubmittingRef.current = isSubmitting;
    if (!isSubmitting || wasSubmitting) {
      return;
    }
    clearTimer();
    bumpRevision(conversationId);
    applyContextEvent(conversationId, { type: 'invalidate', leafId, reason: 'sent' }, store);
  }, [isSubmitting, conversationId, leafId, clearTimer, store]);

  useEffect(() => {
    const previousFingerprint = prevFingerprintRef.current;
    prevFingerprintRef.current = fingerprint;
    const wasOpen = prevMenuOpenRef.current;
    prevMenuOpenRef.current = menuOpen;

    /** While a turn streams the Send effect already marked the entry `sent`;
     *  nothing is requested and no other reason overrides that mark. */
    if (!enabled || isSubmitting) {
      clearTimer();
      return;
    }

    const entry = readCounterState(conversationId, store).estimate.get(leafId);
    const cached =
      entry?.estimate != null &&
      entry.fingerprint === fingerprint &&
      (entry.status === 'fresh' || entry.status === 'partial');

    if (previousFingerprint != null && previousFingerprint !== fingerprint && !cached) {
      applyContextEvent(
        conversationId,
        { type: 'invalidate', leafId, reason: changeReason ?? 'unknown' },
        store,
      );
    }

    if (!menuOpen || cached) {
      clearTimer();
      return;
    }
    if (entry?.pendingRevision != null && entry.pendingFingerprint === fingerprint) {
      return;
    }
    if (menuOpen && !wasOpen) {
      fire();
      return;
    }
    schedule();
  }, [
    fingerprint,
    leafId,
    menuOpen,
    isSubmitting,
    enabled,
    conversationId,
    changeReason,
    store,
    clearTimer,
    fire,
    schedule,
  ]);

  /** Only the pending debounce dies with the component; an in-flight request
   *  still resolves into the conversation's store (§10.14). */
  useEffect(() => clearTimer, [clearTimer]);

  const recalculate = useCallback(() => {
    if (!enabled || isSubmitting) {
      return;
    }
    fire();
  }, [enabled, isSubmitting, fire]);

  return { recalculate };
}
