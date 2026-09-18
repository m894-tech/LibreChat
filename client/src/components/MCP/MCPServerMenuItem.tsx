import { Check } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import { MCPIcon } from '@librechat/client';
import type { MCPServerDefinition } from '~/hooks/MCP/useMCPServerManager';
import type { MCPServerStatusIconProps } from './MCPServerStatusIcon';
import {
  getStatusColor,
  getStatusTextKey,
  shouldShowActionButton,
  type ConnectionStatusMap,
} from './mcpServerUtils';
import MCPServerStatusIcon from './MCPServerStatusIcon';
import CustomIcon from '~/components/ui/CustomIcon';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MCPServerMenuItemProps {
  server: MCPServerDefinition;
  isSelected: boolean;
  connectionStatus?: ConnectionStatusMap;
  isInitializing?: (serverName: string) => boolean;
  statusIconProps?: MCPServerStatusIconProps | null;
  onToggle: (serverName: string) => void;
  /**
   * Plain button row for Session sheet (inside OGDialog).
   * Avoids Ariakit Menu — a nested menu here can hide content / steal dismiss.
   */
  inline?: boolean;
}

function ServerRowContent({
  server,
  isSelected,
  statusColor,
  showActionButton,
  statusIconProps,
}: {
  server: MCPServerDefinition;
  isSelected: boolean;
  statusColor: string;
  showActionButton: boolean;
  statusIconProps?: MCPServerStatusIconProps | null;
}) {
  const displayName = server.config?.title || server.serverName;

  return (
    <>
      <div className="relative flex-shrink-0">
        {server.config?.iconPath ? (
          <CustomIcon
            src={server.config.iconPath}
            className="h-8 w-8 rounded-lg object-cover text-text-primary"
            alt=""
          />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary">
            <MCPIcon className="h-5 w-5 text-text-secondary" />
          </div>
        )}
        <div
          aria-hidden="true"
          className={cn(
            'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-secondary',
            statusColor,
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-text-primary">{displayName}</span>
        </div>
        {server.config?.description ? (
          <p className="truncate text-xs text-text-secondary">{server.config.description}</p>
        ) : null}
      </div>

      {showActionButton && statusIconProps ? (
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <MCPServerStatusIcon {...statusIconProps} />
        </div>
      ) : null}

      <span
        aria-hidden="true"
        className={cn(
          'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border',
          isSelected
            ? 'border-border-xheavy bg-surface-inverted text-text-inverted'
            : 'border-border-xheavy bg-transparent',
        )}
      >
        {isSelected ? <Check className="h-4 w-4" /> : null}
      </span>
    </>
  );
}

const rowClassName = (isSelected: boolean) =>
  cn(
    'group flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2',
    'outline-none transition-all duration-150',
    'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
    isSelected && 'bg-surface-active-alt',
  );

export default function MCPServerMenuItem({
  server,
  isSelected,
  connectionStatus,
  isInitializing,
  statusIconProps,
  onToggle,
  inline = false,
}: MCPServerMenuItemProps) {
  const localize = useLocalize();
  const displayName = server.config?.title || server.serverName;
  const statusColor = getStatusColor(server.serverName, connectionStatus, isInitializing);
  const statusTextKey = getStatusTextKey(server.serverName, connectionStatus, isInitializing);
  const statusText = localize(statusTextKey as Parameters<typeof localize>[0]);
  const showActionButton = shouldShowActionButton(statusIconProps);
  const accessibleLabel = `${displayName}, ${statusText}`;
  const content = (
    <ServerRowContent
      server={server}
      isSelected={isSelected}
      statusColor={statusColor}
      showActionButton={showActionButton}
      statusIconProps={statusIconProps}
    />
  );

  if (inline) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={isSelected}
        aria-label={accessibleLabel}
        onClick={() => onToggle(server.serverName)}
        className={rowClassName(isSelected)}
      >
        {content}
      </button>
    );
  }

  return (
    <Ariakit.MenuItemCheckbox
      hideOnClick={false}
      name="mcp-servers"
      value={server.serverName}
      checked={isSelected}
      onChange={() => onToggle(server.serverName)}
      aria-label={accessibleLabel}
      className={rowClassName(isSelected)}
    >
      {content}
    </Ariakit.MenuItemCheckbox>
  );
}
