import { useMemo } from 'react';
import { Constants } from 'librechat-data-provider';
import type {
  TConversation,
  CodeEnvironmentMode,
  CodeWorkspaceSelection,
  TContextNextRequestEstimate,
} from 'librechat-data-provider';
import type { ContextCounterActions, ContextCounterMode, ContextCounterViewModel } from './types';
import type { ContextCounterView } from '~/hooks/Chat/contextCounter';
import useCompactConversation, { supportsCompaction } from '~/hooks/Chat/useCompactConversation';
import { useComposerDraft, useContextCounter, useContextCounterEnabled } from '~/hooks/Chat';

interface Params {
  index: number;
  conversation: TConversation | null;
  addedConvo: TConversation | null;
  codeEnvironmentMode?: CodeEnvironmentMode;
  codeWorkspaces?: CodeWorkspaceSelection[];
  isSubmitting: boolean;
  /** The dark menu is open — the only state in which estimates are requested (§6.3). */
  menuOpen: boolean;
  compactionEnabled: boolean;
}

interface Model {
  vm: ContextCounterViewModel;
  actions: ContextCounterActions;
  mode: ContextCounterMode;
  setMode: (mode: ContextCounterMode) => void;
}

/**
 * Stream D reports the lifecycle status beside the stored answer; the pure
 * components read one record, so the status travels on it. A status without
 * an answer («считаем» / ошибка до первого ответа) becomes an empty record
 * with that status — `deriveNextPanel` shows it as «нет данных».
 */
function estimateRecord(view: ContextCounterView): TContextNextRequestEstimate | null {
  const { estimate } = view;
  if (estimate.estimate != null) {
    return {
      ...estimate.estimate,
      status: estimate.status,
      staleReason: estimate.staleReason,
      errorCode: estimate.errorCode,
    };
  }
  if (estimate.status === 'unavailable') {
    return null;
  }
  return {
    version: 1,
    conversationId: view.conversationId,
    branchLeafId: view.leafId,
    revision: 0,
    fingerprint: view.inputs.fingerprint,
    status: estimate.status,
    staleReason: estimate.staleReason,
    errorCode: estimate.errorCode,
    source: 'unavailable',
    computedAt: 0,
    configuration: view.inputs.current.configuration,
    budget: { window: null, reserve: 0, inputLimit: null, budget: null },
    occupied: { messages: 0, toolCalls: 0, systemPrompt: 0, mcpTools: 0, attachments: 0, other: 0 },
    cache: { read: null, write: null },
    excluded: null,
  };
}

/**
 * The one adapter between stream D's `useContextCounter` view-model and the
 * pure menu/indicator components. Everything the components need is mapped
 * here; nothing below this hook reaches into stores.
 */
export function useContextCounterModel({
  index,
  conversation,
  addedConvo,
  codeEnvironmentMode,
  codeWorkspaces,
  isSubmitting,
  menuOpen,
  compactionEnabled,
}: Params): Model {
  const enabled = useContextCounterEnabled();
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const draft = useComposerDraft(index, conversationId);
  const compaction = useCompactConversation();
  const compressSupported =
    compactionEnabled && supportsCompaction(conversation?.endpoint) && compaction.canCompact;
  const view = useContextCounter({
    index,
    conversation,
    addedConvo,
    codeEnvironmentMode,
    codeWorkspaces,
    draft,
    menuOpen,
    isSubmitting,
    enabled,
    compressSupported,
  });

  const vm = useMemo<ContextCounterViewModel>(
    () => ({
      conversationId: view.conversationId,
      configuration: view.inputs.current.configuration,
      nextRequestEstimate: estimateRecord(view),
      lastCallMeasurement: view.lastCall.measurement,
      lastCallMismatch: view.lastCall.configMismatch,
      sessionUsage: view.sessionUsage,
      activity: {
        streaming: isSubmitting && !compaction.isCompacting,
        sending: false,
        compressing: compaction.isCompacting,
        modelSwitching: false,
      },
      capabilities: {
        compressionSupported: compressSupported,
        estimateSupported: true,
        compressThresholdPercent: 80,
      },
      isEmptyChat: view.leafId === Constants.NO_PARENT,
    }),
    [view, isSubmitting, compaction.isCompacting, compressSupported],
  );

  const actions = useMemo<ContextCounterActions>(
    () => ({ recalculate: view.recalculate, compress: compaction.compact }),
    [view.recalculate, compaction.compact],
  );

  return { vm, actions, mode: view.mode, setMode: view.setMode };
}
