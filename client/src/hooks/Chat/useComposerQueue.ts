import { useCallback, useEffect, useRef } from 'react';
import { v4 } from 'uuid';
import cloneDeep from 'lodash/cloneDeep';
import { Constants } from 'librechat-data-provider';
import { useRecoilCallback, useRecoilValue, useSetRecoilState } from 'recoil';
import type { QueuedComposerItem } from '~/common';
import {
  clampEphemeralAgentForSessionProfile,
  isMediaStudioConversation,
  loadSessionProfile,
} from '~/utils/sessionProfiles';
import { advanceQueueAfterDispatch, resolveQueuedItemForConversation } from '~/utils/composerQueue';
import { useAddedChatContext, useChatContext, useChatFormContext } from '~/Providers';
import { useLatestMessage } from '~/hooks/Messages/useLatestMessage';
import { useGetEphemeralAgent } from '~/store';
import store from '~/store';

type QueuePosition = 'back' | 'front';
type SubmitQueuedItem = (item: QueuedComposerItem) => boolean;

export default function useComposerQueue(index: number, submitQueuedItem: SubmitQueuedItem) {
  const methods = useChatFormContext();
  const { conversation: addedConvo } = useAddedChatContext();
  const { conversation, files, setFiles, filesLoading, isSubmitting, stopGenerating, getMessages } =
    useChatContext();
  const latestMessage = useLatestMessage(index);
  const queue = useRecoilValue(store.composerQueueByIndex(index));
  const setQueue = useSetRecoilState(store.composerQueueByIndex(index));
  const getEphemeralAgent = useGetEphemeralAgent();
  const dispatchingRef = useRef(false);
  const lastAttemptKeyRef = useRef<string | null>(null);

  const snapshotComposer = useRecoilCallback(
    ({ snapshot, reset }) =>
      (position: QueuePosition): boolean => {
        if (!isSubmitting || filesLoading || !conversation) {
          return false;
        }
        const text = methods.getValues('text')?.trim() ?? '';
        if (!text) {
          return false;
        }

        const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
        const manualSkillsLoadable = snapshot.getLoadable(
          store.pendingManualSkillsByConvoId(conversationId),
        );
        const quotesLoadable = snapshot.getLoadable(store.pendingQuotesByConvoId(conversationId));
        const uiKey = store.conversationUiStateKey(conversationId, index);
        const nativeKnobsLoadable = snapshot.getLoadable(store.nativeKnobsByIndex(uiKey));
        const responseFormatLoadable = snapshot.getLoadable(store.responseFormatByIndex(uiKey));
        const manualSkills =
          manualSkillsLoadable.state === 'hasValue' ? [...manualSkillsLoadable.contents] : [];
        const quotes = quotesLoadable.state === 'hasValue' ? [...quotesLoadable.contents] : [];
        const nativeKnobs =
          nativeKnobsLoadable.state === 'hasValue' ? cloneDeep(nativeKnobsLoadable.contents) : null;
        const responseFormat =
          responseFormatLoadable.state === 'hasValue' ? responseFormatLoadable.contents : 'default';
        const sessionProfile = loadSessionProfile(conversationId);
        const ephemeralAgent = clampEphemeralAgentForSessionProfile(
          getEphemeralAgent(conversationId) ??
            (conversationId !== Constants.NEW_CONVO
              ? getEphemeralAgent(Constants.NEW_CONVO)
              : null),
          sessionProfile,
          { mediaStudio: isMediaStudioConversation(conversation) },
        );
        const item: QueuedComposerItem = {
          id: v4(),
          userMessageId: v4(),
          createdAt: Date.now(),
          text,
          files: Array.from(files.values()).map((file) => ({ ...file })),
          manualSkills,
          quotes,
          conversation: cloneDeep(conversation),
          anchorMessageId:
            latestMessage?.isCreatedByUser === false
              ? latestMessage.parentMessageId
              : (latestMessage?.messageId ?? Constants.NO_PARENT),
          stopCurrent: position === 'front',
          ephemeralAgent: cloneDeep(ephemeralAgent),
          nativeKnobs,
          addedConvo: addedConvo ? cloneDeep(addedConvo) : undefined,
          responseFormat,
          sessionProfile,
        };

        setQueue((items) => (position === 'front' ? [item, ...items] : [...items, item]));
        reset(store.pendingManualSkillsByConvoId(conversationId));
        reset(store.pendingQuotesByConvoId(conversationId));
        setFiles(new Map());
        methods.reset();
        return true;
      },
    [
      addedConvo,
      conversation,
      files,
      filesLoading,
      getEphemeralAgent,
      index,
      isSubmitting,
      latestMessage?.messageId,
      methods,
      setFiles,
      setQueue,
    ],
  );

  const enqueue = useCallback(
    (position: QueuePosition) => {
      const queued = snapshotComposer(position);
      if (queued && position === 'front') {
        void stopGenerating();
      }
      return queued;
    },
    [snapshotComposer, stopGenerating],
  );

  useEffect(() => {
    if (isSubmitting || dispatchingRef.current || queue.length === 0) {
      return;
    }

    const first = queue[0];
    const resolution = resolveQueuedItemForConversation(
      first,
      conversation?.conversationId,
      getMessages() ?? [],
    );

    if (resolution.action === 'wait') {
      return;
    }
    if (resolution.action === 'drop') {
      setQueue((items) => items.filter((item) => item.id !== first.id));
      return;
    }

    const attemptKey = [
      first.id,
      conversation?.conversationId ?? '',
      latestMessage?.messageId ?? '',
      latestMessage?.createdAt ?? '',
      latestMessage?.updatedAt ?? '',
    ].join(':');
    if (lastAttemptKeyRef.current === attemptKey) {
      return;
    }
    lastAttemptKeyRef.current = attemptKey;
    dispatchingRef.current = true;
    try {
      const submitted = submitQueuedItem(resolution.item);
      if (submitted) {
        setQueue((items) => advanceQueueAfterDispatch(items, resolution.item));
      }
    } finally {
      dispatchingRef.current = false;
    }
  }, [
    conversation?.conversationId,
    getMessages,
    isSubmitting,
    latestMessage?.messageId,
    latestMessage?.createdAt,
    latestMessage?.updatedAt,
    queue,
    setQueue,
    submitQueuedItem,
  ]);

  return { queue, enqueue };
}
