import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryObserverResult } from '@tanstack/react-query';
import * as api from './api';

export const contextSourceKeys = {
  all: ['contextSources'] as const,
  list: (conversationId?: string | null) =>
    [...contextSourceKeys.all, 'list', conversationId ?? 'all'] as const,
  githubStatus: ['githubIntegration', 'status'] as const,
  dropboxStatus: ['dropboxIntegration', 'status'] as const,
};

export const useContextSourcesQuery = (
  conversationId?: string | null,
  enabled = true,
): QueryObserverResult<{ sources: api.ServerContextSource[] }> => {
  return useQuery(
    contextSourceKeys.list(conversationId),
    () => api.fetchContextSources(conversationId),
    {
      enabled,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  );
};

export const useGithubStatusQuery = (options?: {
  enabled?: boolean;
}): QueryObserverResult<api.GithubStatus> => {
  return useQuery(contextSourceKeys.githubStatus, () => api.fetchGithubStatus(), {
    enabled: options?.enabled ?? true,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
};

export const usePatchContextSourceMutation = () => {
  const qc = useQueryClient();
  return useMutation(
    ({ id, patch }: { id: string; patch: { status?: string; title?: string } }) =>
      api.patchContextSource(id, patch),
    {
      onSuccess: () => {
        qc.invalidateQueries(contextSourceKeys.all);
      },
    },
  );
};

export const useDeleteContextSourceMutation = () => {
  const qc = useQueryClient();
  return useMutation((id: string) => api.deleteContextSource(id), {
    onSuccess: () => {
      qc.invalidateQueries(contextSourceKeys.all);
    },
  });
};

export const useImportGithubMutation = () => {
  const qc = useQueryClient();
  return useMutation(api.importGithubRepo, {
    onSuccess: () => {
      qc.invalidateQueries(contextSourceKeys.all);
    },
  });
};

export const useRefreshContextSourceMutation = () => {
  const qc = useQueryClient();
  return useMutation((id: string) => api.refreshContextSource(id), {
    onSuccess: () => {
      qc.invalidateQueries(contextSourceKeys.all);
    },
  });
};

export const useConnectGithubMutation = () => {
  const qc = useQueryClient();
  return useMutation((token: string) => api.connectGithubPat(token), {
    onSuccess: () => {
      qc.invalidateQueries(contextSourceKeys.githubStatus);
    },
  });
};

export const useDisconnectGithubMutation = () => {
  const qc = useQueryClient();
  return useMutation(() => api.disconnectGithub(), {
    onSuccess: () => {
      qc.invalidateQueries(contextSourceKeys.githubStatus);
    },
  });
};

export const useDropboxStatusQuery = (options?: {
  enabled?: boolean;
}): QueryObserverResult<api.DropboxStatus> => {
  return useQuery(contextSourceKeys.dropboxStatus, () => api.fetchDropboxStatus(), {
    enabled: options?.enabled ?? true,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
};

export const useDisconnectDropboxMutation = () => {
  const qc = useQueryClient();
  return useMutation(() => api.disconnectDropbox(), {
    onSuccess: () => {
      qc.invalidateQueries(contextSourceKeys.dropboxStatus);
    },
  });
};

export const useAttachDropboxPointerMutation = () => {
  const qc = useQueryClient();
  return useMutation(api.attachDropboxPointer, {
    onSuccess: () => {
      qc.invalidateQueries(contextSourceKeys.all);
    },
  });
};
