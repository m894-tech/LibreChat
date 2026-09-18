import React, { useEffect } from 'react';
import { PinIcon } from '@librechat/client';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import MCPServerMenuItem from '~/components/MCP/MCPServerMenuItem';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import { useMCPRefresh } from '~/hooks/MCP/useMCPRefresh';
import { useGetStartupConfig } from '~/data-provider';
import { activateCatalog, useHasAccess, useLocalize } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { cn } from '~/utils';

type SessionMCPSectionProps = {
  /** Inline drill inside Session sheet — server list always open; no NavRow hop. */
  drill?: boolean;
};

/**
 * Session MCP list. Always a plain DOM list (no Ariakit Menu): nested menus
 * inside OGDialog can leave the mcp view blank / steal dismiss.
 * Catalog warmup is released on mount so YAML servers (e.g. E2E Memory)
 * appear without waiting for the idle stagger.
 */
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

  useEffect(() => {
    activateCatalog('mcpServers');
  }, []);

  const configDialogOpen = mcpServerManager?.getConfigDialogProps()?.isOpen === true;
  const serverCount = mcpServerManager?.selectableServers.length ?? 0;
  useMCPRefresh({
    enabled: canUseMcp === true && (serverCount > 0 || configDialogOpen),
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

  const configDialogProps = getConfigDialogProps();
  const label = placeholder || placeholderText || localize('com_ui_mcp_servers');
  const servers = selectableServers ?? [];

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
            e.preventDefault();
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
      {servers.length === 0 ? (
        <p className="px-2 py-2 text-xs text-text-secondary" data-testid="session-mcp-empty">
          {localize('com_ui_mcp_servers')}
        </p>
      ) : (
        <div
          role="group"
          aria-label={localize('com_ui_mcp_servers')}
          className="flex max-h-[min(320px,50vh)] w-full flex-col gap-1 overflow-y-auto p-0.5"
          data-testid="session-mcp-server-list"
        >
          {servers.map((server) => (
            <MCPServerMenuItem
              key={server.serverName}
              inline
              server={server}
              isSelected={mcpValues?.includes(server.serverName) ?? false}
              connectionStatus={connectionStatus}
              isInitializing={isInitializing}
              statusIconProps={getServerStatusIconProps(server.serverName)}
              onToggle={toggleServerSelection}
            />
          ))}
        </div>
      )}
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
