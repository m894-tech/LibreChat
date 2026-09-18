import { request } from 'librechat-data-provider';

export type ServerContextSource = {
  id: string;
  type: 'file' | 'folder' | 'github' | 'sharepoint' | 'dropbox';
  title: string;
  status: 'processing' | 'ready' | 'failed' | 'disabled';
  conversationId?: string | null;
  fileCount?: number;
  totalBytes?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type GithubStatus = {
  connected: boolean;
  authMode: string | null;
  login: string | null;
  oauthConfigured: boolean;
  scopesHint?: string[];
};

export async function fetchContextSources(conversationId?: string | null) {
  const qs = conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : '';
  return request.get(`/api/context-sources${qs}`) as Promise<{ sources: ServerContextSource[] }>;
}

export async function patchContextSource(id: string, patch: { status?: string; title?: string }) {
  return request.patch(`/api/context-sources/${id}`, patch) as Promise<ServerContextSource>;
}

export async function deleteContextSource(id: string) {
  return request.delete(`/api/context-sources/${id}`) as Promise<{ deleted: boolean; id: string }>;
}

export async function importGithubRepo(body: {
  owner: string;
  repo: string;
  ref?: string;
  paths?: string[];
  pathPrefix?: string;
  conversationId?: string | null;
  agentId?: string | null;
}) {
  return request.post(`/api/context-sources/github/import`, body) as Promise<ServerContextSource>;
}

export async function fetchGithubStatus() {
  return request.get(`/api/integrations/github/status`) as Promise<GithubStatus>;
}

export async function connectGithubPat(token: string) {
  return request.post(`/api/integrations/github/connect`, { token }) as Promise<GithubStatus>;
}

export async function disconnectGithub() {
  return request.delete(`/api/integrations/github/connect`) as Promise<GithubStatus>;
}

export async function fetchGithubRepos(params?: { q?: string; page?: number }) {
  const sp = new URLSearchParams();
  if (params?.q) sp.set('q', params.q);
  if (params?.page) sp.set('page', String(params.page));
  const qs = sp.toString();
  return request.get(`/api/integrations/github/repos${qs ? `?${qs}` : ''}`) as Promise<{
    items: Array<{
      id: number;
      full_name: string;
      private: boolean;
      default_branch: string;
      description?: string;
    }>;
    total: number;
  }>;
}

export async function fetchGithubRefs(owner: string, repo: string) {
  return request.get(`/api/integrations/github/repos/${owner}/${repo}/refs`) as Promise<{
    refs: Array<{ name: string; sha?: string; type: string }>;
  }>;
}

export async function createContextSource(body: {
  type: ServerContextSource['type'];
  title: string;
  status?: ServerContextSource['status'];
  conversationId?: string | null;
  fileCount?: number;
  totalBytes?: number;
  metadata?: Record<string, unknown>;
}) {
  return request.post(`/api/context-sources`, body) as Promise<ServerContextSource>;
}

export async function startGithubOAuth() {
  return request.get(`/api/integrations/github/oauth/start`) as Promise<{ url: string }>;
}

export async function refreshContextSource(id: string) {
  return request.post(`/api/context-sources/${id}/refresh`, {}) as Promise<ServerContextSource>;
}

export type DropboxStatus = {
  connected: boolean;
  authMode: string | null;
  accountId?: string | null;
  oauthConfigured: boolean;
};

export async function fetchDropboxStatus() {
  return request.get(`/api/integrations/dropbox/status`) as Promise<DropboxStatus>;
}

export async function startDropboxOAuth() {
  return request.get(`/api/integrations/dropbox/oauth/start`) as Promise<{ url: string }>;
}

export async function disconnectDropbox() {
  return request.delete(`/api/integrations/dropbox/connect`) as Promise<{ connected: boolean }>;
}

export async function fetchDropboxList(params?: { path?: string; cursor?: string }) {
  const sp = new URLSearchParams();
  if (params?.path) sp.set('path', params.path);
  if (params?.cursor) sp.set('cursor', params.cursor);
  const qs = sp.toString();
  return request.get(`/api/integrations/dropbox/list${qs ? `?${qs}` : ''}`) as Promise<{
    entries?: Array<{
      '.tag'?: string;
      name?: string;
      path_display?: string;
      path_lower?: string;
      size?: number;
    }>;
    cursor?: string;
    has_more?: boolean;
  }>;
}

export async function attachDropboxPointer(body: { path: string; conversationId?: string | null }) {
  return request.post(`/api/context-sources/dropbox/pointer`, body) as Promise<ServerContextSource>;
}
