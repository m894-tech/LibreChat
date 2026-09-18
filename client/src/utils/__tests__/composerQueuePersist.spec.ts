import { Constants } from 'librechat-data-provider';
import type { QueuedComposerItem } from '~/common';
import { loadComposerQueue, moveQueuedItem, saveComposerQueue } from '../composerQueuePersist';

const item = (id: string, text: string): QueuedComposerItem => ({
  id,
  userMessageId: `user-${id}`,
  createdAt: 1,
  text,
  files: [],
  manualSkills: [],
  quotes: [],
  conversation: {
    conversationId: Constants.NEW_CONVO as string,
  } as QueuedComposerItem['conversation'],
  ephemeralAgent: null,
  nativeKnobs: null,
});

describe('composerQueuePersist', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips items', () => {
    saveComposerQueue(0, [item('a', 'one'), item('b', 'two')]);
    expect(loadComposerQueue(0).map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('reorders', () => {
    const next = moveQueuedItem([item('a', 'one'), item('b', 'two')], 'a', 'right');
    expect(next.map((row) => row.id)).toEqual(['b', 'a']);
  });
});
