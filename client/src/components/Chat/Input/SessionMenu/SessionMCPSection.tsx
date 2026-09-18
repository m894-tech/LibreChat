import React from 'react';
import * as Ariakit from '@ariakit/react';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import MCPServerMenuItem from '~/components/MCP/MCPServerMenuItem';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import { useMCPRefresh } from '~/hooks/MCP/useMCPRefresh';
import { useGetStartupConfig } from '~/data-provider';
import { useHasAccess, useLocalize } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';

/**
 * Session sheet MCP view: list servers inline.
 * Nesting MCPSubMenu (right-flyout + portal) inside the sheet parks the
 * menuitemcheckbox rows off-screen, so selection stays in-panel here.
 */
export default function SessionMCPSection() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const context = useBadgeRowContext();
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });
  const { conversationId, storageContextKey, mcpServerManager } = context ?? {};
  const selectableServers = mcpServerManager?.selectableServers;
  const configDialogOpen = mcpServerManager?.getConfigDialogProps()?.isOpen === true;

  useMCPRefresh({
    enabled: ((selectableServers?.length ?? 0) > 0 || configDialogOpen) && canUseMcp,
  });

  if (!canUseMcp || !mcpServerManager || !selectableServers || selectableServers.length === 0) {
    return null;
  }

  const {
    mcpValues,
    isInitializing,
    connectionStatus,
    toggleServerSelection,
    getServerStatusIconProps,
    getConfigDialogProps,
  } = mcpServerManager;
  const configDialogProps = getConfigDialogProps();
  const heading =
    startupConfig?.interface?.mcpServers?.placeholder || localize('com_ui_mcp_servers');

  return (
    <div className="flex flex-col gap-0.5" data-testid="session-menu-mcp">
      <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
        {heading}
      </div>
      <Ariakit.MenuProvider defaultOpen={true}>
        <Ariakit.Menu
          open={true}
          portal={false}
          gutter={0}
          hideOnEscape={false}
          hideOnInteractOutside={false}
          aria-label={localize('com_ui_mcp_servers')}
          className="relative z-0 flex w-full flex-col gap-0.5 rounded-lg border border-border-light bg-surface-secondary p-1"
        >
          {selectableServers.map((server) => (
            <MCPServerMenuItem
              key={server.serverName}
              server={server}
              isSelected={mcpValues?.includes(server.serverName) ?? false}
              connectionStatus={connectionStatus}
              isInitializing={isInitializing}
              statusIconProps={getServerStatusIconProps(server.serverName)}
              onToggle={toggleServerSelection}
            />
          ))}
        </Ariakit.Menu>
      </Ariakit.MenuProvider>
      {configDialogProps ? (
        <MCPConfigDialog
          {...configDialogProps}
          conversationId={conversationId}
          storageContextKey={storageContextKey}
        />
      ) : null}
    </div>
  );
}
