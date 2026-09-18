import { useCallback, useEffect, useState } from 'react';
import { Folder, File as FileIcon, ChevronLeft } from 'lucide-react';
import {
  Button,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import {
  attachDropboxPointer,
  fetchDropboxList,
  fetchDropboxStatus,
  startDropboxOAuth,
} from '~/data-provider/ContextSources/api';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type DropboxImportDialogProps = {
  open: boolean;
  conversationId?: string | null;
  onOpenChange: (open: boolean) => void;
  onAttached?: () => void;
};

type DropboxEntry = {
  '.tag'?: string;
  name?: string;
  path_display?: string;
  path_lower?: string;
  size?: number;
};

export default function DropboxImportDialog({
  open,
  conversationId,
  onOpenChange,
  onAttached,
}: DropboxImportDialogProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [attaching, setAttaching] = useState(false);

  const loadList = useCallback(async (listPath: string) => {
    setLoading(true);
    try {
      const status = await fetchDropboxStatus();
      setConnected(status.connected === true);
      if (!status.connected) {
        setEntries([]);
        return;
      }
      const listed = await fetchDropboxList({ path: listPath || undefined });
      setEntries(listed.entries ?? []);
      setPath(listPath);
    } catch {
      setConnected(false);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadList('');
  }, [open, loadList]);

  const handleOAuth = async () => {
    try {
      const { url } = await startDropboxOAuth();
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      showToast({ message: localize('com_ui_upload_dropbox_error'), status: 'error' });
    }
  };

  const parentPath = path.includes('/') ? path.replace(/\/[^/]+$/, '') : '';

  const handleAttach = async (entryPath: string) => {
    setAttaching(true);
    try {
      await attachDropboxPointer({ path: entryPath, conversationId });
      showToast({ message: localize('com_ui_upload_dropbox_success'), status: 'success' });
      onAttached?.();
      onOpenChange(false);
    } catch {
      showToast({ message: localize('com_ui_upload_dropbox_error'), status: 'error' });
    } finally {
      setAttaching(false);
    }
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_upload_dropbox')}
        className="w-11/12 max-w-lg"
        main={
          <div className="flex flex-col gap-3" data-testid="dropbox-import-dialog">
            {!connected ? (
              <>
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_upload_dropbox_connect_hint')}
                </p>
                <Button type="button" variant="outline" onClick={handleOAuth} disabled={loading}>
                  {localize('com_ui_upload_dropbox_oauth')}
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  {path ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-hover hover:text-text-primary"
                      onClick={() => void loadList(parentPath)}
                      aria-label={localize('com_ui_back')}
                    >
                      <ChevronLeft className="icon-sm" />
                      {localize('com_ui_back')}
                    </button>
                  ) : null}
                  <span className="truncate">{path || '/'}</span>
                </div>
                <ul className="max-h-64 overflow-y-auto rounded-md border border-border-light">
                  {entries.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-text-secondary">
                      {loading
                        ? localize('com_ui_loading')
                        : localize('com_ui_upload_dropbox_empty')}
                    </li>
                  ) : (
                    entries.map((entry) => {
                      const entryPath = entry.path_display || entry.path_lower || '';
                      const isFolder = entry['.tag'] === 'folder';
                      return (
                        <li key={entryPath || entry.name}>
                          <button
                            type="button"
                            disabled={attaching || !entryPath}
                            className={cn(
                              'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover',
                              attaching && 'opacity-50',
                            )}
                            onClick={() => {
                              if (!entryPath) {
                                return;
                              }
                              if (isFolder) {
                                void loadList(entryPath);
                                return;
                              }
                              void handleAttach(entryPath);
                            }}
                          >
                            {isFolder ? (
                              <Folder className="icon-sm text-text-secondary" />
                            ) : (
                              <FileIcon className="icon-sm text-text-secondary" />
                            )}
                            <span className="truncate text-text-primary">{entry.name}</span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </>
            )}
          </div>
        }
      />
    </OGDialog>
  );
}
