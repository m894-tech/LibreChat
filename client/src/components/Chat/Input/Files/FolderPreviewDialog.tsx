import { useMemo } from 'react';
import { Button, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { FolderUploadEntry } from '~/utils/folderUpload';
import { useLocalize } from '~/hooks';

type FolderPreviewDialogProps = {
  open: boolean;
  folderName: string;
  entries: FolderUploadEntry[];
  truncated: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (entries: FolderUploadEntry[]) => void;
};

export default function FolderPreviewDialog({
  open,
  folderName,
  entries,
  truncated,
  onOpenChange,
  onConfirm,
}: FolderPreviewDialogProps) {
  const localize = useLocalize();
  const preview = useMemo(() => entries.slice(0, 40), [entries]);

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_upload_folder_preview_title')}
        className="w-11/12 max-w-lg"
        main={
          <div className="flex flex-col gap-3" data-testid="folder-preview-dialog">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_upload_folder_preview_summary', {
                0: folderName || localize('com_ui_upload_folder'),
                1: entries.length,
              })}
            </p>
            {truncated ? (
              <p className="text-xs text-text-warning">
                {localize('com_ui_upload_folder_truncated')}
              </p>
            ) : null}
            <ul className="max-h-56 overflow-y-auto rounded-md border border-border-light bg-surface-secondary px-2 py-1 text-xs">
              {preview.map((entry) => (
                <li
                  key={entry.relativePath}
                  className="truncate py-0.5 text-text-primary"
                  title={entry.relativePath}
                >
                  {entry.relativePath}
                </li>
              ))}
              {entries.length > preview.length ? (
                <li className="py-0.5 text-text-secondary">
                  {localize('com_ui_upload_folder_more', {
                    0: entries.length - preview.length,
                  })}
                </li>
              ) : null}
            </ul>
          </div>
        }
        buttons={
          <Button
            variant="submit"
            disabled={entries.length === 0}
            onClick={() => onConfirm(entries)}
            data-testid="folder-preview-confirm"
          >
            {localize('com_ui_upload')}
          </Button>
        }
      />
    </OGDialog>
  );
}
