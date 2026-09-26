import { useQuery } from '@tanstack/react-query';
import { Constants, QueryKeys } from 'librechat-data-provider';
import type { QueryObserverResult } from '@tanstack/react-query';
import type { TContextUsageSnapshot } from './api';
import { applyContextEvent } from '~/store/contextCounter';
import { getContextUsage } from './api';

export const contextUsageQueryKey = (conversationId: string, leafId: string) =>
  [QueryKeys.contextUsage, conversationId, leafId] as const;

export function isPersistedConversationId(conversationId: string | null | undefined): boolean {
  return (
    conversationId != null &&
    conversationId !== '' &&
    conversationId !== Constants.NEW_CONVO &&
    conversationId !== Constants.PENDING_CONVO
  );
}

/**
 * Server snapshot of `lastCall` / `sessionUsage` for one branch (stream C).
 * Hydrates the conversation stores on success; the local derivation from
 * message metadata already covers reload, so a missing endpoint (404 while
 * stream C is not deployed) is a silent no-op rather than an error state.
 */
export function useContextUsageQuery(
  conversationId: string,
  leafId: string,
  enabled: boolean,
): QueryObserverResult<TContextUsageSnapshot> {
  return useQuery<TContextUsageSnapshot>(
    contextUsageQueryKey(conversationId, leafId),
    () => getContextUsage(conversationId, leafId),
    {
      enabled: enabled && isPersistedConversationId(conversationId) && leafId !== '',
      staleTime: 30_000,
      retry: false,
      refetchOnWindowFocus: false,
      onSuccess: (snapshot) => {
        applyContextEvent(conversationId, {
          type: 'hydrate',
          leafId,
          lastCall: snapshot.lastCall,
          sessionUsage: snapshot.sessionUsage,
          estimate: snapshot.estimate ?? null,
        });
      },
    },
  );
}
