import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { AnthropicEffort } from 'librechat-data-provider';

const mockSetConversation = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    useSetConversationAtom: () => ({ setConversation: mockSetConversation }),
  },
}));

import SessionEffortSection from '../SessionEffortSection';

describe('SessionEffortSection', () => {
  beforeEach(() => mockSetConversation.mockClear());

  it('renders Low/Mid/High in the sheet and updates conversation.effort', async () => {
    const user = userEvent.setup();
    const conversation = {
      conversationId: 'c1',
      effort: AnthropicEffort.medium,
    } as never;

    render(<SessionEffortSection conversation={conversation} index={0} />);

    expect(screen.getByTestId('session-effort')).toBeInTheDocument();
    expect(screen.getByTestId('session-effort-mid')).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByTestId('session-effort-high'));
    expect(mockSetConversation).toHaveBeenCalledWith(
      expect.objectContaining({ effort: AnthropicEffort.high }),
    );
  });
});
