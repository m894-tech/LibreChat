import React, { useRef } from 'react';
import { FileUpload, TooltipAnchor, AttachmentIcon } from '@librechat/client';
import type { TConversation } from 'librechat-data-provider';
import type { ExtendedFile, FileSetter } from '~/common';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import { useFileHandlingNoChatContext, useLocalize } from '~/hooks';
import { cn } from '~/utils';

const AttachFile = ({
  disabled,
  files,
  setFiles,
  setFilesLoading,
  conversation,
}: {
  disabled?: boolean | null;
  files: Map<string, ExtendedFile>;
  setFiles: FileSetter;
  setFilesLoading: React.Dispatch<React.SetStateAction<boolean>>;
  conversation: TConversation | null;
}) => {
  const localize = useLocalize();
  const inputRef = useRef<HTMLInputElement>(null);
  const isUploadDisabled = disabled ?? false;
  const tooltipDescription = useShortcutHint('uploadFile', localize('com_sidepanel_attach_files'));
  const ariaKey = useShortcutAriaKey('uploadFile');

  const { handleFileChange } = useFileHandlingNoChatContext(undefined, {
    files,
    setFiles,
    setFilesLoading,
    conversation,
  });

  return (
    <FileUpload ref={inputRef} handleFileChange={handleFileChange}>
      <TooltipAnchor
        description={tooltipDescription}
        id="attach-file"
        disabled={isUploadDisabled}
        render={
          <button
            type="button"
            aria-label={localize('com_sidepanel_attach_files')}
            aria-keyshortcuts={ariaKey}
            disabled={isUploadDisabled}
            className={cn(
              /* Pre-meili / densify custom attach chrome — not theme-control default. */
              'flex size-9 items-center justify-center rounded-full border border-border-light bg-surface-secondary p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-opacity-50',
              isUploadDisabled && 'pointer-events-none opacity-50',
            )}
            onKeyDownCapture={(e) => {
              if (!inputRef.current) {
                return;
              }
              if (e.key === 'Enter' || e.key === ' ') {
                inputRef.current.value = '';
                inputRef.current.click();
              }
            }}
            onClick={() => {
              if (!inputRef.current) {
                return;
              }
              inputRef.current.value = '';
              inputRef.current.click();
            }}
            data-testid="composer-attach-file"
          >
            <AttachmentIcon />
          </button>
        }
      />
    </FileUpload>
  );
};

export default React.memo(AttachFile);
