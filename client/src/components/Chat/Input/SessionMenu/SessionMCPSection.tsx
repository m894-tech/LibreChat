import React from 'react';
import * as Ariakit from '@ariakit/react';
import { PinIcon } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import MCPServerMenuItem from '~/components/MCP/MCPServerMenuItem';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import { useMCPRefresh } from '~/hooks/MCP/useMCPRefresh';
import { useGetStartupConfig } from '~/data-provider';
import { useHasAccess, useLocalize } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { cn } from '~/utils';

type SessionMCPSectionProps = {
  /** Inline drill inside Session sheet — server list always open; no NavRow hop. */
  drill?: boolean;
};

export default function SessionMCPSection({ drill = false }: SessionMCPSectionProps) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const context = useBadgeRowContext();
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });
  const { conversationId, storageContextKey, mcpServerManager } = context ?? {};
  const placeholder = startupConfig?.interface?.mcpServers?.placeholder;

  const menuStore = Ariakit.useMenuStore({
    open: true,
    setOpen: () => undefined,
    focusLoop: true,
  });

  const configDialogOpen = mcpServerManager?.getConfigDialogProps()?.isOpen === true;
  useMCPRefresh({
    enabled:
      ((mcpServerManager?.selectableServers.length ?? 0) > 0 || configDialogOpen) &&
      canUseMcp === true,
  });

  if (!canUseMcp || !mcpServerManager) {
    return null;
  }

  const {
    isPinned,
    mcpValues,
    setIsPinned,
    isInitializing,
    placeholderText,
    connectionStatus,
    selectableServers,
    getConfigDialogProps,
    toggleServerSelection,
    getServerStatusIconProps,
    availableMCPServers,
  } = mcpServerManager;

  if (!availableMCPServers || availableMCPServers.length === 0) {
    return null;
  }

  if (!selectableServers || selectableServers.length === 0) {
    return null;
  }

  const configDialogProps = getConfigDialogProps();
  const label = placeholder || placeholderText || localize('com_ui_mcp_servers');

  return (
    <div className="flex flex-col gap-0.5" data-testid="session-menu-mcp">
      {drill ? null : (
        <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
          {localize('com_ui_mcp_servers')}
        </div>
      )}
      <div className="flex items-center justify-between rounded-lg px-2 py-1.5">
        <span className="text-sm text-text-primary">{label}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsPinned(!isPinned);
          }}
          className={cn(
            'rounded p-1 transition-all duration-200',
            'hover:bg-surface-tertiary hover:shadow-sm',
            !isPinned && 'text-text-secondary hover:text-text-primary',
          )}
          aria-label={isPinned ? localize('com_ui_unpin') : localize('com_ui_pin')}
        >
          <div className="h-4 w-4">
            <PinIcon unpin={isPinned} />
          </div>
        </button>
      </div>
      <Ariakit.MenuProvider store={menuStore}>
        <Ariakit.Menu
          portal={false}
          modal={false}
          hideOnInteractOutside={false}
          autoFocusOnShow={false}
          aria-label={localize('com_ui_mcp_servers')}
          className={cn(
            'relative !inset-auto !transform-none !opacity-100',
            'flex max-h-[min(320px,50vh)] w-full flex-col gap-1 overflow-y-auto p-0.5',
            'border-0 bg-transparent shadow-none outline-none',
          )}
          data-testid="session-mcp-server-list"
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
