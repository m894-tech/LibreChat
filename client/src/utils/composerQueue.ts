import { Constants } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { QueuedComposerItem } from '~/common';

export type QueueEnterAction = 'none' | 'newline' | 'queue-back' | 'queue-front';

export function resolveQueueEnterAction({
  key,
  shiftKey,
  ctrlKey,
  metaKey,
  isComposing,
}: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}): QueueEnterAction {
  if (key !== 'Enter' || isComposing) {
    return 'none';
  }
  if (shiftKey) {
    return 'newline';
  }
  return ctrlKey || metaKey ? 'queue-front' : 'queue-back';
}

const normalizeConversationId = (id?: string | null) => id || Constants.NEW_CONVO;
const isNewConversationId = (id?: string | null) =>
  normalizeConversationId(id) === Constants.NEW_CONVO;

export type QueueDispatchResolution =
  | { action: 'dispatch'; item: QueuedComposerItem }
  | { action: 'wait' }
  | { action: 'drop' };

/**
 * Resolves whether a queued turn still belongs to the visible conversation.
 * NEW_CONVO → concrete id is accepted only when the active turn's anchor is
 * present in the visible message list. That prevents a queued turn from being
 * sent into an unrelated chat after manual navigation.
 */
export function resolveQueuedItemForConversation(
  item: QueuedComposerItem,
  currentConversationId?: string | null,
  currentMessages: TMessage[] = [],
): QueueDispatchResolution {
  const ownerId = normalizeConversationId(item.conversation.conversationId);
  const currentId = normalizeConversationId(currentConversationId);

  if (!isNewConversationId(ownerId)) {
    return ownerId === currentId ? { action: 'dispatch', item } : { action: 'drop' };
  }

  if (isNewConversationId(currentId)) {
    return { action: 'dispatch', item };
  }

  const belongsToCreatedConversation =
    item.anchorMessageId != null &&
    currentMessages.some((message) => message.messageId === item.anchorMessageId);
  if (!belongsToCreatedConversation) {
    return item.stopCurrent && currentMessages.length === 0
      ? { action: 'wait' }
      : { action: 'drop' };
  }

  return {
    action: 'dispatch',
    item: {
      ...item,
      conversation: { ...item.conversation, conversationId: currentId },
    },
  };
}

export function advanceQueueAfterDispatch(
  queue: QueuedComposerItem[],
  dispatched: QueuedComposerItem,
): QueuedComposerItem[] {
  if (!queue.some((item) => item.id === dispatched.id)) {
    return queue;
  }
  const conversationId = normalizeConversationId(dispatched.conversation.conversationId);
  return queue
    .filter((item) => item.id !== dispatched.id)
    .map((item) => ({
      ...item,
      anchorMessageId: dispatched.userMessageId,
      stopCurrent: false,
      conversation: {
        ...item.conversation,
        conversationId,
      },
    }));
}

export function queuedFilesToMessageFiles(item: QueuedComposerItem) {
  return item.files.map((file) => ({
    file_id: file.file_id,
    filepath: file.filepath,
    type: file.type ?? '',
    height: file.height,
    width: file.width,
  }));
}

export const shouldRestoreAbortedComposer = (queueLength: number) => queueLength === 0;
