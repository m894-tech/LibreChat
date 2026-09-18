import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import SessionMCPSection from '../SessionMCPSection';

const mockToggleServerSelection = jest.fn();
const mockSetIsPinned = jest.fn();
const mockMCPRefresh = jest.fn();

jest.mock('~/hooks/MCP/useMCPRefresh', () => ({
  useMCPRefresh: (options: { enabled: boolean }) => mockMCPRefresh(options),
}));

const defaultMcpServerManager = {
  isPinned: true,
  mcpValues: [] as string[],
  setIsPinned: mockSetIsPinned,
  placeholderText: 'MCP Servers',
  availableMCPServers: ['server-a', 'server-b'],
  selectableServers: [
    { serverName: 'server-a', config: { title: 'Server A' } },
    { serverName: 'server-b', config: { title: 'Server B', description: 'Second server' } },
  ],
  connectionStatus: {},
  isInitializing: () => false,
  getConfigDialogProps: () => null,
  toggleServerSelection: mockToggleServerSelection,
  getServerStatusIconProps: () => null,
};

let mockMcpServerManager = { ...defaultMcpServerManager };
let mockCanUseMcp = true;

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => ({
    conversationId: 'new',
    storageContextKey: undefined,
    mcpServerManager: mockMcpServerManager,
  }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: undefined }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => mockCanUseMcp,
}));

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    MCPIcon: ({ className }: { className?: string }) => R.createElement('span', { className }),
    PinIcon: ({ unpin }: { unpin?: boolean }) =>
      R.createElement('span', { 'data-testid': unpin ? 'unpin-icon' : 'pin-icon' }),
    Spinner: ({ className }: { className?: string }) => R.createElement('span', { className }),
  };
});

jest.mock('~/components/MCP/MCPConfigDialog', () => ({
  __esModule: true,
  default: () => null,
}));

describe('SessionMCPSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCanUseMcp = true;
    mockMcpServerManager = { ...defaultMcpServerManager };
  });

  it('renders nothing without MCP access', () => {
    mockCanUseMcp = false;
    const { container } = render(<SessionMCPSection drill />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no servers are available', () => {
    mockMcpServerManager = {
      ...defaultMcpServerManager,
      availableMCPServers: [],
      selectableServers: [],
    };
    const { container } = render(<SessionMCPSection drill />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows server toggles inline in drill mode without a NavRow hop', () => {
    render(<SessionMCPSection drill />);

    expect(screen.getByTestId('session-mcp-server-list')).toBeInTheDocument();
    expect(screen.getByLabelText(/Server A/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Server B/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MCP Servers/ })).not.toBeInTheDocument();
  });

  it('toggles a server from the inline list', async () => {
    const user = userEvent.setup();
    render(<SessionMCPSection drill />);

    await user.click(screen.getByLabelText(/Server A/));
    expect(mockToggleServerSelection).toHaveBeenCalledWith('server-a');
  });

  it('pins MCP from the drill header', async () => {
    const user = userEvent.setup();
    mockMcpServerManager = { ...defaultMcpServerManager, isPinned: false };
    render(<SessionMCPSection drill />);

    await user.click(screen.getByLabelText('com_ui_pin'));
    expect(mockSetIsPinned).toHaveBeenCalledWith(true);
  });

  it('enables MCP refresh while the list is mounted', () => {
    render(<SessionMCPSection drill />);
    expect(mockMCPRefresh).toHaveBeenCalledWith({ enabled: true });
  });
});
