import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { ChevronDown, Folder, Sparkles } from 'lucide-react';
import { isEphemeralAgentId } from 'librechat-data-provider';
import type { TAgentsMap, TConversation, TModelSpec } from 'librechat-data-provider';
import type {
  SessionOrchMode,
  SessionProfileChangedDetail,
  SessionProfileId,
  SessionProfileState,
} from '~/utils/sessionProfiles';
import type { TranslationKeys } from '~/hooks';
import { SESSION_PROFILE_CHANGED_EVENT, loadSessionProfile } from '~/utils/sessionProfiles';
import ModelSelector from '~/components/Chat/Menus/Endpoints/ModelSelector';
import { useGetStartupConfig, useProjectQuery } from '~/data-provider';
import { normalizeResponseFormat } from '~/utils/responseFormat';
import { useAgentsMapContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';
import store from '~/store';

const PROFILE_LABEL: Record<SessionProfileId, TranslationKeys> = {
  fast: 'com_ui_session_profile_fast',
  think: 'com_ui_session_profile_think',
  research: 'com_ui_session_profile_research',
  plan: 'com_ui_session_profile_plan',
  review: 'com_ui_session_profile_review',
  create: 'com_ui_session_profile_create',
  execute: 'com_ui_session_profile_execute',
  teach: 'com_ui_session_profile_teach',
  debug: 'com_ui_session_profile_debug',
};

const ORCH_LABEL: Record<SessionOrchMode, TranslationKeys> = {
  off: 'com_ui_session_orch_off',
  auto: 'com_ui_session_orch_auto',
  team: 'com_ui_session_orch_team',
  m2: 'com_ui_session_orch_m2',
  m3: 'com_ui_session_orch_m3',
  compare: 'com_ui_session_orch_compare',
};

const FORMAT_LABEL: Record<string, TranslationKeys> = {
  default: 'com_ui_response_format_default',
  concise: 'com_ui_response_format_concise',
  detailed: 'com_ui_response_format_detailed',
  json: 'com_ui_response_format_json',
};

type SessionSummaryPillProps = {
  conversation?: TConversation | null;
  index?: number;
  className?: string;
};

function resolveModelLabel(
  conversation: TConversation | null | undefined,
  modelSpecs: TModelSpec[] | undefined,
  fallback: string,
  agentsMap?: TAgentsMap,
): string {
  if (conversation?.spec) {
    const spec = modelSpecs?.find((candidate) => candidate.name === conversation.spec);
    if (spec?.label) {
      return spec.label;
    }
    if (spec?.name) {
      return spec.name;
    }
  }
  /**
   * Non-ephemeral agents clear `model` / `modelLabel` (agents use their configured
   * model internally). Resolve the display name from `agent_id` so the Session
   * pill does not fall through to "Select a model" after an agent pick.
   */
  const agentId = conversation?.agent_id;
  if (agentId && !isEphemeralAgentId(agentId)) {
    const agentName = agentsMap?.[agentId]?.name;
    if (agentName) {
      return agentName;
    }
  }
  if (conversation?.modelLabel) {
    return conversation.modelLabel;
  }
  if (conversation?.model) {
    return conversation.model;
  }
  return fallback;
}

/**
 * Dense v5.1 composer chrome: one SessionSummaryPill
 * `Model · [Project] · Profile · Orch · Format`. Project appears when
 * `conversation.chatProjectId` is bound (reload-safe via assign API).
 * Private is a composer icon beside TokenUsage.
 */
export default function SessionSummaryPill({
  conversation,
  index = 0,
  className,
}: SessionSummaryPillProps) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const agentsMap = useAgentsMapContext();
  const [sheetOpen, setSheetOpen] = useRecoilState(store.sessionSheetOpenByIndex(index));
  const uiKey = store.conversationUiStateKey(conversation?.conversationId, index);
  const responseFormat = useRecoilValue(store.responseFormatByIndex(uiKey));
  const chatProjectId = conversation?.chatProjectId ?? null;
  const { data: boundProject } = useProjectQuery(chatProjectId);
  const [profileState, setProfileState] = useState<SessionProfileState>(() =>
    loadSessionProfile(conversation?.conversationId),
  );

  useEffect(() => {
    setProfileState(loadSessionProfile(conversation?.conversationId));
  }, [conversation?.conversationId]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<SessionProfileChangedDetail | SessionProfileState>)
        .detail;
      if (detail && typeof detail === 'object' && 'state' in detail && 'conversationId' in detail) {
        setProfileState(loadSessionProfile(conversation?.conversationId));
        return;
      }
      setProfileState(loadSessionProfile(conversation?.conversationId));
    };
    window.addEventListener(SESSION_PROFILE_CHANGED_EVENT, onChanged as EventListener);
    return () => {
      window.removeEventListener(SESSION_PROFILE_CHANGED_EVENT, onChanged as EventListener);
    };
  }, [conversation?.conversationId]);

  const modelLabel = useMemo(
    () =>
      resolveModelLabel(
        conversation,
        startupConfig?.modelSpecs?.list as TModelSpec[] | undefined,
        localize('com_ui_select_model'),
        agentsMap,
      ),
    [agentsMap, conversation, localize, startupConfig?.modelSpecs?.list],
  );
  const profileLabel = localize(
    PROFILE_LABEL[profileState.profile] ?? 'com_ui_session_profile_fast',
  );
  const orchLabel = localize(ORCH_LABEL[profileState.orchMode] ?? 'com_ui_session_orch_off');
  const formatKey = normalizeResponseFormat(responseFormat);
  const formatLabel = localize(FORMAT_LABEL[formatKey] ?? 'com_ui_response_format_default');

  const openSheet = useCallback(() => {
    setSheetOpen(true);
  }, [setSheetOpen]);

  const sessionMenuEnabled = startupConfig?.interface?.sessionMenu !== false;

  if (!sessionMenuEnabled) {
    return (
      <div className={cn('flex max-w-full items-center gap-1.5 px-1', className)}>
        <div
          className="min-w-0 shrink [&_.relative]:w-auto [&_.relative]:max-w-none [&_.relative]:items-start [&_[data-testid=model-selector-button]]:my-0 [&_[data-testid=model-selector-button]]:h-7 [&_[data-testid=model-selector-button]]:w-auto [&_[data-testid=model-selector-button]]:max-w-[12rem] [&_[data-testid=model-selector-button]]:rounded-full [&_[data-testid=model-selector-button]]:px-2.5 [&_[data-testid=model-selector-button]]:py-0 [&_[data-testid=model-selector-button]]:text-[11px]"
          data-testid="session-model-chip"
        >
          <ModelSelector startupConfig={startupConfig} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex max-w-full items-center gap-1.5 px-0.5', className)}>
      <button
        type="button"
        data-testid="session-summary-pill"
        aria-label={localize('com_ui_session_menu')}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        onClick={openSheet}
        className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border-light bg-surface-secondary px-2.5 py-1 text-[11px] text-text-secondary"
      >
        <Sparkles className="size-3 shrink-0 text-text-primary" aria-hidden="true" />
        <span
          className="shrink-0 truncate font-semibold text-text-primary"
          data-testid="session-summary-model"
        >
          {modelLabel}
        </span>
        {boundProject?.name ? (
          <>
            <span className="shrink-0 opacity-60">·</span>
            <span
              className="inline-flex min-w-0 max-w-[7rem] shrink items-center gap-0.5 truncate text-text-primary"
              data-testid="session-summary-project"
              title={boundProject.name}
            >
              <Folder className="size-3 shrink-0 opacity-80" aria-hidden="true" />
              <span className="truncate">{boundProject.name}</span>
            </span>
          </>
        ) : null}
        <span className="shrink-0 opacity-60">·</span>
        <span className="shrink-0 truncate">{profileLabel}</span>
        <span className="shrink-0 opacity-60">·</span>
        <span className="shrink-0 truncate">{orchLabel}</span>
        <span className="hidden shrink-0 opacity-60 sm:inline">·</span>
        <span className="hidden shrink-0 truncate sm:inline">{formatLabel}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
      </button>
    </div>
  );
}
