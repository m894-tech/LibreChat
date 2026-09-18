import React, { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import { ChevronRight } from 'lucide-react';
import { getConfigDefaults } from 'librechat-data-provider';
import type { TConversation } from 'librechat-data-provider';
import type { NativeModelControls } from '~/hooks/Input/useNativeModelControls';
import ModelSelector from '~/components/Chat/Menus/Endpoints/ModelSelector';
import { TraceButton, useTraceControl } from '~/components/Chat/Trace';
import { SessionAutomationsSection } from '~/components/Automations';
import SessionNativeKnobsSection from './SessionNativeKnobsSection';
import ResponseFormatSection from './ResponseFormatSection';
import ContextSourcesSection from './ContextSourcesSection';
import SessionProfileSection from './SessionProfileSection';
import SessionEffortSection from './SessionEffortSection';
import SessionSkillsSection from './SessionSkillsSection';
import { useGetStartupConfig } from '~/data-provider';
import SessionOrchSection from './SessionOrchSection';
import { PresetsMenu } from '~/components/Chat/Menus';
import AgentPickerButton from './AgentPickerButton';
import SessionMCPSection from './SessionMCPSection';
import { useLocalize } from '~/hooks';
import ToolGrid from './ToolGrid';
import store from '~/store';

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
  const isSubmitting = useRecoilValue(store.isSubmittingFamily(index));
  const trace = useTraceControl({
    conversationId: conversation?.conversationId,
    traceViewer: interfaceConfig.traceViewer,
    isSubmitting,
  });
  const showMoreChrome =
    trace.show || (interfaceConfig.presets === true && interfaceConfig.modelSelect);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2" data-testid="session-panel">
      {view === 'main' ? (
        <div className="flex flex-col gap-2">
          <section>
            <SectionLabel>{localize('com_ui_session_now')}</SectionLabel>
            <div className="flex flex-col gap-1.5">
              <div
                className="min-w-0 [&_.relative]:w-auto [&_.relative]:max-w-none [&_.relative]:items-start [&_[data-testid=model-selector-button]]:my-0 [&_[data-testid=model-selector-button]]:h-7 [&_[data-testid=model-selector-button]]:w-auto [&_[data-testid=model-selector-button]]:max-w-[14rem] [&_[data-testid=model-selector-button]]:rounded-full [&_[data-testid=model-selector-button]]:border-border-light [&_[data-testid=model-selector-button]]:bg-surface-secondary [&_[data-testid=model-selector-button]]:px-2.5 [&_[data-testid=model-selector-button]]:py-0 [&_[data-testid=model-selector-button]]:text-[11px]"
                data-testid="session-sheet-model"
              >
                <ModelSelector startupConfig={startupConfig} />
              </div>
              <SessionEffortSection conversation={conversation} index={index} />
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
            <SectionLabel>{localize('com_ui_tools')}</SectionLabel>
            <ToolGrid
              onOpenMcp={() => {
                onViewChange('mcp');
              }}
            />
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
              {showMoreChrome ? (
                <div
                  className="flex flex-wrap items-center gap-1 border-t border-border-light px-2 py-1.5"
                  data-testid="session-more-chrome"
                >
                  {trace.show ? <TraceButton onClick={trace.open} /> : null}
                  {interfaceConfig.presets === true && interfaceConfig.modelSelect ? (
                    <PresetsMenu />
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {view === 'mcp' ? <SessionMCPSection drill /> : null}
      {view === 'skills' ? <SessionSkillsSection agentId={conversation?.agent_id} drill /> : null}
      {view === 'automations' ? (
        <SessionAutomationsSection conversationId={conversation?.conversationId} />
      ) : null}
      {view === 'context' ? <ContextSourcesSection conversation={conversation} /> : null}
    </div>
  );
}
