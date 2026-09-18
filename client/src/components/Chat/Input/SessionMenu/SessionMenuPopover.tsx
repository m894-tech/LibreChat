import React from 'react';
import type { TConversation } from 'librechat-data-provider';
import type { NativeModelControls } from '~/hooks/Input/useNativeModelControls';
import { SessionAutomationsSection } from '~/components/Automations';
import SessionNativeKnobsSection from './SessionNativeKnobsSection';
import ResponseFormatSection from './ResponseFormatSection';
import ContextSourcesSection from './ContextSourcesSection';
import SessionProfileSection from './SessionProfileSection';
import SessionSkillsSection from './SessionSkillsSection';
import SessionOrchSection from './SessionOrchSection';
import AgentPickerButton from './AgentPickerButton';
import SessionMCPSection from './SessionMCPSection';
import SessionModeList from './SessionModeList';
import ContextUsageRow from './ContextUsageRow';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SessionMenuPopoverProps = {
  conversation?: TConversation | null;
  index?: number;
  className?: string;
  isSubmitting?: boolean;
  /** When false, omit agent picker (no AGENTS.USE access). */
  showAgentPicker?: boolean;
  /** Shared with ToolsDropdown so Recoil nativeKnobs stay in sync. */
  modelControls?: NativeModelControls | null;
};

/**
 * Compact session menu. Modes/MCP/Skills reuse BadgeRowContext — no second mode state.
 * Order: modes → MCP → skills → agent → sources → format.
 */
export default function SessionMenuPopover({
  conversation,
  index = 0,
  className,
  isSubmitting = false,
  showAgentPicker = true,
  modelControls = null,
}: SessionMenuPopoverProps) {
  const localize = useLocalize();
  return (
    <div
      className={cn('flex w-full min-w-[280px] flex-col gap-2 p-1', className)}
      data-testid="session-menu-popover"
      aria-label={localize('com_ui_session_menu')}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <SessionProfileSection conversationId={conversation?.conversationId} />
      <SessionOrchSection conversation={conversation} />
      <SessionNativeKnobsSection conversation={conversation} controls={modelControls} />
      <SessionModeList />
      <SessionMCPSection />
      <SessionSkillsSection agentId={conversation?.agent_id} />
      <SessionAutomationsSection conversationId={conversation?.conversationId} />
      {showAgentPicker ? (
        <AgentPickerButton
          activeAgentId={conversation?.agent_id}
          conversationId={conversation?.conversationId}
          index={index}
        />
      ) : null}
      <ContextSourcesSection conversation={conversation} />
      <ResponseFormatSection conversation={conversation} index={index} />
      <ContextUsageRow index={index} conversation={conversation} isSubmitting={isSubmitting} />
    </div>
  );
}
