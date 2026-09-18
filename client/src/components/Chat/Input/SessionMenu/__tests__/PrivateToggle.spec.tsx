import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';

const mockSetIsTemporary = jest.fn();
let mockIsTemporary = false;
let mockConversation: { messages?: unknown[] } | null = { messages: [] };
let mockIsSubmitting = false;
let mockHasAccess = true;

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => mockHasAccess,
}));

jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({
    description,
    render,
  }: {
    description: string;
    render: React.ReactElement;
  }) => (
    <div data-testid="tooltip" data-description={description}>
      {render}
    </div>
  ),
}));

jest.mock('recoil', () => ({
  useRecoilState: () => [mockIsTemporary, mockSetIsTemporary],
  useRecoilValue: (atom: { key?: string }) => {
    if (String(atom?.key ?? atom).includes('submitting')) {
      return mockIsSubmitting;
    }
    return mockConversation;
  },
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    isTemporary: { key: 'isTemporary' },
    conversationByIndex: () => ({ key: 'conversation' }),
    isSubmittingFamily: () => ({ key: 'submitting' }),
  },
}));

import PrivateToggle from '../PrivateToggle';

describe('PrivateToggle composer icon', () => {
  beforeEach(() => {
    mockSetIsTemporary.mockClear();
    mockIsTemporary = false;
    mockConversation = { messages: [] };
    mockIsSubmitting = false;
    mockHasAccess = true;
  });

  it('toggles store.isTemporary when unlocked', async () => {
    const user = userEvent.setup();
    render(<PrivateToggle index={0} />);
    const button = screen.getByTestId('session-private-toggle');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);
    expect(mockSetIsTemporary).toHaveBeenCalled();
  });

  it('locks after the first message and shows short new-chat tooltip', async () => {
    const user = userEvent.setup();
    mockIsTemporary = true;
    mockConversation = { messages: [{ messageId: 'm1' }] };
    render(<PrivateToggle index={0} />);
    const button = screen.getByTestId('session-private-toggle');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('tooltip')).toHaveAttribute(
      'data-description',
      'com_ui_session_private_locked',
    );
    await user.click(button);
    expect(mockSetIsTemporary).not.toHaveBeenCalled();
  });

  it('hides without TEMPORARY_CHAT access', () => {
    mockHasAccess = false;
    const { container } = render(<PrivateToggle index={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
