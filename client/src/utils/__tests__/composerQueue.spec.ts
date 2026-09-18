import { Constants } from 'librechat-data-provider';
import type { TConversation, TMessage } from 'librechat-data-provider';
import type { QueuedComposerItem } from '~/common';
import {
  advanceQueueAfterDispatch,
  resolveQueueEnterAction,
  resolveQueuedItemForConversation,
  shouldRestoreAbortedComposer,
} from '../composerQueue';

const item = (overrides: Partial<QueuedComposerItem> = {}): QueuedComposerItem => ({
  id: 'queue-1',
  userMessageId: 'queued-user-1',
  createdAt: 1,
  text: 'next',
  files: [],
  manualSkills: [],
  quotes: [],
  conversation: { conversationId: Constants.NEW_CONVO as string } as TConversation,
  anchorMessageId: 'active-user',
  ephemeralAgent: null,
  nativeKnobs: null,
  ...overrides,
});

describe('composer queue', () => {
  it('maps Enter shortcuts while generation is active', () => {
    expect(
      resolveQueueEnterAction({
        key: 'Enter',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
      }),
    ).toBe('queue-back');
    expect(
      resolveQueueEnterAction({
        key: 'Enter',
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
        isComposing: false,
      }),
    ).toBe('queue-front');
    expect(
      resolveQueueEnterAction({
        key: 'Enter',
        shiftKey: true,
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
      }),
    ).toBe('newline');
  });

  it('migrates NEW_CONVO only when the active turn belongs to the current messages', () => {
    const resolution = resolveQueuedItemForConversation(item(), 'real-convo', [
      { messageId: 'active-user' } as TMessage,
    ]);
    expect(resolution.action).toBe('dispatch');
    expect(resolution.action === 'dispatch' && resolution.item.conversation.conversationId).toBe(
      'real-convo',
    );
  });

  it('drops a NEW_CONVO queue after navigation to an unrelated conversation', () => {
    expect(resolveQueuedItemForConversation(item(), 'other-convo', [])).toEqual({ action: 'drop' });
  });

  it('migrates stop-and-send after abort when its active anchor is still visible', () => {
    const resolution = resolveQueuedItemForConversation(item({ stopCurrent: true }), 'real-convo', [
      { messageId: 'active-user' } as TMessage,
    ]);
    expect(resolution.action).toBe('dispatch');
    expect(resolution.action === 'dispatch' && resolution.item.conversation.conversationId).toBe(
      'real-convo',
    );
  });

  it('waits for an initial stop-and-send turn to return to NEW_CONVO while cleanup is empty', () => {
    expect(
      resolveQueuedItemForConversation(item({ stopCurrent: true }), 'temporary-real-convo', []),
    ).toEqual({ action: 'wait' });
  });

  it('drops an initial stop-and-send turn after navigation to an unrelated populated chat', () => {
    expect(
      resolveQueuedItemForConversation(item({ stopCurrent: true }), 'other-convo', [
        { messageId: 'other-user' } as TMessage,
      ]),
    ).toEqual({ action: 'drop' });
  });

  it('advances by dispatched id when the head was removed during dispatch', () => {
    const removedHead = item({ id: 'removed-head' });
    const dispatched = item({
      id: 'queue-2',
      userMessageId: 'queued-user-2',
      conversation: { conversationId: 'real-convo' } as TConversation,
    });
    const next = item({ id: 'queue-3', userMessageId: 'queued-user-3' });
    expect(advanceQueueAfterDispatch([dispatched, next], dispatched)).toEqual([
      expect.objectContaining({ id: 'queue-3', anchorMessageId: 'queued-user-2' }),
    ]);
    expect(advanceQueueAfterDispatch([removedHead, next], dispatched)).toEqual([removedHead, next]);
  });

  it('advances remaining snapshots to the dispatched turn', () => {
    const dispatched = item({
      conversation: { conversationId: 'real-convo' } as TConversation,
    });
    const next = item({ id: 'queue-2', userMessageId: 'queued-user-2', stopCurrent: true });
    expect(advanceQueueAfterDispatch([dispatched, next], dispatched)).toEqual([
      expect.objectContaining({
        id: 'queue-2',
        anchorMessageId: 'queued-user-1',
        stopCurrent: false,
        conversation: expect.objectContaining({ conversationId: 'real-convo' }),
      }),
    ]);
  });
  it('restores an aborted draft only when no queued successor exists', () => {
    expect(shouldRestoreAbortedComposer(0)).toBe(true);
    expect(shouldRestoreAbortedComposer(1)).toBe(false);
  });
});
