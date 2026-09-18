import React, { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { getConfigDefaults, PermissionTypes, Permissions } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import type { NativeModelControls } from '~/hooks/Input/useNativeModelControls';
import ExportAndShareMenu from '~/components/Chat/ExportAndShareMenu';
import { SessionAutomationsSection } from '~/components/Automations';
import SessionNativeKnobsSection from './SessionNativeKnobsSection';
import BookmarkMenu from '~/components/Chat/Menus/BookmarkMenu';
import ResponseFormatSection from './ResponseFormatSection';
import ContextSourcesSection from './ContextSourcesSection';
import SessionProfileSection from './SessionProfileSection';
import AddMultiConvo from '~/components/Chat/AddMultiConvo';
import SessionSkillsSection from './SessionSkillsSection';
import { useGetStartupConfig } from '~/data-provider';
import SessionOrchSection from './SessionOrchSection';
import { PresetsMenu } from '~/components/Chat/Menus';
import { useLocalize, useHasAccess } from '~/hooks';
import AgentPickerButton from './AgentPickerButton';
import SessionMCPSection from './SessionMCPSection';
import PrivateToggle from './PrivateToggle';
import ToolGrid from './ToolGrid';

export type SessionPanelView = 'main' | 'mcp' | 'skills' | 'automations' | 'context';

type SessionPanelProps = {
  conversation?: TConversation | null;
  index?: number;
  showAgentPicker?: boolean;
  modelControls?: NativeModelControls | null;
  view: SessionPanelView;
  onViewChange: (view: SessionPanelView) => void;
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-0.5 pb-1 text-[9px] font-bold uppercase tracking-[0.08em] text-text-secondary">
      {children}
    </div>
  );
}

function NavRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 border-b border-border-light px-2.5 py-2 text-left text-[12.5px] last:border-b-0 hover:bg-surface-hover"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
    </button>
  );
}

/** Shared Session chrome body — same IA for sheet and desktop panel. */
export default function SessionPanel({
  conversation,
  index = 0,
  showAgentPicker = true,
  modelControls = null,
  view,
  onViewChange,
}: SessionPanelProps) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const interfaceConfig = useMemo(
    () => startupConfig?.interface ?? getConfigDefaults().interface,
    [startupConfig],
  );
  const hasAccessToBookmarks = useHasAccess({
    permissionType: PermissionTypes.BOOKMARKS,
    permission: Permissions.USE,
  });
  const hasAccessToMultiConvo = useHasAccess({
    permissionType: PermissionTypes.MULTI_CONVO,
    permission: Permissions.USE,
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2" data-testid="session-panel">
      {view === 'main' ? (
        <div className="flex flex-col gap-2">
          <section>
            <SectionLabel>{localize('com_ui_session_now')}</SectionLabel>
            <div className="flex flex-col gap-1.5">
              <SessionProfileSection conversationId={conversation?.conversationId} compact />
              <SessionOrchSection conversation={conversation} compact />
              <ResponseFormatSection conversation={conversation} index={index} compact />
              {modelControls ? (
                <SessionNativeKnobsSection conversation={conversation} controls={modelControls} />
              ) : null}
            </div>
            <p className="mt-1 px-0.5 text-[10px] leading-snug text-text-secondary">
              {localize('com_ui_session_sheet_now_hint')}
            </p>
          </section>

          <section>
            <SectionLabel>{localize('com_ui_session_privacy')}</SectionLabel>
            <PrivateToggle index={index} />
          </section>

          <section>
            <SectionLabel>{localize('com_ui_tools')}</SectionLabel>
            <ToolGrid onOpenMcp={() => onViewChange('mcp')} />
          </section>

          <section>
            <SectionLabel>{localize('com_ui_session_more')}</SectionLabel>
            <div className="overflow-hidden rounded-xl border border-border-light bg-surface-secondary">
              <NavRow label={localize('com_ui_skills')} onClick={() => onViewChange('skills')} />
              {showAgentPicker ? (
                <div className="border-b border-border-light px-1 py-0.5">
                  <AgentPickerButton
                    activeAgentId={conversation?.agent_id}
                    conversationId={conversation?.conversationId}
                    index={index}
                  />
                </div>
              ) : null}
              <NavRow
                label={localize('com_ui_session_automations')}
                onClick={() => onViewChange('automations')}
              />
              <NavRow
                label={localize('com_ui_context_sources')}
                onClick={() => onViewChange('context')}
              />
              <div
                className="flex flex-wrap items-center gap-1 border-t border-border-light px-2 py-1.5"
                data-testid="session-more-chrome"
              >
                <ExportAndShareMenu
                  isSharedButtonEnabled={startupConfig?.sharedLinksEnabled ?? false}
                />
                {interfaceConfig.presets === true && interfaceConfig.modelSelect ? (
                  <PresetsMenu />
                ) : null}
                {hasAccessToBookmarks ? <BookmarkMenu /> : null}
                {hasAccessToMultiConvo ? <AddMultiConvo /> : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {view === 'mcp' ? <SessionMCPSection /> : null}
      {view === 'skills' ? <SessionSkillsSection agentId={conversation?.agent_id} /> : null}
      {view === 'automations' ? (
        <SessionAutomationsSection conversationId={conversation?.conversationId} />
      ) : null}
      {view === 'context' ? <ContextSourcesSection conversation={conversation} /> : null}
    </div>
  );
}
