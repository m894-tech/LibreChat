import React from 'react';
import { Permissions, PermissionTypes } from 'librechat-data-provider';
import MCPSubMenu from '~/components/Chat/Input/MCPSubMenu';
import { useGetStartupConfig } from '~/data-provider';
import { useHasAccess, useLocalize } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';

export default function SessionMCPSection() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const context = useBadgeRowContext();
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });
  const { availableMCPServers } = context?.mcpServerManager ?? {};
  const placeholder = startupConfig?.interface?.mcpServers?.placeholder;

  if (!canUseMcp || !availableMCPServers || availableMCPServers.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5" data-testid="session-menu-mcp">
      <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
        {localize('com_ui_mcp_servers')}
      </div>
      <MCPSubMenu placeholder={placeholder} />
    </div>
  );
}
