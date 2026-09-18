import React, { useCallback, useMemo } from 'react';
import { PinIcon, VectorIcon } from '@librechat/client';
import { Globe, Settings, TerminalSquareIcon } from 'lucide-react';
import {
  AuthType,
  ArtifactModes,
  Permissions,
  PermissionTypes,
  defaultAgentCapabilities,
} from 'librechat-data-provider';
import { useLocalize, useHasAccess, useAgentCapabilities } from '~/hooks';
import ArtifactsSubMenu from '~/components/Chat/Input/ArtifactsSubMenu';
import { useBadgeRowContext } from '~/Providers';
import { cn } from '~/utils';

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
        'rounded p-1 transition-all duration-200',
        'hover:bg-surface-secondary hover:shadow-sm',
        !pinned && 'text-text-secondary hover:text-text-primary',
      )}
      aria-label={label}
    >
      <div className="h-4 w-4">
        <PinIcon unpin={Boolean(pinned)} />
      </div>
    </button>
  );
}

function ModeRow({
  icon,
  label,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
      <span className="flex items-center gap-1">{children}</span>
    </div>
  );
}

/**
 * Compact mode toggles. State is BadgeRowContext — not a second source of truth.
 */
export default function SessionModeList() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const capabilities = useMemo(() => {
    const fromConfig = context?.agentsConfig?.capabilities ?? [];
    return [...new Set([...defaultAgentCapabilities, ...fromConfig])];
  }, [context?.agentsConfig?.capabilities]);
  const { codeEnabled, webSearchEnabled, artifactsEnabled, fileSearchEnabled } =
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

  const { webSearch, artifacts, fileSearch, codeInterpreter, searchApiKeyForm } = context ?? {};
  const { setIsDialogOpen: setIsSearchDialogOpen, menuTriggerRef: searchMenuTriggerRef } =
    searchApiKeyForm ?? {};
  const {
    isPinned: isSearchPinned,
    setIsPinned: setIsSearchPinned,
    authData: webSearchAuthData,
  } = webSearch ?? {};
  const { isPinned: isCodePinned, setIsPinned: setIsCodePinned } = codeInterpreter ?? {};
  const { isPinned: isFileSearchPinned, setIsPinned: setIsFileSearchPinned } = fileSearch ?? {};
  const { isPinned: isArtifactsPinned, setIsPinned: setIsArtifactsPinned } = artifacts ?? {};

  const showWebSearchSettings = useMemo(() => {
    const authTypes = webSearchAuthData?.authTypes ?? [];
    if (authTypes.length === 0) {
      return true;
    }
    return !authTypes.every(([, authType]) => authType === AuthType.SYSTEM_DEFINED);
  }, [webSearchAuthData?.authTypes]);

  const handleWebSearchToggle = useCallback(() => {
    webSearch?.debouncedChange({ value: !webSearch?.toggleState });
  }, [webSearch]);
  const handleCodeInterpreterToggle = useCallback(() => {
    codeInterpreter?.debouncedChange({ value: !codeInterpreter?.toggleState });
  }, [codeInterpreter]);
  const handleFileSearchToggle = useCallback(() => {
    fileSearch?.debouncedChange({ value: !fileSearch?.toggleState });
  }, [fileSearch]);
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

  const pinLabel = (pinned?: boolean) =>
    pinned ? localize('com_ui_unpin') : localize('com_ui_pin');

  const hasModes =
    (fileSearchEnabled && canUseFileSearch) ||
    (canUseWebSearch && webSearchEnabled) ||
    (canRunCode && codeEnabled) ||
    (artifactsEnabled && setIsArtifactsPinned != null);

  if (!hasModes) {
    return null;
  }

  return (
    <div className="flex flex-col gap-0.5" data-testid="session-menu-modes">
      <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
        {localize('com_ui_session_modes')}
      </div>
      {fileSearchEnabled && canUseFileSearch ? (
        <ModeRow
          icon={<VectorIcon className="icon-md" />}
          label={localize('com_assistants_file_search')}
          onClick={handleFileSearchToggle}
        >
          <PinButton
            pinned={isFileSearchPinned}
            onToggle={setIsFileSearchPinned}
            label={pinLabel(isFileSearchPinned)}
          />
        </ModeRow>
      ) : null}
      {canUseWebSearch && webSearchEnabled ? (
        <ModeRow
          icon={<Globe className="icon-md" aria-hidden="true" />}
          label={localize('com_ui_web_search')}
          onClick={handleWebSearchToggle}
        >
          {showWebSearchSettings ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsSearchDialogOpen?.(true);
              }}
              className="rounded p-1 text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
              aria-label={localize('com_ui_web_search')}
              ref={searchMenuTriggerRef}
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <PinButton
            pinned={isSearchPinned}
            onToggle={setIsSearchPinned}
            label={pinLabel(isSearchPinned)}
          />
        </ModeRow>
      ) : null}
      {canRunCode && codeEnabled ? (
        <ModeRow
          icon={<TerminalSquareIcon className="icon-md" aria-hidden="true" />}
          label={localize('com_ui_run_code')}
          onClick={handleCodeInterpreterToggle}
        >
          <PinButton
            pinned={isCodePinned}
            onToggle={setIsCodePinned}
            label={pinLabel(isCodePinned)}
          />
        </ModeRow>
      ) : null}
      {artifactsEnabled && setIsArtifactsPinned != null ? (
        <ArtifactsSubMenu
          isArtifactsPinned={isArtifactsPinned ?? false}
          setIsArtifactsPinned={setIsArtifactsPinned}
          artifactsMode={artifacts?.toggleState as string}
          handleArtifactsToggle={handleArtifactsToggle}
          handleShadcnToggle={handleShadcnToggle}
          handleCustomToggle={handleCustomToggle}
        />
      ) : null}
    </div>
  );
}
