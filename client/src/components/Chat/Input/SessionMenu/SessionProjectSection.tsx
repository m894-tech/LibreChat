import React, { useCallback, useMemo } from 'react';
import { Check, Folder } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { Constants } from 'librechat-data-provider';
import { Spinner, useToastContext } from '@librechat/client';
import type { TConversation, TChatProject } from 'librechat-data-provider';
import {
  useAssignConversationToProjectMutation,
  useProjectsInfiniteQuery,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SessionProjectSectionProps = {
  conversation?: TConversation | null;
};

/**
 * Session «Ещё» → project picker. Same assign API as ConvoOptions / Projects tab —
 * not a rename of ContextSources.
 */
export default function SessionProjectSection({ conversation }: SessionProjectSectionProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { setConversation } = useChatContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const conversationId = conversation?.conversationId ?? '';
  const isNewConvo =
    !conversationId || conversationId === Constants.NEW_CONVO || conversationId === 'new';
  const selectedProjectId = conversation?.chatProjectId ?? null;

  const assignConversation = useAssignConversationToProjectMutation();
  const { data, fetchNextPage, isFetchingNextPage, isLoading, isError } = useProjectsInfiniteQuery({
    sortBy: 'name',
    sortDirection: 'asc',
    limit: 100,
  });

  const projects = useMemo<TChatProject[]>(
    () => data?.pages.flatMap((page) => page.projects) ?? [],
    [data?.pages],
  );
  const hasNextPage = data?.pages[data.pages.length - 1]?.nextCursor != null;

  const applyDraftProject = useCallback(
    (projectId: string | null) => {
      if (conversation && setConversation) {
        setConversation({ ...conversation, chatProjectId: projectId });
      }
      const nextParams = new URLSearchParams(searchParams);
      if (projectId) {
        nextParams.set('projectId', projectId);
      } else {
        nextParams.delete('projectId');
      }
      setSearchParams(nextParams, { replace: true, flushSync: true });
    },
    [conversation, setConversation, searchParams, setSearchParams],
  );

  const selectProject = useCallback(
    (projectId: string | null) => {
      /** Clicking the active project again clears the binding. */
      const nextProjectId = projectId === selectedProjectId ? null : projectId;
      if (nextProjectId === selectedProjectId) {
        return;
      }
      if (isNewConvo) {
        applyDraftProject(nextProjectId);
        return;
      }
      assignConversation.mutate(
        { conversationId, projectId: nextProjectId },
        {
          onSuccess: () => {
            showToast({
              message: localize('com_ui_project_updated'),
              severity: NotificationSeverity.SUCCESS,
              showIcon: true,
            });
          },
          onError: () => {
            showToast({
              message: localize('com_ui_project_update_error'),
              severity: NotificationSeverity.ERROR,
              showIcon: true,
            });
          },
        },
      );
    },
    [
      applyDraftProject,
      assignConversation,
      conversationId,
      isNewConvo,
      localize,
      selectedProjectId,
      showToast,
    ],
  );

  return (
    <div className="flex flex-col gap-1" data-testid="session-menu-project">
      <p className="px-0.5 pb-1 text-[10px] leading-snug text-text-secondary">
        {localize('com_ui_select_project')}
      </p>
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Spinner className="size-5" />
        </div>
      ) : null}
      {isError ? (
        <p className="px-2 py-2 text-xs text-text-secondary">{localize('com_ui_error')}</p>
      ) : null}
      {!isLoading && !isError && projects.length === 0 ? (
        <p className="px-2 py-2 text-xs text-text-secondary" data-testid="session-project-empty">
          {localize('com_ui_no_projects')}
        </p>
      ) : null}
      <div
        role="radiogroup"
        aria-label={localize('com_ui_select_project')}
        className="flex max-h-[min(320px,50vh)] flex-col gap-0.5 overflow-y-auto"
        data-testid="session-project-list"
      >
        <button
          type="button"
          role="radio"
          aria-checked={selectedProjectId == null}
          onClick={() => selectProject(null)}
          disabled={assignConversation.isLoading}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm',
            'hover:bg-surface-hover',
            selectedProjectId == null && 'bg-surface-active-alt',
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-text-secondary">
            <Folder className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 truncate text-text-primary">
            {localize('com_ui_schedule_project_none')}
          </span>
          {selectedProjectId == null ? (
            <Check className="size-4 shrink-0 text-text-primary" aria-hidden="true" />
          ) : null}
        </button>
        {projects.map((project) => {
          const selected = selectedProjectId === project._id;
          return (
            <button
              type="button"
              key={project._id}
              role="radio"
              aria-checked={selected}
              onClick={() => selectProject(project._id)}
              disabled={assignConversation.isLoading}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm',
                'hover:bg-surface-hover',
                selected && 'bg-surface-active-alt',
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-text-secondary">
                <Folder className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 truncate text-text-primary">{project.name}</span>
              {selected ? (
                <Check className="size-4 shrink-0 text-text-primary" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
      {hasNextPage ? (
        <button
          type="button"
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="px-2 py-1.5 text-left text-xs text-text-secondary hover:text-text-primary"
        >
          {isFetchingNextPage ? localize('com_ui_loading') : localize('com_ui_load_more')}
        </button>
      ) : null}
    </div>
  );
}
