import React, { useCallback, useMemo } from 'react';
import { PinIcon, Switch, VectorIcon } from '@librechat/client';
import { Box, Brain, ChevronRight, Globe, TerminalSquareIcon } from 'lucide-react';
import {
  ArtifactModes,
  Permissions,
  PermissionTypes,
  defaultAgentCapabilities,
} from 'librechat-data-provider';
import {
  useLocalize,
  useHasAccess,
  useHasMemoryAccess,
  useAgentCapabilities,
  useAuthContext,
} from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import ChipScroller from './ChipScroller';
import { cn } from '~/utils';

type ToolGridProps = {
  onOpenMcp?: () => void;
};

function PinButton({
  pinned,
  onToggle,
  label,
}: {
  pinned?: boolean;
  onToggle?: (next: boolean) => void;
  label: string;
}) {
  if (onToggle == null) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(!pinned);
      }}
      className={cn(
        'rounded p-0.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary',
        pinned && 'text-text-primary',
      )}
      aria-label={label}
    >
      <div className="size-3.5">
        <PinIcon unpin={Boolean(pinned)} />
      </div>
    </button>
  );
}

function ToolCell({
  icon,
  label,
  checked,
  onToggle,
  onNavigate,
  meta,
  pinned,
  onPinToggle,
  pinLabel,
}: {
  icon: React.ReactNode;
  label: string;
  checked?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
  meta?: string;
  pinned?: boolean;
  onPinToggle?: (next: boolean) => void;
  pinLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-[10px] border border-border-light bg-surface-secondary px-2 py-1.5 text-xs text-text-primary">
      <button
        type="button"
        onClick={onNavigate ?? onToggle}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-surface-tertiary text-text-secondary">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta ? <span className="shrink-0 text-[10px] text-text-secondary">{meta}</span> : null}
        {onNavigate ? (
          <ChevronRight className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
        ) : null}
      </button>
      <PinButton pinned={pinned} onToggle={onPinToggle} label={pinLabel ?? label} />
      {onToggle ? (
        <Switch checked={Boolean(checked)} onCheckedChange={() => onToggle()} aria-label={label} />
      ) : null}
    </div>
  );
}

function ModeChip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-2.5 py-1 text-[11px]',
        active
          ? 'border-border-heavy bg-surface-hover text-text-primary'
          : 'border-border-light text-text-secondary hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

/** Dense 2-col tool toggles. State is BadgeRowContext — same as SessionModeList. */
export default function ToolGrid({ onOpenMcp }: ToolGridProps) {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const context = useBadgeRowContext();
  const capabilities = useMemo(() => {
    const fromConfig = context?.agentsConfig?.capabilities ?? [];
    return [...new Set([...defaultAgentCapabilities, ...fromConfig])];
  }, [context?.agentsConfig?.capabilities]);
  const { codeEnabled, webSearchEnabled, artifactsEnabled, fileSearchEnabled, memoryEnabled } =
    useAgentCapabilities(capabilities);

  const canUseWebSearch = useHasAccess({
    permissionType: PermissionTypes.WEB_SEARCH,
    permission: Permissions.USE,
  });
  const canRunCode = useHasAccess({
    permissionType: PermissionTypes.RUN_CODE,
    permission: Permissions.USE,
  });
  const canUseFileSearch = useHasAccess({
    permissionType: PermissionTypes.FILE_SEARCH,
    permission: Permissions.USE,
  });
  const canUseMcp = useHasAccess({
    permissionType: PermissionTypes.MCP_SERVERS,
    permission: Permissions.USE,
  });
  const canUseMemory = useHasMemoryAccess();
  const showMemory = canUseMemory && memoryEnabled && user?.personalization?.memories !== false;

  const { webSearch, artifacts, fileSearch, codeInterpreter, memory } = context ?? {};
  const { availableMCPServers } = context?.mcpServerManager ?? {};

  const { isPinned: isSearchPinned, setIsPinned: setIsSearchPinned } = webSearch ?? {};
  const { isPinned: isCodePinned, setIsPinned: setIsCodePinned } = codeInterpreter ?? {};
  const { isPinned: isFileSearchPinned, setIsPinned: setIsFileSearchPinned } = fileSearch ?? {};
  const { isPinned: isArtifactsPinned, setIsPinned: setIsArtifactsPinned } = artifacts ?? {};
  const { isPinned: isMemoryPinned, setIsPinned: setIsMemoryPinned } = memory ?? {};

  const handleWebSearchToggle = useCallback(() => {
    webSearch?.debouncedChange({ value: !webSearch?.toggleState });
  }, [webSearch]);
  const handleCodeToggle = useCallback(() => {
    codeInterpreter?.debouncedChange({ value: !codeInterpreter?.toggleState });
  }, [codeInterpreter]);
  const handleFileSearchToggle = useCallback(() => {
    fileSearch?.debouncedChange({ value: !fileSearch?.toggleState });
  }, [fileSearch]);
  const handleMemoryToggle = useCallback(() => {
    memory?.debouncedChange({ value: !memory?.toggleState });
  }, [memory]);
  const handleArtifactsToggle = useCallback(() => {
    const currentState = artifacts?.toggleState;
    if (!currentState || currentState === '') {
      artifacts?.debouncedChange({ value: ArtifactModes.DEFAULT });
    } else {
      artifacts?.debouncedChange({ value: '' });
    }
  }, [artifacts]);
  const handleShadcnToggle = useCallback(() => {
    const currentState = artifacts?.toggleState;
    if (currentState === ArtifactModes.SHADCNUI) {
      artifacts?.debouncedChange({ value: ArtifactModes.DEFAULT });
    } else {
      artifacts?.debouncedChange({ value: ArtifactModes.SHADCNUI });
    }
  }, [artifacts]);
  const handleCustomToggle = useCallback(() => {
    const currentState = artifacts?.toggleState;
    if (currentState === ArtifactModes.CUSTOM) {
      artifacts?.debouncedChange({ value: ArtifactModes.DEFAULT });
    } else {
      artifacts?.debouncedChange({ value: ArtifactModes.CUSTOM });
    }
  }, [artifacts]);

  const pinLabel = useCallback(
    (pinned?: boolean) => (pinned ? localize('com_ui_unpin') : localize('com_ui_pin')),
    [localize],
  );

  const artifactsOn = Boolean(artifacts?.toggleState && artifacts.toggleState !== '');
  const artifactsMode = (artifacts?.toggleState as string) || '';

  const cells: React.ReactNode[] = [];

  if (fileSearchEnabled && canUseFileSearch) {
    cells.push(
      <ToolCell
        key="file-search"
        icon={<VectorIcon className="size-3.5" />}
        label={localize('com_assistants_file_search')}
        checked={Boolean(fileSearch?.toggleState)}
        onToggle={handleFileSearchToggle}
        pinned={isFileSearchPinned}
        onPinToggle={setIsFileSearchPinned}
        pinLabel={pinLabel(isFileSearchPinned)}
      />,
    );
  }
  if (canRunCode && codeEnabled) {
    cells.push(
      <ToolCell
        key="run-code"
        icon={<TerminalSquareIcon className="size-3.5" aria-hidden="true" />}
        label={localize('com_ui_run_code')}
        checked={Boolean(codeInterpreter?.toggleState)}
        onToggle={handleCodeToggle}
        pinned={isCodePinned}
        onPinToggle={setIsCodePinned}
        pinLabel={pinLabel(isCodePinned)}
      />,
    );
  }
  if (showMemory) {
    cells.push(
      <ToolCell
        key="memory"
        icon={<Brain className="size-3.5" aria-hidden="true" />}
        label={localize('com_ui_memory')}
        checked={Boolean(memory?.toggleState)}
        onToggle={handleMemoryToggle}
        pinned={isMemoryPinned}
        onPinToggle={setIsMemoryPinned}
        pinLabel={pinLabel(isMemoryPinned)}
      />,
    );
  }
  if (artifactsEnabled) {
    cells.push(
      <ToolCell
        key="artifacts"
        icon={<Box className="size-3.5" aria-hidden="true" />}
        label={localize('com_ui_artifacts')}
        checked={artifactsOn}
        onToggle={handleArtifactsToggle}
        pinned={isArtifactsPinned}
        onPinToggle={setIsArtifactsPinned}
        pinLabel={pinLabel(isArtifactsPinned)}
      />,
    );
  }
  if (canUseWebSearch && webSearchEnabled) {
    cells.push(
      <ToolCell
        key="web-search"
        icon={<Globe className="size-3.5" aria-hidden="true" />}
        label={localize('com_ui_web_search')}
        checked={Boolean(webSearch?.toggleState)}
        onToggle={handleWebSearchToggle}
        pinned={isSearchPinned}
        onPinToggle={setIsSearchPinned}
        pinLabel={pinLabel(isSearchPinned)}
      />,
    );
  }
  if (canUseMcp && availableMCPServers && availableMCPServers.length > 0 && onOpenMcp) {
    cells.push(
      <ToolCell
        key="mcp"
        icon={<span className="text-[9px] font-bold">MCP</span>}
        label={localize('com_ui_mcp_servers')}
        meta={String(availableMCPServers.length)}
        onNavigate={onOpenMcp}
      />,
    );
  }

  if (cells.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="session-tool-grid">
      <div className="grid grid-cols-2 gap-1">{cells}</div>
      {artifactsOn ? (
        <ChipScroller aria-label={localize('com_ui_artifacts')}>
          <ModeChip
            testId="artifacts-mode-default"
            active={
              artifactsMode === ArtifactModes.DEFAULT ||
              artifactsMode === 'true' ||
              (artifactsMode !== '' &&
                artifactsMode !== ArtifactModes.SHADCNUI &&
                artifactsMode !== ArtifactModes.CUSTOM)
            }
            onClick={() => artifacts?.debouncedChange({ value: ArtifactModes.DEFAULT })}
          >
            {localize('com_ui_response_format_default')}
          </ModeChip>
          <ModeChip
            testId="artifacts-mode-shadcn"
            active={artifactsMode === ArtifactModes.SHADCNUI}
            onClick={handleShadcnToggle}
          >
            {localize('com_ui_include_shadcnui')}
          </ModeChip>
          <ModeChip
            testId="artifacts-mode-custom"
            active={artifactsMode === ArtifactModes.CUSTOM}
            onClick={handleCustomToggle}
          >
            {localize('com_ui_custom_prompt_mode')}
          </ModeChip>
        </ChipScroller>
      ) : null}
    </div>
  );
}
