import React, { useCallback, useEffect, useState } from 'react';
import type { TranslationKeys } from '~/hooks';
import {
  SESSION_PROFILE_CHANGED_EVENT,
  loadSessionProfile,
  normalizeSessionProfileConversationId,
  saveSessionProfile,
  type CreateContractId,
  type ExecutePolicy,
  type SessionProfileChangedDetail,
  type SessionProfileId,
  type SessionProfileState,
} from '~/utils/sessionProfiles';
import ChipScroller from './ChipScroller';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const PROFILE_KEYS: Array<{ id: SessionProfileId; labelKey: TranslationKeys }> = [
  { id: 'fast', labelKey: 'com_ui_session_profile_fast' },
  { id: 'think', labelKey: 'com_ui_session_profile_think' },
  { id: 'research', labelKey: 'com_ui_session_profile_research' },
  { id: 'plan', labelKey: 'com_ui_session_profile_plan' },
  { id: 'review', labelKey: 'com_ui_session_profile_review' },
  { id: 'create', labelKey: 'com_ui_session_profile_create' },
  { id: 'execute', labelKey: 'com_ui_session_profile_execute' },
  { id: 'teach', labelKey: 'com_ui_session_profile_teach' },
  { id: 'debug', labelKey: 'com_ui_session_profile_debug' },
];

const CONTRACT_KEYS: Array<{ id: CreateContractId; labelKey: TranslationKeys }> = [
  { id: 'site', labelKey: 'com_ui_create_contract_site' },
  { id: 'slides', labelKey: 'com_ui_create_contract_slides' },
  { id: 'pdf', labelKey: 'com_ui_create_contract_pdf' },
  { id: 'table', labelKey: 'com_ui_create_contract_table' },
  { id: 'email', labelKey: 'com_ui_create_contract_email' },
  { id: 'memo', labelKey: 'com_ui_create_contract_memo' },
  { id: 'diagram', labelKey: 'com_ui_create_contract_diagram' },
];

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
          ? 'border-border-heavy bg-surface-hover text-text-primary'
          : 'border-border-light text-text-secondary hover:border-border-heavy hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}

type SessionProfileSectionProps = {
  conversationId?: string | null;
  /** Dense sheet: horizontal ChipScroller, no section title. */
  compact?: boolean;
};

export default function SessionProfileSection({
  conversationId,
  compact = false,
}: SessionProfileSectionProps) {
  const localize = useLocalize();
  const convoKey = normalizeSessionProfileConversationId(conversationId);
  const [state, setState] = useState<SessionProfileState>(() => loadSessionProfile(convoKey));

  // Reload when switching chats
  useEffect(() => {
    setState(loadSessionProfile(convoKey));
  }, [convoKey]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<SessionProfileChangedDetail | SessionProfileState>)
        .detail;
      if (!detail) {
        setState(loadSessionProfile(convoKey));
        return;
      }
      // New shape: { conversationId, state }; legacy shape: SessionProfileState itself
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
        return;
      }
      // Ignore unscoped legacy events — must not bleed across chats
    };
    window.addEventListener(SESSION_PROFILE_CHANGED_EVENT, onChanged as EventListener);
    return () => {
      window.removeEventListener(SESSION_PROFILE_CHANGED_EVENT, onChanged as EventListener);
    };
  }, [convoKey]);

  const setProfile = useCallback(
    (profile: SessionProfileId) => {
      setState(saveSessionProfile({ profile }, convoKey));
    },
    [convoKey],
  );
  const setContract = useCallback(
    (createContract: CreateContractId) => {
      setState(saveSessionProfile({ profile: 'create', createContract }, convoKey));
    },
    [convoKey],
  );
  const setPolicy = useCallback(
    (executePolicy: ExecutePolicy) => {
      setState(saveSessionProfile({ profile: 'execute', executePolicy }, convoKey));
    },
    [convoKey],
  );

  return (
    <div
      className={cn('flex flex-col gap-1', compact && 'gap-1.5')}
      data-testid="session-menu-profiles"
    >
      {compact ? null : (
        <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
          {localize('com_ui_session_profiles')}
        </div>
      )}
      {compact ? (
        <ChipScroller aria-label={localize('com_ui_session_profiles')}>
          {PROFILE_KEYS.map((item) => (
            <Chip
              key={item.id}
              active={state.profile === item.id}
              testId={`session-profile-${item.id}`}
              onClick={() => setProfile(item.id)}
            >
              {localize(item.labelKey)}
            </Chip>
          ))}
        </ChipScroller>
      ) : (
        <div className="flex flex-wrap gap-1 px-2">
          {PROFILE_KEYS.map((item) => (
            <Chip
              key={item.id}
              active={state.profile === item.id}
              testId={`session-profile-${item.id}`}
              onClick={() => setProfile(item.id)}
            >
              {localize(item.labelKey)}
            </Chip>
          ))}
        </div>
      )}
      {state.profile === 'create' ? (
        <>
          {compact ? (
            <ChipScroller>
              {CONTRACT_KEYS.map((item) => (
                <Chip
                  key={item.id}
                  active={state.createContract === item.id}
                  testId={`create-contract-${item.id}`}
                  onClick={() => setContract(item.id)}
                >
                  {localize(item.labelKey)}
                </Chip>
              ))}
            </ChipScroller>
          ) : (
            <div className="flex flex-wrap gap-1 px-2 pt-1">
              {CONTRACT_KEYS.map((item) => (
                <Chip
                  key={item.id}
                  active={state.createContract === item.id}
                  testId={`create-contract-${item.id}`}
                  onClick={() => setContract(item.id)}
                >
                  {localize(item.labelKey)}
                </Chip>
              ))}
            </div>
          )}
          {compact ? null : (
            <p className="px-2 text-[11px] text-text-secondary">
              {localize('com_ui_create_contract_hint')}
            </p>
          )}
        </>
      ) : null}
      {state.profile === 'plan' && !compact ? (
        <p className="px-2 text-[11px] text-text-secondary">
          {localize('com_ui_session_profile_plan_hint')}
        </p>
      ) : null}
      {state.profile === 'execute' ? (
        <>
          {compact ? (
            <ChipScroller>
              <Chip
                active={state.executePolicy === 'ask'}
                testId="execute-policy-ask"
                onClick={() => setPolicy('ask')}
              >
                {localize('com_ui_execute_policy_ask')}
              </Chip>
              <Chip
                active={state.executePolicy === 'autorun'}
                testId="execute-policy-autorun"
                onClick={() => setPolicy('autorun')}
              >
                {localize('com_ui_execute_policy_autorun')}
              </Chip>
            </ChipScroller>
          ) : (
            <div className="flex flex-wrap gap-1 px-2 pt-1">
              <Chip
                active={state.executePolicy === 'ask'}
                testId="execute-policy-ask"
                onClick={() => setPolicy('ask')}
              >
                {localize('com_ui_execute_policy_ask')}
              </Chip>
              <Chip
                active={state.executePolicy === 'autorun'}
                testId="execute-policy-autorun"
                onClick={() => setPolicy('autorun')}
              >
                {localize('com_ui_execute_policy_autorun')}
              </Chip>
            </div>
          )}
          {compact ? null : (
            <p className="px-2 text-[11px] text-text-secondary">
              {state.executePolicy === 'autorun'
                ? localize('com_ui_execute_autorun_blocked')
                : localize('com_ui_execute_policy_hint')}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
