import React, { useMemo } from 'react';
import { useRecoilState } from 'recoil';
import type { TConversation } from 'librechat-data-provider';
import {
  useContextSourcesQuery,
  usePatchContextSourceMutation,
  useDeleteContextSourceMutation,
  useRefreshContextSourceMutation,
} from '~/data-provider/ContextSources/queries';
import { contextSourcesAtom, type ContextSource } from '~/store/contextSources';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type ContextSourcesSectionProps = React.HTMLAttributes<HTMLDivElement> & {
  conversation?: TConversation | null;
};

const ContextSourcesSection = React.forwardRef<HTMLDivElement, ContextSourcesSectionProps>(
  ({ conversation, className, ...props }, ref) => {
    const localize = useLocalize();
    const [localSources, setLocalSources] = useRecoilState(contextSourcesAtom);
    const conversationId = conversation?.conversationId;
    const { data, isError } = useContextSourcesQuery(conversationId);
    const patchMutation = usePatchContextSourceMutation();
    const deleteMutation = useDeleteContextSourceMutation();
    const refreshMutation = useRefreshContextSourceMutation();

    const serverSources: ContextSource[] = useMemo(() => {
      return (data?.sources || []).map((s) => ({
        id: s.id,
        type: s.type,
        title: s.title,
        status: s.status,
        conversationId: s.conversationId,
        fileCount: s.fileCount,
        totalBytes: s.totalBytes,
        metadata: s.metadata,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));
    }, [data]);

    const useServer = !isError && data != null;
    const sources = useServer ? serverSources : localSources;

    const updateSource = (id: string, patch: Partial<ContextSource>) => {
      if (useServer) {
        if (patch.status) {
          patchMutation.mutate({ id, patch: { status: patch.status } });
        }
        return;
      }
      setLocalSources((prev) =>
        prev.map((source) =>
          source.id === id ? { ...source, ...patch, updatedAt: Date.now() } : source,
        ),
      );
    };

    const removeSource = (id: string) => {
      if (useServer) {
        deleteMutation.mutate(id);
        return;
      }
      setLocalSources((prev) => prev.filter((source) => source.id !== id));
    };

    return (
      <div
        ref={ref}
        {...props}
        className={cn('flex w-full flex-col gap-1 rounded-lg p-2', className)}
        data-testid="context-sources-section"
      >
        <div className="text-xs text-text-secondary">{localize('com_ui_context_sources')}</div>
        {sources.length === 0 ? (
          <div className="text-sm text-text-secondary">
            {localize('com_ui_context_sources_empty')}
          </div>
        ) : (
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
            {sources.map((source) => {
              const disabled = source.status === 'disabled';
              return (
                <li
                  key={source.id}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm',
                    disabled ? 'opacity-60' : 'bg-surface-hover/40',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-text-primary" title={source.title}>
                      {source.title}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-text-secondary">
                      {source.type} · {source.status}
                      {source.fileCount != null ? ` · ${source.fileCount}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    {useServer && (source.type === 'github' || source.type === 'dropbox') ? (
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-surface-secondary hover:text-text-primary disabled:opacity-50"
                        disabled={refreshMutation.isLoading}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          refreshMutation.mutate(source.id);
                        }}
                      >
                        {localize('com_ui_context_source_refresh')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        updateSource(source.id, {
                          status: disabled ? 'ready' : 'disabled',
                        });
                      }}
                    >
                      {localize(
                        disabled ? 'com_ui_context_source_enable' : 'com_ui_context_source_disable',
                      )}
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removeSource(source.id);
                      }}
                    >
                      {localize('com_ui_context_source_remove')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  },
);

ContextSourcesSection.displayName = 'ContextSourcesSection';
export default ContextSourcesSection;
