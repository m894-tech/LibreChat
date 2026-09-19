import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PinIcon, Switch } from '@librechat/client';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { ChevronDown, ChevronRight, ScrollText, X } from 'lucide-react';
import { Constants, Permissions, PermissionTypes } from 'librechat-data-provider';
import type { TSkillSummary } from 'librechat-data-provider';
import { useLocalize, useHasAccess, useSkillActiveState } from '~/hooks';
import { useAgentsMapContext, useBadgeRowContext } from '~/Providers';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';
import { useSkillsInfiniteQuery } from '~/data-provider';
import { ephemeralAgentByConvoId } from '~/store';
import { isEphemeralAgent } from '~/common';
import { cn } from '~/utils';
import store from '~/store';

function skillLabel(skill: TSkillSummary): string {
  return skill.displayTitle || skill.name;
}

function isUserInvocable(skill: TSkillSummary): boolean {
  return skill.userInvocable !== false;
}

type SessionSkillsSectionProps = {
  agentId?: string | null;
  /** Inline drill inside Session sheet — list always open; Manage → full page only. */
  drill?: boolean;
  /** Composer index — closes the matching Session sheet on Manage. */
  index?: number;
};

export default function SessionSkillsSection({
  agentId,
  drill = false,
  index = 0,
}: SessionSkillsSectionProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { setSidebarOpen } = useSidebarToggle();
  const setSheetOpen = useSetRecoilState(store.sessionSheetOpenByIndex(index));
  const context = useBadgeRowContext();
  const agentsMap = useAgentsMapContext();
  const canUseSkills = useHasAccess({
    permissionType: PermissionTypes.SKILLS,
    permission: Permissions.USE,
  });
  const { skills } = context ?? {};
  const conversationId = context?.conversationId ?? Constants.NEW_CONVO;
  const { isPinned: isSkillsPinned, setIsPinned: setIsSkillsPinned, toggleState } = skills ?? {};
  const { isActive } = useSkillActiveState();
  const [search, setSearch] = useState('');
  const [isExpanded, setIsExpanded] = useState(drill);
  const setEphemeralAgent = useSetRecoilState(ephemeralAgentByConvoId(conversationId));
  const setPendingManualSkills = useSetRecoilState(
    store.pendingManualSkillsByConvoId(conversationId),
  );
  const pending = useRecoilValue(store.pendingManualSkillsByConvoId(conversationId));
  const showCatalog = drill || isExpanded;

  const handleSkillsToggle = useCallback(() => {
    skills?.debouncedChange({ value: !skills?.toggleState });
  }, [skills]);

  const goManage = useCallback(() => {
    setSheetOpen(false);
    setSidebarOpen(true);
    navigate('/skills');
  }, [navigate, setSidebarOpen, setSheetOpen]);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSkillsInfiniteQuery({ limit: 50 }, { enabled: canUseSkills === true });

  const paginationBlockedRef = useRef(false);
  useEffect(() => {
    if (isError) {
      paginationBlockedRef.current = true;
    }
  }, [isError]);
  useEffect(() => {
    if (paginationBlockedRef.current || isError) {
      return;
    }
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  const persistedAgent = agentId && !isEphemeralAgent(agentId) ? agentsMap?.[agentId] : undefined;
  const agentSkillsOff =
    Boolean(agentId) &&
    !isEphemeralAgent(agentId) &&
    persistedAgent != null &&
    persistedAgent.skills_enabled !== true;

  const catalog = useMemo(() => {
    const all: TSkillSummary[] = [];
    for (const page of data?.pages ?? []) {
      for (const skill of page.skills) {
        all.push(skill);
      }
    }
    const q = search.trim().toLowerCase();
    return all.filter((skill) => {
      if (!isUserInvocable(skill)) {
        return false;
      }
      if (!isActive(skill)) {
        return false;
      }
      if (!q) {
        return true;
      }
      const haystack =
        `${skillLabel(skill)} ${skill.name} ${skill.description ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [data?.pages, search, isActive]);

  const queueSkill = useCallback(
    (name: string) => {
      setEphemeralAgent((prev) => {
        if (prev?.skills) {
          return prev;
        }
        return { ...(prev || {}), skills: true };
      });
      if (!skills?.toggleState) {
        skills?.debouncedChange({ value: true });
      }
      setPendingManualSkills((prev) => (prev.includes(name) ? prev : [...prev, name]));
    },
    [setEphemeralAgent, setPendingManualSkills, skills],
  );

  const unqueueSkill = useCallback(
    (name: string) => {
      setPendingManualSkills((prev) => prev.filter((item) => item !== name));
    },
    [setPendingManualSkills],
  );

  if (!canUseSkills) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1" data-testid="session-menu-skills">
      {drill ? (
        <>
          <p className="px-0.5 pb-1 text-[10px] leading-snug text-text-secondary">
            {localize('com_ui_session_skills_drill_hint')}
          </p>
          <div
            data-testid="session-skills-toggle-row"
            className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm"
          >
            <span className="flex items-center gap-2">
              <ScrollText className="icon-md" aria-hidden="true" />
              <span>{localize('com_ui_skills')}</span>
              {toggleState ? (
                <span className="text-[10px] uppercase text-text-secondary">
                  {localize('com_ui_on')}
                </span>
              ) : null}
            </span>
            <Switch
              checked={Boolean(toggleState)}
              onCheckedChange={() => handleSkillsToggle()}
              aria-label={localize('com_ui_skills')}
              data-testid="session-skills-toggle"
            />
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          aria-expanded={isExpanded}
          className="flex items-center justify-between px-2 pb-0.5"
        >
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-secondary">
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            )}
            {localize('com_ui_skills')}
          </span>
          <span
            role="link"
            tabIndex={0}
            className="text-[11px] text-text-secondary hover:text-text-primary"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              goManage();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                goManage();
              }
            }}
          >
            {localize('com_ui_skills_manage')}
          </span>
        </button>
      )}
      {!drill ? (
        <div
          data-testid="tools-menu-skills"
          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
        >
          <button
            type="button"
            onClick={handleSkillsToggle}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <ScrollText className="icon-md" aria-hidden="true" />
            <span>{localize('com_ui_skills')}</span>
            {toggleState ? (
              <span className="text-[10px] uppercase text-text-secondary">
                {localize('com_ui_on')}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsSkillsPinned?.(!isSkillsPinned);
            }}
            className={cn(
              'rounded p-1 transition-all duration-200',
              'hover:bg-surface-secondary hover:shadow-sm',
              !isSkillsPinned && 'text-text-secondary hover:text-text-primary',
            )}
            aria-label={isSkillsPinned ? localize('com_ui_unpin') : localize('com_ui_pin')}
          >
            <div className="h-4 w-4">
              <PinIcon unpin={Boolean(isSkillsPinned)} />
            </div>
          </button>
          <Switch
            checked={Boolean(toggleState)}
            onCheckedChange={() => handleSkillsToggle()}
            aria-label={localize('com_ui_skills')}
            data-testid="session-skills-toggle"
          />
        </div>
      ) : null}
      {agentSkillsOff ? (
        <p className="px-2 text-[11px] text-text-secondary">
          {localize('com_ui_skills_disabled_hint')}
        </p>
      ) : null}
      {showCatalog ? (
        <>
          <div className="px-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={localize('com_ui_skills_command_placeholder')}
              aria-label={localize('com_ui_search')}
              className="w-full rounded-lg border border-border-light bg-surface-primary px-2 py-1 text-xs text-text-primary outline-none placeholder:text-text-secondary focus:border-border-heavy"
            />
          </div>
          {pending.length > 0 ? (
            <div
              className="flex flex-wrap gap-1 px-2"
              aria-label={localize('com_ui_skills_queued')}
            >
              {pending.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-full border border-border-light px-2 py-0.5 text-[11px]"
                >
                  {name}
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-surface-secondary"
                    aria-label={localize('com_ui_remove_skill_var', { 0: name })}
                    onClick={() => unqueueSkill(name)}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div
            className={cn(
              'overflow-y-auto px-1',
              drill
                ? 'max-h-[min(50vh,22rem)] rounded-xl border border-border-light bg-surface-secondary'
                : 'max-h-40',
            )}
            data-testid="session-skills-catalog"
          >
            {isLoading ? (
              <div className="px-2 py-1.5 text-xs text-text-secondary">
                {localize('com_ui_loading')}
              </div>
            ) : null}
            {!isLoading && isError ? (
              <div className="px-2 py-1.5 text-xs text-text-secondary">
                {localize('com_ui_skills_load_error')}
              </div>
            ) : null}
            {!isLoading && !isError && catalog.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-text-secondary">
                {localize('com_ui_skills_empty')}
              </div>
            ) : null}
            {!isLoading && !isError && catalog.length > 0
              ? catalog.map((skill) => {
                  const queued = pending.includes(skill.name);
                  return (
                    <div
                      key={skill._id}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 border-b border-border-light px-2.5 py-2 text-left text-xs last:border-b-0',
                        queued && 'bg-surface-hover',
                      )}
                    >
                      <button
                        type="button"
                        title={skill.description || skillLabel(skill)}
                        onClick={() => {
                          if (queued) {
                            unqueueSkill(skill.name);
                          } else {
                            queueSkill(skill.name);
                          }
                        }}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-text-primary"
                      >
                        <span className="min-w-0 truncate">{skillLabel(skill)}</span>
                        {queued ? (
                          <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-0.5 text-[10px] uppercase text-text-secondary">
                            {localize('com_ui_on')}
                          </span>
                        ) : null}
                      </button>
                      <Switch
                        checked={queued}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            queueSkill(skill.name);
                          } else {
                            unqueueSkill(skill.name);
                          }
                        }}
                        aria-label={skillLabel(skill)}
                      />
                    </div>
                  );
                })
              : null}
          </div>
          {drill ? (
            <button
              type="button"
              data-testid="session-skills-manage"
              onClick={goManage}
              className="mt-2 w-full rounded-[10px] border border-dashed border-border-medium px-2 py-2 text-center text-xs text-text-primary hover:border-border-heavy hover:bg-surface-hover"
            >
              {localize('com_ui_session_skills_manage_full')}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
