import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import SessionProjectSection from '../SessionProjectSection';

const mockMutate = jest.fn();
const mockSetConversation = jest.fn();
const mockSetSearchParams = jest.fn();
const mockShowToast = jest.fn();
const mockFetchNextPage = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({
    setConversation: mockSetConversation,
  }),
}));

jest.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), mockSetSearchParams],
}));

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    Spinner: () => R.createElement('span', { 'data-testid': 'spinner' }),
    useToastContext: () => ({ showToast: mockShowToast }),
  };
});

jest.mock('~/data-provider', () => ({
  useAssignConversationToProjectMutation: () => ({
    mutate: mockMutate,
    isLoading: false,
  }),
  useProjectsInfiniteQuery: () => ({
    data: {
      pages: [
        {
          projects: [
            { _id: 'proj-a', name: 'Alpha' },
            { _id: 'proj-b', name: 'Beta' },
          ],
          nextCursor: null,
        },
      ],
    },
    fetchNextPage: mockFetchNextPage,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
  }),
}));

describe('SessionProjectSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists projects from the Projects API (not ContextSources)', () => {
    render(
      <SessionProjectSection
        conversation={{ conversationId: 'convo-1', chatProjectId: 'proj-a' } as never}
      />,
    );

    expect(screen.getByTestId('session-project-list')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'false');
  });

  it('assigns the conversation via useAssignConversationToProjectMutation', async () => {
    const user = userEvent.setup();
    render(
      <SessionProjectSection
        conversation={{ conversationId: 'convo-1', chatProjectId: null } as never}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Beta' }));
    expect(mockMutate).toHaveBeenCalledWith(
      { conversationId: 'convo-1', projectId: 'proj-b' },
      expect.any(Object),
    );
  });

  it('updates the draft for a new conversation without calling assign', async () => {
    const user = userEvent.setup();
    const conversation = { conversationId: 'new', chatProjectId: null };
    render(<SessionProjectSection conversation={conversation as never} />);

    await user.click(screen.getByRole('radio', { name: 'Alpha' }));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockSetConversation).toHaveBeenCalledWith({
      ...conversation,
      chatProjectId: 'proj-a',
    });
    expect(mockSetSearchParams).toHaveBeenCalled();
  });
});
