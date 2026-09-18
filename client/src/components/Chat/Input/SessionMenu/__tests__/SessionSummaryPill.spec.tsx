import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';

const mockSetSheetOpen = jest.fn();
let mockStartupConfig: { interface?: { sessionMenu?: boolean } } = {
  interface: { sessionMenu: true },
};

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));

jest.mock('~/components/Chat/Menus/Endpoints/ModelSelector', () => ({
  __esModule: true,
  default: () => (
    <button type="button" aria-label="Select a model" data-testid="model-selector-button" />
  ),
}));

jest.mock('recoil', () => ({
  useSetRecoilState: () => mockSetSheetOpen,
  useRecoilState: () => [false, mockSetSheetOpen],
  useRecoilValue: () => false,
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    sessionSheetOpenByIndex: () => ({}),
    isTemporary: {},
    conversationUiStateKey: () => 'new__0',
    responseFormatByIndex: () => ({}),
  },
}));

jest.mock('~/utils/sessionProfiles', () => ({
  SESSION_PROFILE_CHANGED_EVENT: 'session-profile-changed',
  loadSessionProfile: () => ({
    profile: 'research',
    createContract: 'none',
    executePolicy: 'ask',
    orchMode: 'off',
    orchParallel: false,
  }),
}));

jest.mock('~/utils/responseFormat', () => ({
  normalizeResponseFormat: () => 'default',
}));

import SessionSummaryPill from '../SessionSummaryPill';

describe('SessionSummaryPill', () => {
  beforeEach(() => {
    mockSetSheetOpen.mockClear();
    mockStartupConfig = { interface: { sessionMenu: true } };
  });

  it('renders model selector with Select a model a11y name plus profile · orch sheet trigger', async () => {
    const user = userEvent.setup();
    render(
      <SessionSummaryPill
        conversation={{ conversationId: 'c1', model: 'gemini-3.8', spec: null } as never}
        index={0}
      />,
    );

    const modelTrigger = screen.getByRole('button', { name: 'Select a model' });
    expect(modelTrigger).toBeVisible();
    expect(screen.getByTestId('session-model-chip')).toContainElement(modelTrigger);

    const pill = screen.getByTestId('session-summary-pill');
    expect(pill).toHaveTextContent('com_ui_session_profile_research');
    expect(pill).toHaveTextContent('com_ui_session_orch_off');
    expect(pill).toHaveAttribute('aria-haspopup', 'dialog');
    expect(pill).toHaveAttribute('aria-expanded', 'false');

    await user.click(pill);
    expect(mockSetSheetOpen).toHaveBeenCalledWith(true);
  });

  it('keeps the model chip but hides sheet triggers when sessionMenu is false', () => {
    mockStartupConfig = { interface: { sessionMenu: false } };
    render(
      <SessionSummaryPill
        conversation={{ conversationId: 'c1', model: 'gemini-3.8', spec: null } as never}
        index={0}
      />,
    );

    expect(screen.getByRole('button', { name: 'Select a model' })).toBeVisible();
    expect(screen.queryByTestId('session-summary-pill')).not.toBeInTheDocument();
    expect(screen.queryByTestId('session-private-chip')).not.toBeInTheDocument();
  });
});
