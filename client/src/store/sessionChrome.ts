import { atomFamily } from 'recoil';
import type { NativeKnobsPayload } from '~/utils/nativeKnobs';
import type { ResponseFormat } from '~/utils/responseFormat';
import type { QueuedComposerItem } from '~/common';
import { loadComposerQueue, saveComposerQueue } from '~/utils/composerQueuePersist';

/** Stable key for per-conversation UI state that must survive index remounts. */
export function conversationUiStateKey(
  conversationId: string | null | undefined,
  index: number,
): string {
  return `${conversationId ?? 'new'}__${index}`;
}

const nativeKnobsByIndex = atomFamily<NativeKnobsPayload | null, string>({
  key: 'nativeKnobsByIndex',
  default: null,
});

const responseFormatByIndex = atomFamily<ResponseFormat, string>({
  key: 'responseFormatByIndex',
  default: 'default',
});

const composerQueueByIndex = atomFamily<QueuedComposerItem[], string | number>({
  key: 'composerQueueByIndex',
  default: (index) => loadComposerQueue(index),
  effects: (index) => [
    ({ onSet }) => {
      onSet((newValue) => {
        saveComposerQueue(index, Array.isArray(newValue) ? newValue : []);
      });
    },
  ],
});

export default {
  conversationUiStateKey,
  nativeKnobsByIndex,
  responseFormatByIndex,
  composerQueueByIndex,
};
