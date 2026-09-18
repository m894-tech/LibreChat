import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TConversation, TModelSpec } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import {
  SESSION_PROFILE_CHANGED_EVENT,
  ensureSessionProfile,
  loadSessionProfile,
  normalizeSessionProfileConversationId,
  saveSessionProfile,
  type SessionOrchMode,
  type SessionProfileChangedDetail,
  type SessionProfileState,
} from '~/utils/sessionProfiles';
import {
  M894_AUTO_ESCAPE_SPEC,
  M894_AUTO_SPEC_NAME,
  M894_TEAM_PARENT_ID,
  isM894OrchAgentId,
  readNonTeamConversation,
  rememberNonTeamConversation,
} from '~/utils/sessionOrch';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import { useLocalize, useGetConversation, useNewConvo } from '~/hooks';
import useSelectMention from '~/hooks/Input/useSelectMention';
import SessionOrchProgress from './SessionOrchProgress';
import { useSelectAgent } from '~/hooks/Agents';
import ChipScroller from './ChipScroller';
import { cn } from '~/utils';
import store from '~/store';

function Chip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-xs',
        active
          ? 'border-[#2CE0CE] bg-[#2CE0CE]/15 text-zinc-100'
          : 'border-zinc-600 text-zinc-200 hover:border-zinc-400 hover:text-zinc-50',
      )}
    >
      {children}
    </button>
  );
}

const ORCH_KEYS: Array<{ id: SessionOrchMode; labelKey: TranslationKeys }> = [
  { id: 'off', labelKey: 'com_ui_session_orch_off' },
  { id: 'auto', labelKey: 'com_ui_session_orch_auto' },
  { id: 'team', labelKey: 'com_ui_session_orch_team' },
  { id: 'm2', labelKey: 'com_ui_session_orch_m2' },
  { id: 'm3', labelKey: 'com_ui_session_orch_m3' },
  { id: 'compare', labelKey: 'com_ui_session_orch_compare' },
];

type SessionOrchSectionProps = {
  conversation?: TConversation | null;
  /** Dense sheet: horizontal ChipScroller, no section title / long hint. */
  compact?: boolean;
};

export default function SessionOrchSection({
  conversation,
  compact = false,
}: SessionOrchSectionProps) {
  const localize = useLocalize();
  const convoKey = normalizeSessionProfileConversationId(conversation?.conversationId);
  const [state, setState] = useState<SessionProfileState>(() => loadSessionProfile(convoKey));
  const { onClear } = useSelectAgent();
  const { setConversation } = store.useSetConversationAtom(0);
  const getConversation = useGetConversation(0);
  const { newConversation } = useNewConvo();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig = {} } = useGetEndpointsQuery();
  const modelSpecs = useMemo(
    () => (startupConfig?.modelSpecs?.list ?? []) as TModelSpec[],
    [startupConfig?.modelSpecs?.list],
  );
  const { onSelectSpec } = useSelectMention({
    modelSpecs,
    endpointsConfig,
    getConversation,
    newConversation,
    returnHandlers: true,
  });

  useEffect(() => {
    setState(ensureSessionProfile(convoKey));
  }, [convoKey]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<SessionProfileChangedDetail | SessionProfileState>)
        .detail;
      if (!detail) {
        setState(loadSessionProfile(convoKey));
        return;
      }
      if (
        typeof detail === 'object' &&
        detail !== null &&
        'state' in detail &&
        'conversationId' in detail
      ) {
        const typed = detail as SessionProfileChangedDetail;
        if (normalizeSessionProfileConversationId(typed.conversationId) !== convoKey) {
          return;
        }
        setState(typed.state);
      }
    };
    window.addEventListener(SESSION_PROFILE_CHANGED_EVENT, onChanged as EventListener);
    return () => {
      window.removeEventListener(SESSION_PROFILE_CHANGED_EVENT, onChanged as EventListener);
    };
  }, [convoKey]);

  const hintKey = useMemo((): TranslationKeys => {
    if (state.orchMode === 'auto') {
      return 'com_ui_session_orch_auto_hint';
    }
    if (state.orchMode === 'team') {
      return 'com_ui_session_orch_team_hint';
    }
    if (state.orchMode === 'm2') {
      return 'com_ui_session_orch_m2_hint';
    }
    if (state.orchMode === 'm3') {
      return 'com_ui_session_orch_m3_hint';
    }
    if (state.orchMode === 'compare') {
      return 'com_ui_session_orch_compare_hint';
    }
    return 'com_ui_session_orch_off_hint';
  }, [state.orchMode]);

  const setOrch = useCallback(
    async (orchMode: SessionOrchMode) => {
      if (orchMode === 'team') {
        rememberNonTeamConversation(conversation);
        const current = conversation ?? (await getConversation());
        const alreadyOrch = isM894OrchAgentId(current?.agent_id);
        setState(
          saveSessionProfile(
            {
              orchMode,
              ...(alreadyOrch
                ? {}
                : {
                    orchParentModel: current?.model || current?.spec || undefined,
                    orchParentSpec: current?.spec || undefined,
                    orchParentEndpoint: current?.endpoint || undefined,
                  }),
            },
            convoKey,
          ),
        );
        if (current) {
          setConversation({
            ...current,
            endpoint: EModelEndpoint.agents,
            agent_id: M894_TEAM_PARENT_ID,
          });
        }
        return;
      }
      setState(saveSessionProfile({ orchMode }, convoKey));
      if (orchMode === 'auto') {
        if (
          String(conversation?.endpoint ?? '') === 'Relay-Orchestrator' ||
          conversation?.spec === M894_AUTO_SPEC_NAME
        ) {
          const escape = modelSpecs.find((item) => item.name === M894_AUTO_ESCAPE_SPEC);
          if (escape) onSelectSpec?.(escape);
        }
        return;
      }
      if (isM894OrchAgentId(conversation?.agent_id)) {
        const prev = readNonTeamConversation();
        const specName = prev?.spec || M894_AUTO_ESCAPE_SPEC;
        const spec =
          modelSpecs.find((item) => item.name === specName) ||
          modelSpecs.find((item) => item.name === M894_AUTO_ESCAPE_SPEC);
        if (spec) {
          onSelectSpec?.(spec);
          return;
        }
        await onClear();
      }
    },
    [convoKey, conversation, getConversation, modelSpecs, onClear, onSelectSpec, setConversation],
  );

  return (
    <div
      className={cn('flex flex-col gap-1', compact && 'gap-1.5')}
      data-testid="session-menu-orch"
    >
      {compact ? null : (
        <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-zinc-100">
          {localize('com_ui_session_orch')}
        </div>
      )}
      {compact ? (
        <ChipScroller aria-label={localize('com_ui_session_orch')}>
          {ORCH_KEYS.map((item) => (
            <Chip
              key={item.id}
              active={state.orchMode === item.id}
              testId={`session-orch-${item.id}`}
              onClick={() => {
                void setOrch(item.id);
              }}
            >
              {localize(item.labelKey)}
            </Chip>
          ))}
        </ChipScroller>
      ) : (
        <div className="flex flex-wrap gap-1 px-2">
          {ORCH_KEYS.map((item) => (
            <Chip
              key={item.id}
              active={state.orchMode === item.id}
              testId={`session-orch-${item.id}`}
              onClick={() => {
                void setOrch(item.id);
              }}
            >
              {localize(item.labelKey)}
            </Chip>
          ))}
        </div>
      )}
      {compact ? null : <p className="px-2 text-[11px] text-zinc-300">{localize(hintKey)}</p>}
      {state.orchMode === 'm3' && compact ? (
        <ChipScroller>
          <Chip
            active={state.orchParallel === true}
            testId="session-orch-parallel"
            onClick={() => {
              setState(saveSessionProfile({ orchParallel: !state.orchParallel }, convoKey));
            }}
          >
            {localize('com_ui_session_orch_parallel')}
          </Chip>
        </ChipScroller>
      ) : null}
      {state.orchMode === 'm3' && !compact ? (
        <div className="px-2">
          <Chip
            active={state.orchParallel === true}
            testId="session-orch-parallel"
            onClick={() => {
              setState(saveSessionProfile({ orchParallel: !state.orchParallel }, convoKey));
            }}
          >
            {localize('com_ui_session_orch_parallel')}
          </Chip>
        </div>
      ) : null}
      {state.orchMode === 'compare' ? (
        <label className="px-2 pt-1 text-[10px] text-zinc-400">
          {localize('com_ui_session_orch_compare_brief')}
          <input
            data-testid="session-orch-compare-brief"
            className="mt-0.5 w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-100 [color-scheme:dark]"
            value={(state.orchCompare && state.orchCompare.brief) || ''}
            placeholder="brief"
            onChange={(e) => {
              setState(
                saveSessionProfile(
                  {
                    orchCompare: {
                      ...(state.orchCompare || {}),
                      brief: e.target.value,
                    },
                  },
                  convoKey,
                ),
              );
            }}
          />
        </label>
      ) : null}
      {compact ? null : (
        <SessionOrchProgress orchMode={state.orchMode} orchParallel={state.orchParallel} />
      )}
    </div>
  );
}
