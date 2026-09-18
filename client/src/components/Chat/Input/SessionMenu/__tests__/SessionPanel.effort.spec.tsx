import React from 'react';
import { render, screen } from '@testing-library/react';
import { AnthropicEffort } from 'librechat-data-provider';
import type { NativeModelControls } from '~/hooks/Input/useNativeModelControls';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => false,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: { modelSelect: true } } }),
}));

jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    isSubmittingFamily: () => ({ key: 'submitting' }),
    useSetConversationAtom: () => ({ setConversation: jest.fn() }),
  },
}));

jest.mock('recoil', () => ({
  useRecoilValue: () => false,
}));

jest.mock('~/components/Chat/Menus/Endpoints/ModelSelector', () => ({
  __esModule: true,
  default: () => <div data-testid="model-selector-stub" />,
}));

jest.mock('~/components/Chat/Trace', () => ({
  TraceButton: () => null,
  useTraceControl: () => ({ show: false, open: jest.fn() }),
}));

jest.mock('~/components/Chat/ExportAndShareMenu', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/Automations', () => ({
  SessionAutomationsSection: () => null,
}));

jest.mock('~/components/Chat/Menus/BookmarkMenu', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/Chat/AddMultiConvo', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/Chat/Menus', () => ({
  PresetsMenu: () => null,
}));

jest.mock('../SessionProfileSection', () => ({
  __esModule: true,
  default: () => <div data-testid="session-profile-stub" />,
}));

jest.mock('../SessionOrchSection', () => ({
  __esModule: true,
  default: () => <div data-testid="session-orch-stub" />,
}));

jest.mock('../ResponseFormatSection', () => ({
  __esModule: true,
  default: () => <div data-testid="session-format-stub" />,
}));

jest.mock('../ToolGrid', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../PrivateToggle', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../AgentPickerButton', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../SessionMCPSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../SessionSkillsSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../ContextSourcesSection', () => ({
  __esModule: true,
  default: () => null,
}));

import SessionPanel from '../SessionPanel';

const effortControls: NativeModelControls = {
  family: {
    id: 'claude-adaptive',
    label: 'Claude effort',
    kind: 'text',
    match: ['claude-opus-5'],
    defaults: { effort: 'high' },
    groups: [
      {
        id: 'effort',
        label: 'Effort',
        chips: [
          { id: 'low', label: 'Low', apply: { effort: 'low' } },
          { id: 'mid', label: 'Mid', apply: { effort: 'medium' } },
          { id: 'high', label: 'High', apply: { effort: 'high' } },
        ],
      },
    ],
  },
  values: { effort: 'high' },
  payload: { family: 'claude-adaptive', effort: 'high' },
  applyChip: jest.fn(),
};

describe('SessionPanel Effort SoT', () => {
  it('renders a single Effort control in Now even when native knobs mirror effort', () => {
    render(
      <SessionPanel
        conversation={
          {
            conversationId: 'c1',
            effort: AnthropicEffort.medium,
            model: 'claude-opus-5',
          } as never
        }
        modelControls={effortControls}
        view="main"
        onViewChange={jest.fn()}
      />,
    );

    expect(screen.getAllByTestId('session-effort')).toHaveLength(1);
    expect(screen.queryByTestId('session-native-knobs')).not.toBeInTheDocument();
    expect(screen.getByTestId('session-effort-mid')).toHaveAttribute('aria-checked', 'true');
  });
});
