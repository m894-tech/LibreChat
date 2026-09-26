import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useQueryClient } from '@tanstack/react-query';
import { Constants, QueryKeys } from 'librechat-data-provider';
import type {
  TMessage,
  TConversation,
  TContextSessionUsage,
  TContextExclusionPlan,
} from 'librechat-data-provider';
import type {
  BottomButton,
  PrimaryView,
  EstimateView,
  LastCallView,
  MiniIndicator,
  ContextViewMode,
} from '~/store/contextCounter';
import type { ContextCounterInputs, ComposerDraft } from './useContextInputs';
import type { ContextEstimateController } from './useContextEstimate';
import {
  lastCallFamily,
  applyContextEvent,
  sessionUsageFamily,
  nextEstimateFamily,
  selectPrimaryView,
  selectBottomButton,
  selectEstimateView,
  selectLastCallView,
  contextViewModeFamily,
  selectMiniIndicator,
  deriveBranchSnapshot,
} from '~/store/contextCounter';
import { contextUsageQueryKey, useContextUsageQuery } from '~/data-provider/ContextCounter';
import useContextEstimate from './useContextEstimate';
import useContextInputs from './useContextInputs';

/** Fill ratio at which «Сжать» replaces «Пересчитать» (§3); exclusion of history always counts. */
export const DEFAULT_COMPRESS_THRESHOLD = 0.8;

export type UseContextCounterParams = {
  index: number;
  conversation: TConversation | null;
  addedConvo: TConversation | null;
  draft: ComposerDraft;
  /** The dark menu is open — the only state in which estimates are requested (§6.3). */
  menuOpen: boolean;
  isSubmitting: boolean;
  /** Endpoint supports compaction and the server advertises it. */
  compressSupported: boolean;
  compressThreshold?: number;
  /** `interface.contextCounterV2`; when false nothing is fetched or hydrated. */
  enabled: boolean;
};

export type ContextCounterView = {
  conversationId: string;
  /** Leaf of the viewed branch every store lookup is scoped to (§10.11). */
  leafId: string;
  mode: ContextViewMode;
  setMode: (mode: ContextViewMode) => void;
  toggleMode: () => void;
  /** Header / bar / breakdown for the selected mode. */
  primary: PrimaryView;
  estimate: EstimateView;
  lastCall: LastCallView;
  /** «Расход за сессию · эта ветка»; `null` → no calls on this branch yet. */
  sessionUsage: TContextSessionUsage | null;
  excluded: TContextExclusionPlan | null;
  bottomButton: BottomButton;
  mini: MiniIndicator;
  inputs: ContextCounterInputs;
  recalculate: ContextEstimateController['recalculate'];
};

/**
 * View-model for the context counter v2 menu (spec §3–§4, §7, §9). Owns no
 * state itself: it reads the conversation's three stores, drives the estimate
 * controller and hydrates `lastCall` / `sessionUsage` from the branch's
 * persisted message metadata and the stream C snapshot. Mount inside the
 * indicator; unmounting clears nothing (§10.14).
 */
export default function useContextCounter(params: UseContextCounterParams): ContextCounterView {
  const {
    index,
    conversation,
    addedConvo,
    draft,
    menuOpen,
    isSubmitting,
    compressSupported,
    compressThreshold = DEFAULT_COMPRESS_THRESHOLD,
    enabled,
  } = params;
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const queryClient = useQueryClient();
  const inputs = useContextInputs({ index, conversation, addedConvo, draft });
  const { leafId, fingerprint, changeReason, current, request } = inputs;

  const buildRequest = useCallback(
    (revision: number, requestFingerprint: string) => ({
      ...request,
      revision,
      fingerprint: requestFingerprint,
    }),
    [request],
  );

  const { recalculate } = useContextEstimate({
    conversationId,
    leafId,
    fingerprint,
    changeReason,
    buildRequest,
    menuOpen,
    isSubmitting,
    enabled,
  });

  /** Local hydration (§7 «перезагрузка»): the branch's persisted snapshots and
   *  usage rollups, re-derived when the messages cache settles and on branch
   *  switch. Skipped while streaming — the tail is not final yet. */
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;
  const leafRef = useRef(leafId);
  leafRef.current = leafId;
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const hydrate = (messages: TMessage[] | undefined) => {
      const leaf = leafRef.current;
      if (leaf === Constants.NO_PARENT) {
        return;
      }
      const snapshot = deriveBranchSnapshot(conversationId, messages, leaf);
      applyContextEvent(conversationId, {
        type: 'hydrate',
        leafId: leaf,
        lastCall: snapshot.lastCall,
        sessionUsage: snapshot.sessionUsage,
      });
    };
    hydrate(queryClient.getQueryData<TMessage[]>([QueryKeys.messages, conversationId]));
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (isSubmittingRef.current || event.type !== 'updated') {
        return;
      }
      const queryKey = event.query.queryKey;
      if (
        !Array.isArray(queryKey) ||
        queryKey[0] !== QueryKeys.messages ||
        queryKey[1] !== conversationId
      ) {
        return;
      }
      hydrate(event.query.state.data as TMessage[] | undefined);
    });
    return unsubscribe;
  }, [enabled, conversationId, leafId, queryClient]);

  /** Stream C read model; refetched once a turn settles so the server-side
   *  measurement (idempotent, «неполно» aware) replaces the local derivation. */
  useContextUsageQuery(conversationId, leafId, enabled && leafId !== Constants.NO_PARENT);
  const prevSubmittingRef = useRef(isSubmitting);
  useEffect(() => {
    const wasSubmitting = prevSubmittingRef.current;
    prevSubmittingRef.current = isSubmitting;
    if (!enabled || isSubmitting || !wasSubmitting) {
      return;
    }
    void queryClient.invalidateQueries(contextUsageQueryKey(conversationId, leafId));
  }, [enabled, isSubmitting, conversationId, leafId, queryClient]);

  const lastCallMap = useAtomValue(lastCallFamily(conversationId));
  const sessionUsageMap = useAtomValue(sessionUsageFamily(conversationId));
  const estimateMap = useAtomValue(nextEstimateFamily(conversationId));
  const [mode, setMode] = useAtom(contextViewModeFamily(conversationId));
  const toggleMode = useCallback(() => setMode(mode === 'next' ? 'last' : 'next'), [mode, setMode]);

  return useMemo<ContextCounterView>(() => {
    const estimate = selectEstimateView(estimateMap.get(leafId), fingerprint);
    const lastCall = selectLastCallView(lastCallMap.get(leafId), current);
    return {
      conversationId,
      leafId,
      mode,
      setMode,
      toggleMode,
      primary: selectPrimaryView(mode, estimate, lastCall),
      estimate,
      lastCall,
      sessionUsage: sessionUsageMap.get(leafId) ?? null,
      excluded: estimate.excluded,
      bottomButton: selectBottomButton({
        isSubmitting,
        estimate,
        compressSupported,
        compressThreshold,
      }),
      mini: selectMiniIndicator(estimate),
      inputs,
      recalculate,
    };
  }, [
    estimateMap,
    lastCallMap,
    sessionUsageMap,
    leafId,
    fingerprint,
    current,
    conversationId,
    mode,
    setMode,
    toggleMode,
    isSubmitting,
    compressSupported,
    compressThreshold,
    inputs,
    recalculate,
  ]);
}
