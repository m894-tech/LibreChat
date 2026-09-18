import { act, renderHook } from '@testing-library/react';
import type { TConversation, TMessage } from 'librechat-data-provider';
import type { QueuedComposerItem } from '~/common';
import useComposerQueue from '../useComposerQueue';

let mockQueue: QueuedComposerItem[] = [];
let mockLatestMessage: TMessage | null = null;
let mockChatContext: Record<string, unknown>;
let mockFormText = '';
let mockManualSkills: string[] = [];
let mockQuotes: string[] = [];
let mockNativeKnobs: Record<string, unknown> | null = null;

const mockResetAtom = jest.fn();
const mockResetForm = jest.fn(() => {
  mockFormText = '';
});
const mockStopGenerating = jest.fn();
const mockSetFiles = jest.fn();
const mockSetQueue = jest.fn(
  (update: QueuedComposerItem[] | ((items: QueuedComposerItem[]) => QueuedComposerItem[])) => {
    mockQueue = typeof update === 'function' ? update(mockQueue) : update;
  },
);
const mockGetEphemeralAgent = jest.fn(() => ({ mcp: ['filesystem'] }));

jest.mock('uuid', () => ({
  v4: jest
    .fn()
    .mockReturnValueOnce('queue-id')
    .mockReturnValueOnce('queued-user-id')
    .mockReturnValue('later-id'),
}));

jest.mock('recoil', () => ({
  useRecoilValue: jest.fn(() => mockQueue),
  useSetRecoilState: jest.fn(() => mockSetQueue),
  useRecoilCallback: jest.fn((factory) =>
    factory({
      snapshot: {
        getLoadable: (atom: string) => {
          if (atom.startsWith('skills:')) {
            return { state: 'hasValue', contents: mockManualSkills };
          }
          if (atom.startsWith('quotes:')) {
            return { state: 'hasValue', contents: mockQuotes };
          }
          if (atom.startsWith('format:')) {
            return { state: 'hasValue', contents: 'concise' };
          }
          return { state: 'hasValue', contents: mockNativeKnobs };
        },
      },
      reset: mockResetAtom,
    }),
  ),
}));

jest.mock('~/Providers', () => ({
  useAddedChatContext: () => ({ conversation: null }),
  useChatContext: () => mockChatContext,
  useChatFormContext: () => ({
    getValues: () => mockFormText,
    reset: mockResetForm,
  }),
}));

jest.mock('~/hooks/Messages/useLatestMessage', () => ({
  useLatestMessage: () => mockLatestMessage,
}));

jest.mock('~/store', () => ({
  __esModule: true,
  useGetEphemeralAgent: () => mockGetEphemeralAgent,
  default: {
    composerQueueByIndex: (index: number) => `queue:${index}`,
    pendingManualSkillsByConvoId: (id: string) => `skills:${id}`,
    pendingQuotesByConvoId: (id: string) => `quotes:${id}`,
    nativeKnobsByIndex: (key: string) => `knobs:${key}`,
    responseFormatByIndex: (key: string) => `format:${key}`,
    conversationUiStateKey: (conversationId: string, index: number) =>
      `${conversationId ?? 'new'}__${index}`,
  },
}));

const conversation = {
  conversationId: 'conversation-1',
  endpoint: 'agents',
  agent_id: 'agent-1',
} as TConversation;

const userMessage = (messageId: string): TMessage =>
  ({
    messageId,
    parentMessageId: 'parent-1',
    conversationId: conversation.conversationId,
    isCreatedByUser: true,
    sender: 'User',
    text: messageId,
  }) as TMessage;

const assistantMessage = (
  messageId: string,
  parentMessageId: string,
  updatedAt?: string,
): TMessage =>
  ({
    messageId,
    parentMessageId,
    conversationId: conversation.conversationId,
    isCreatedByUser: false,
    sender: 'Assistant',
    text: messageId,
    updatedAt,
  }) as TMessage;

const queuedItem = (): QueuedComposerItem => ({
  id: 'queued-1',
  userMessageId: 'queued-user-1',
  createdAt: 1,
  text: 'queued text',
  files: [],
  manualSkills: [],
  quotes: [],
  conversation,
  anchorMessageId: 'active-user',
  ephemeralAgent: null,
  nativeKnobs: null,
});

describe('useComposerQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueue = [];
    mockLatestMessage = assistantMessage('assistant-1', 'active-user', '2026-01-01');
    mockFormText = '';
    mockChatContext = {
      conversation,
      files: new Map(),
      setFiles: mockSetFiles,
      filesLoading: false,
      isSubmitting: false,
      stopGenerating: mockStopGenerating,
      getMessages: () => [userMessage('active-user'), mockLatestMessage].filter(Boolean),
    };
    mockManualSkills = [];
    mockQuotes = [];
    mockNativeKnobs = null;
  });

  it('dispatches one item and removes it only after explicit success', () => {
    mockQueue = [queuedItem()];
    const submitQueuedItem = jest.fn(() => true);

    renderHook(() => useComposerQueue(0, submitQueuedItem));

    expect(submitQueuedItem).toHaveBeenCalledTimes(1);
    expect(mockQueue).toEqual([]);
  });

  it('keeps a blocked item and retries only after the active tail changes', () => {
    mockQueue = [queuedItem()];
    const submitQueuedItem = jest.fn(() => false);
    const { rerender } = renderHook(() => useComposerQueue(0, submitQueuedItem));

    expect(submitQueuedItem).toHaveBeenCalledTimes(1);
    expect(mockQueue).toHaveLength(1);

    rerender();
    expect(submitQueuedItem).toHaveBeenCalledTimes(1);

    mockLatestMessage = assistantMessage('assistant-1', 'active-user', '2026-01-02');
    rerender();
    expect(submitQueuedItem).toHaveBeenCalledTimes(2);
    expect(mockQueue).toHaveLength(1);
  });

  it('snapshots the composer, drains one-shot state, and stops for a front enqueue', () => {
    mockFormText = '  send next  ';
    mockManualSkills = ['skill-a'];
    mockQuotes = ['quote-a'];
    mockNativeKnobs = { family: 'gpt-image', quality: 'high' };
    mockChatContext = {
      ...mockChatContext,
      isSubmitting: true,
      files: new Map([
        [
          'file-1',
          {
            file_id: 'file-1',
            filepath: '/uploads/file.png',
            type: 'image/png',
            size: 10,
            progress: 1,
          },
        ],
      ]),
    };
    const submitQueuedItem = jest.fn(() => true);
    const { result } = renderHook(() => useComposerQueue(0, submitQueuedItem));

    act(() => {
      expect(result.current.enqueue('front')).toBe(true);
    });

    expect(mockQueue).toHaveLength(1);
    expect(mockQueue[0]).toEqual(
      expect.objectContaining({
        id: 'queue-id',
        userMessageId: 'queued-user-id',
        text: 'send next',
        manualSkills: ['skill-a'],
        quotes: ['quote-a'],
        stopCurrent: true,
        ephemeralAgent: { mcp: ['filesystem'] },
        nativeKnobs: { family: 'gpt-image', quality: 'high' },
      }),
    );
    expect(mockQueue[0].files).toEqual([
      expect.objectContaining({ file_id: 'file-1', filepath: '/uploads/file.png' }),
    ]);
    expect(mockResetAtom).toHaveBeenCalledWith('skills:conversation-1');
    expect(mockResetAtom).toHaveBeenCalledWith('quotes:conversation-1');
    expect(mockSetFiles).toHaveBeenCalledWith(new Map());
    expect(mockResetForm).toHaveBeenCalled();
    expect(mockStopGenerating).toHaveBeenCalledTimes(1);
    expect(submitQueuedItem).not.toHaveBeenCalled();
  });
});
