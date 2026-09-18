import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';

const mockSetSheetOpen = jest.fn();
let mockStartupConfig: {
  interface?: { sessionMenu?: boolean };
  modelSpecs?: { list?: Array<{ name: string; label: string }> };
} = {
  interface: { sessionMenu: true },
  modelSpecs: { list: [{ name: 'gemini-3.8', label: 'Gemini 3.8' }] },
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
  normalizeResponseFormat: () => 'detailed',
}));

import SessionSummaryPill from '../SessionSummaryPill';

describe('SessionSummaryPill', () => {
  beforeEach(() => {
    mockSetSheetOpen.mockClear();
    mockStartupConfig = {
      interface: { sessionMenu: true },
      modelSpecs: { list: [{ name: 'gemini-3.8', label: 'Gemini 3.8' }] },
    };
  });

  it('renders one Model · Profile · Orch · Format pill without a second model chip', async () => {
    const user = userEvent.setup();
    render(
      <SessionSummaryPill
        conversation={
          {
            conversationId: 'c1',
            model: 'gemini-3.8',
            modelLabel: 'Gemini 3.8',
            spec: 'gemini-3.8',
          } as never
        }
        index={0}
      />,
    );

    expect(screen.queryByTestId('session-model-chip')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select a model' })).not.toBeInTheDocument();

    const pill = screen.getByTestId('session-summary-pill');
    expect(screen.getByTestId('session-summary-model')).toHaveTextContent('Gemini 3.8');
    expect(pill).toHaveTextContent('com_ui_session_profile_research');
    expect(pill).toHaveTextContent('com_ui_session_orch_off');
    expect(pill).toHaveTextContent('com_ui_response_format_detailed');
    expect(pill).toHaveAttribute('aria-haspopup', 'dialog');
    expect(pill).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('session-private-chip')).toBeVisible();

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
