import { useCallback, useEffect, useState } from 'react';
import { Button, Input, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import {
  fetchGithubRepos,
  fetchGithubStatus,
  importGithubRepo,
  startGithubOAuth,
  connectGithubPat,
} from '~/data-provider/ContextSources/api';
import { useLocalize } from '~/hooks';

type GitHubImportDialogProps = {
  open: boolean;
  conversationId?: string | null;
  agentId?: string | null;
  onOpenChange: (open: boolean) => void;
  onImported?: () => void;
};

type RepoItem = {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  description?: string;
};

export default function GitHubImportDialog({
  open,
  conversationId,
  agentId,
  onOpenChange,
  onImported,
}: GitHubImportDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [repos, setRepos] = useState<RepoItem[]>([]);
  const [query, setQuery] = useState('');
  const [pat, setPat] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const status = await fetchGithubStatus();
      setConnected(status.connected === true);
      if (status.connected) {
        const listed = await fetchGithubRepos({ q: query || undefined });
        setRepos(listed.items ?? []);
      } else {
        setRepos([]);
      }
    } catch {
      setConnected(false);
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void refreshStatus();
  }, [open, refreshStatus]);

  const handleOAuth = async () => {
    try {
      const { url } = await startGithubOAuth();
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      showToast({ message: localize('com_ui_upload_github_error'), status: 'error' });
    }
  };

  const handlePatConnect = async () => {
    if (!pat.trim()) {
      return;
    }
    setLoading(true);
    try {
      await connectGithubPat(pat.trim());
      setPat('');
      await refreshStatus();
    } catch {
      showToast({ message: localize('com_ui_upload_github_error'), status: 'error' });
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selected) {
      return;
    }
    const [owner, repo] = selected.split('/');
    if (!owner || !repo) {
      return;
    }
    setImporting(true);
    try {
      await importGithubRepo({
        owner,
        repo,
        conversationId,
        agentId,
      });
      showToast({ message: localize('com_ui_upload_github_success'), status: 'success' });
      onImported?.();
      onOpenChange(false);
    } catch {
      showToast({ message: localize('com_ui_upload_github_error'), status: 'error' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_upload_github')}
        className="w-11/12 max-w-lg"
        main={
          <div className="flex flex-col gap-3" data-testid="github-import-dialog">
            {!connected ? (
              <>
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_upload_github_connect_hint')}
                </p>
                <Button type="button" variant="outline" onClick={handleOAuth} disabled={loading}>
                  {localize('com_ui_upload_github_oauth')}
                </Button>
                <div className="flex gap-2">
                  <Input
                    value={pat}
                    onChange={(e) => setPat(e.target.value)}
                    placeholder={localize('com_ui_upload_github_pat_placeholder')}
                    aria-label={localize('com_ui_upload_github_pat_placeholder')}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePatConnect}
                    disabled={loading || !pat.trim()}
                  >
                    {localize('com_nav_mcp_connect')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void refreshStatus();
                    }
                  }}
                  placeholder={localize('com_ui_upload_github_search')}
                  aria-label={localize('com_ui_upload_github_search')}
                />
                <ul className="max-h-56 overflow-y-auto rounded-md border border-border-light">
                  {repos.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-text-secondary">
                      {loading
                        ? localize('com_ui_loading')
                        : localize('com_ui_upload_github_empty')}
                    </li>
                  ) : (
                    repos.map((repo) => (
                      <li key={repo.id}>
                        <button
                          type="button"
                          className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-surface-hover ${
                            selected === repo.full_name ? 'bg-surface-hover' : ''
                          }`}
                          onClick={() => setSelected(repo.full_name)}
                        >
                          <span className="font-medium text-text-primary">{repo.full_name}</span>
                          {repo.description ? (
                            <span className="truncate text-xs text-text-secondary">
                              {repo.description}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </>
            )}
          </div>
        }
        buttons={
          connected ? (
            <Button
              variant="submit"
              disabled={!selected || importing}
              onClick={handleImport}
              data-testid="github-import-confirm"
            >
              {localize('com_ui_upload_github_import')}
            </Button>
          ) : undefined
        }
      />
    </OGDialog>
  );
}
