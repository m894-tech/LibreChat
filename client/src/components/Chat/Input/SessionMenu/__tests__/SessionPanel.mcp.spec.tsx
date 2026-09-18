import React, { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { SessionPanelView } from '../SessionPanel';

const mockToggleServerSelection = jest.fn();
const mockSetIsPinned = jest.fn();

const selectableServers = [
  { serverName: 'server-a', config: { title: 'Server A' } },
  { serverName: 'server-b', config: { title: 'Server B' } },
];

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => true,
  useHasMemoryAccess: () => false,
  useAgentCapabilities: () => ({
    codeEnabled: false,
    webSearchEnabled: false,
    artifactsEnabled: false,
    fileSearchEnabled: false,
    memoryEnabled: false,
  }),
  useAuthContext: () => ({ user: null }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: { modelSelect: true } } }),
  useProjectQuery: () => ({ data: undefined }),
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

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => ({
    conversationId: 'new',
    storageContextKey: undefined,
    agentsConfig: { capabilities: [] },
    mcpServerManager: {
      isPinned: false,
      mcpValues: [] as string[],
      setIsPinned: mockSetIsPinned,
      placeholderText: 'MCP Servers',
      availableMCPServers: selectableServers,
      selectableServers,
      connectionStatus: {},
      isInitializing: () => false,
      getConfigDialogProps: () => null,
      toggleServerSelection: mockToggleServerSelection,
      getServerStatusIconProps: () => null,
    },
  }),
}));

jest.mock('~/hooks/MCP/useMCPRefresh', () => ({
  useMCPRefresh: () => undefined,
}));

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    MCPIcon: ({ className }: { className?: string }) => R.createElement('span', { className }),
    PinIcon: ({ unpin }: { unpin?: boolean }) =>
      R.createElement('span', { 'data-testid': unpin ? 'unpin-icon' : 'pin-icon' }),
    Switch: () => null,
    VectorIcon: () => null,
    Spinner: () => null,
  };
});

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
  default: () => null,
}));

jest.mock('../SessionOrchSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../ResponseFormatSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../SessionEffortSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../SessionNativeKnobsSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../AgentPickerButton', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../SessionSkillsSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../SessionProjectSection', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/MCP/MCPConfigDialog', () => ({
  __esModule: true,
  default: () => null,
}));

import SessionPanel from '../SessionPanel';

function Harness() {
  const [view, setView] = useState<SessionPanelView>('main');
  return (
    <SessionPanel conversation={null} index={0} view={view} onViewChange={setView} />
  );
}

describe('SessionPanel MCP open path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the inline server list in the same panel (no dead click, no NavRow hop)', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByTestId('session-tool-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('session-mcp-server-list')).not.toBeInTheDocument();

    await user.click(screen.getByText('com_ui_mcp_servers'));

    expect(screen.getByTestId('session-menu-mcp')).toBeInTheDocument();
    expect(screen.getByTestId('session-mcp-server-list')).toBeInTheDocument();
    expect(screen.getByLabelText(/Server A/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Server B/)).toBeInTheDocument();
    expect(screen.queryByTestId('session-tool-grid')).not.toBeInTheDocument();
  });

  it('toggles and pins servers from the inline mcp view', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText('com_ui_mcp_servers'));
    await user.click(screen.getByLabelText(/Server A/));
    expect(mockToggleServerSelection).toHaveBeenCalledWith('server-a');

    await user.click(screen.getByLabelText('com_ui_pin'));
    expect(mockSetIsPinned).toHaveBeenCalledWith(true);
  });
});
