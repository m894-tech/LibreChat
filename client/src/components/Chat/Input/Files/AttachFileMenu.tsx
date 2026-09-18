import React, { useRef, useState, useMemo, useCallback } from 'react';
import { useRecoilState } from 'recoil';
import * as Ariakit from '@ariakit/react';
import {
  FileUpload,
  TooltipAnchor,
  DropdownPopup,
  AttachmentIcon,
  SharePointIcon,
} from '@librechat/client';
import {
  FilePlus,
  FolderUp,
  FileSearch,
  ImageUpIcon,
  FileType2Icon,
  FileImageIcon,
  TerminalSquareIcon,
  Cloud,
  Github,
} from 'lucide-react';
import {
  Providers,
  EToolResources,
  EModelEndpoint,
  isExplicitMimeConfig,
  getConfiguredMimeAccept,
  bedrockDocumentMimeTypes,
  defaultAgentCapabilities,
  bedrockDocumentExtensions,
  isDocumentSupportedProvider,
} from 'librechat-data-provider';
import type {
  TConversation,
  EndpointFileConfig,
  MimeUploadCapability,
} from 'librechat-data-provider';
import type { FolderUploadEntry } from '~/utils/folderUpload';
import type { ExtendedFile, FileSetter } from '~/common';
import {
  useAgentToolPermissions,
  useAgentCapabilities,
  useGetAgentsConfig,
  useFileHandlingNoChatContext,
  useLocalize,
} from '~/hooks';
import { useSharePointFileHandlingNoChatContext } from '~/hooks/Files/useSharePointFileHandling';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import { collectFolderFiles, folderEntriesToFiles } from '~/utils/folderUpload';
import { SharePointPickerDialog } from '~/components/SharePoint';
import FolderPreviewDialog from './FolderPreviewDialog';
import DropboxImportDialog from './DropboxImportDialog';
import { useGetStartupConfig } from '~/data-provider';
import GitHubImportDialog from './GitHubImportDialog';
import { ephemeralAgentByConvoId } from '~/store';
import { MenuItemProps } from '~/common';
import { cn } from '~/utils';

type FileUploadType =
  | 'image'
  | 'document'
  | 'image_document'
  | 'image_document_extended'
  | 'image_document_video_audio'
  | 'image_document_video_audio_configured';

/** What each provider upload path can actually send, used to scope the picker filter to selectable files. */
const fileTypeCapabilities: Record<FileUploadType, MimeUploadCapability> = {
  image: { categories: ['image'] },
  document: { categories: ['document'] },
  image_document: { categories: ['image', 'document'] },
  image_document_extended: {
    categories: ['image', 'document'],
    documentMimeTypes: bedrockDocumentMimeTypes,
  },
  /** Google/Vertex/OpenRouter media path: documents are limited to PDF (see isProviderAttachType). */
  image_document_video_audio: {
    categories: ['image', 'document', 'audio', 'video'],
    documentMimeTypes: ['application/pdf'],
  },
  /** Custom endpoint with an admin-configured allowlist: the config decides, including video/audio. */
  image_document_video_audio_configured: {
    categories: ['image', 'document', 'audio', 'video'],
  },
};

interface AttachFileMenuProps {
  agentId?: string | null;
  endpoint?: string | null;
  disabled?: boolean | null;
  conversationId: string;
  endpointType?: EModelEndpoint | string;
  endpointFileConfig?: EndpointFileConfig;
  /**
   * Kept for call-site compatibility. M894 densify always shows the custom attach
   * popover — unified mode must not collapse it to a bare picker / local+SharePoint.
   */
  isUnifiedMode?: boolean;
  useResponsesApi?: boolean;
  files: Map<string, ExtendedFile>;
  setFiles: FileSetter;
  setFilesLoading: React.Dispatch<React.SetStateAction<boolean>>;
  conversation: TConversation | null;
}

const AttachFileMenu = ({
  agentId,
  endpoint,
  disabled,
  endpointType,
  conversationId,
  endpointFileConfig,
  useResponsesApi,
  files,
  setFiles,
  setFilesLoading,
  conversation,
}: AttachFileMenuProps) => {
  const localize = useLocalize();
  const isUploadDisabled = disabled ?? false;
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isPopoverActive, setIsPopoverActive] = useState(false);
  const uploadFileTooltip = useShortcutHint('uploadFile', localize('com_sidepanel_attach_files'));
  const uploadFileAriaKey = useShortcutAriaKey('uploadFile');
  const [ephemeralAgent, setEphemeralAgent] = useRecoilState(
    ephemeralAgentByConvoId(conversationId),
  );
  const toolResourceRef = useRef<EToolResources | undefined>();
  const { handleFileChange, handleFiles } = useFileHandlingNoChatContext(undefined, {
    files,
    setFiles,
    setFilesLoading,
    conversation,
  });
  const { handleSharePointFiles, isProcessing, downloadProgress } =
    useSharePointFileHandlingNoChatContext(
      { toolResource: toolResourceRef.current },
      { files, setFiles, setFilesLoading, conversation },
    );

  const { agentsConfig } = useGetAgentsConfig();
  const { data: startupConfig } = useGetStartupConfig();
  const sharePointEnabled = startupConfig?.sharePointFilePickerEnabled;

  const [isSharePointDialogOpen, setIsSharePointDialogOpen] = useState(false);
  const [isGithubDialogOpen, setIsGithubDialogOpen] = useState(false);
  const [isDropboxDialogOpen, setIsDropboxDialogOpen] = useState(false);
  const [folderPreview, setFolderPreview] = useState<{
    folderName: string;
    entries: FolderUploadEntry[];
    truncated: boolean;
  } | null>(null);

  const capabilities = useAgentCapabilities(agentsConfig?.capabilities ?? defaultAgentCapabilities);

  const { fileSearchAllowedByAgent, codeAllowedByAgent, provider } = useAgentToolPermissions(
    agentId,
    ephemeralAgent,
  );

  const handleUploadClick = useCallback(
    (fileType?: FileUploadType) => {
      if (!inputRef.current) {
        return;
      }
      inputRef.current.value = '';
      const configuredAccept =
        fileType !== undefined
          ? getConfiguredMimeAccept(
              endpointFileConfig?.supportedMimeTypes,
              fileTypeCapabilities[fileType],
            )
          : undefined;
      if (configuredAccept != null) {
        inputRef.current.accept = configuredAccept;
      } else if (fileType === 'image') {
        inputRef.current.accept = 'image/*,.heif,.heic';
      } else if (fileType === 'document') {
        inputRef.current.accept = '.pdf,application/pdf';
      } else if (fileType === 'image_document') {
        inputRef.current.accept = 'image/*,.heif,.heic,.pdf,application/pdf';
      } else if (fileType === 'image_document_extended') {
        inputRef.current.accept = `image/*,.heif,.heic,${bedrockDocumentExtensions}`;
      } else if (fileType === 'image_document_video_audio') {
        inputRef.current.accept = 'image/*,.heif,.heic,.pdf,application/pdf,video/*,audio/*';
      } else if (fileType === 'image_document_video_audio_configured') {
        inputRef.current.accept = '';
      } else {
        inputRef.current.accept = '';
      }
      inputRef.current.click();
    },
    [endpointFileConfig?.supportedMimeTypes],
  );

  const handleFolderClick = useCallback(() => {
    if (!folderInputRef.current) {
      return;
    }
    folderInputRef.current.value = '';
    folderInputRef.current.click();
  }, []);

  const handleFolderInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    event.stopPropagation();
    const list = event.target.files;
    if (!list || list.length === 0) {
      return;
    }
    const collected = collectFolderFiles(list);
    setFolderPreview({
      folderName: collected.folderName,
      entries: collected.entries,
      truncated: collected.truncated,
    });
    event.target.value = '';
  }, []);

  const handleFolderConfirm = useCallback(
    async (entries: FolderUploadEntry[]) => {
      setFolderPreview(null);
      const fileBatch = folderEntriesToFiles(entries);
      if (fileBatch.length === 0) {
        return;
      }
      setFilesLoading(true);
      await handleFiles(fileBatch, toolResourceRef.current);
      toolResourceRef.current = undefined;
    },
    [handleFiles, setFilesLoading],
  );

  const dropdownItems = useMemo(() => {
    const setToolResource = (value: EToolResources | undefined) => {
      toolResourceRef.current = value;
    };

    const items: MenuItemProps[] = [];

    items.push({
      label: localize('com_ui_upload_add_file'),
      onClick: () => {
        setToolResource(undefined);
        handleUploadClick();
      },
      icon: <FilePlus className="icon-md" />,
    });

    items.push({
      label: localize('com_ui_upload_folder'),
      onClick: () => {
        setToolResource(undefined);
        handleFolderClick();
      },
      icon: <FolderUp className="icon-md" />,
    });

    items.push({
      label: localize('com_ui_upload_image_input'),
      onClick: () => {
        setToolResource(undefined);
        handleUploadClick('image');
      },
      icon: <ImageUpIcon className="icon-md" />,
    });

    const cloudSubItems: MenuItemProps[] = [
      {
        label: localize('com_ui_upload_github'),
        onClick: () => setIsGithubDialogOpen(true),
        icon: <Github className="icon-md" />,
      },
      {
        label: localize('com_ui_upload_dropbox'),
        onClick: () => setIsDropboxDialogOpen(true),
        icon: <Cloud className="icon-md" />,
      },
    ];

    if (sharePointEnabled) {
      cloudSubItems.push({
        label: localize('com_files_upload_sharepoint'),
        onClick: () => {
          setToolResource(undefined);
          setIsSharePointDialogOpen(true);
        },
        icon: <SharePointIcon className="icon-md" />,
      });
    }

    items.push({
      label: localize('com_ui_upload_cloud_disk'),
      onClick: () => {},
      icon: <Cloud className="icon-md" />,
      subItems: cloudSubItems,
    });

    let currentProvider = provider || endpoint;

    if (currentProvider?.toLowerCase() === Providers.OPENROUTER) {
      currentProvider = Providers.OPENROUTER;
    }

    const isAzureWithResponsesApi =
      (currentProvider === EModelEndpoint.azureOpenAI ||
        endpointType === EModelEndpoint.azureOpenAI) &&
      useResponsesApi === true;

    if (
      isDocumentSupportedProvider(endpointType) ||
      isDocumentSupportedProvider(currentProvider) ||
      isAzureWithResponsesApi
    ) {
      items.push({
        label: localize('com_ui_upload_provider'),
        onClick: () => {
          setToolResource(undefined);
          let fileType: Exclude<FileUploadType, 'image' | 'document'> = 'image_document';
          if (currentProvider === Providers.GOOGLE || currentProvider === Providers.OPENROUTER) {
            fileType = 'image_document_video_audio';
          } else if (
            currentProvider === Providers.BEDROCK ||
            endpointType === EModelEndpoint.bedrock
          ) {
            fileType = 'image_document_extended';
          } else if (
            endpointType === EModelEndpoint.custom &&
            isExplicitMimeConfig(endpointFileConfig?.supportedMimeTypes)
          ) {
            fileType = 'image_document_video_audio_configured';
          }
          handleUploadClick(fileType);
        },
        icon: <FileImageIcon className="icon-md" />,
      });
    }

    if (capabilities.contextEnabled) {
      items.push({
        label: localize('com_ui_upload_ocr_text'),
        onClick: () => {
          setToolResource(EToolResources.context);
          handleUploadClick();
        },
        icon: <FileType2Icon className="icon-md" />,
      });
    }

    if (capabilities.fileSearchEnabled && fileSearchAllowedByAgent) {
      items.push({
        label: localize('com_ui_upload_file_search'),
        onClick: () => {
          setToolResource(EToolResources.file_search);
          setEphemeralAgent((prev) => ({
            ...prev,
            [EToolResources.file_search]: true,
          }));
          handleUploadClick();
        },
        icon: <FileSearch className="icon-md" />,
      });
    }

    if (capabilities.codeEnabled && codeAllowedByAgent) {
      items.push({
        label: localize('com_ui_upload_code_environment'),
        onClick: () => {
          setToolResource(EToolResources.execute_code);
          setEphemeralAgent((prev) => ({
            ...prev,
            [EToolResources.execute_code]: true,
          }));
          handleUploadClick();
        },
        icon: <TerminalSquareIcon className="icon-md" />,
      });
    }

    return items;
  }, [
    localize,
    endpoint,
    provider,
    endpointType,
    capabilities,
    useResponsesApi,
    handleUploadClick,
    handleFolderClick,
    setEphemeralAgent,
    sharePointEnabled,
    endpointFileConfig?.supportedMimeTypes,
    codeAllowedByAgent,
    fileSearchAllowedByAgent,
  ]);

  const menuTrigger = (
    <TooltipAnchor
      render={
        <Ariakit.MenuButton
          disabled={isUploadDisabled}
          id="attach-file-menu-button"
          aria-label="Attach File Options"
          aria-keyshortcuts={uploadFileAriaKey}
          data-testid="composer-attach-file"
          className={cn(
            /* Pre-meili / densify custom attach chrome — not theme-control default. */
            'flex size-9 items-center justify-center rounded-full border border-border-light bg-surface-secondary p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-primary focus-visible:ring-opacity-50',
            isPopoverActive && 'bg-surface-hover text-text-primary',
            isUploadDisabled && 'pointer-events-none opacity-50',
          )}
        >
          <AttachmentIcon />
        </Ariakit.MenuButton>
      }
      id="attach-file-menu-button"
      description={uploadFileTooltip}
      disabled={isUploadDisabled}
    />
  );

  const handleSharePointFilesSelected = async (sharePointFiles: any[]) => {
    try {
      await handleSharePointFiles(sharePointFiles);
      setIsSharePointDialogOpen(false);
    } catch (error) {
      console.error('SharePoint file processing error:', error);
    }
  };

  return (
    <>
      <FileUpload
        ref={inputRef}
        handleFileChange={(e) => {
          handleFileChange(e, toolResourceRef.current);
          toolResourceRef.current = undefined;
        }}
      >
        <DropdownPopup
          menuId="attach-file-menu"
          className="overflow-visible"
          isOpen={isPopoverActive}
          setIsOpen={setIsPopoverActive}
          modal={false}
          portal={true}
          unmountOnHide={true}
          trigger={menuTrigger}
          items={dropdownItems}
          iconClassName="mr-0"
        />
      </FileUpload>
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFolderInputChange}
        data-testid="folder-file-input"
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
      />
      <FolderPreviewDialog
        open={folderPreview != null}
        folderName={folderPreview?.folderName ?? ''}
        entries={folderPreview?.entries ?? []}
        truncated={folderPreview?.truncated ?? false}
        onOpenChange={(open) => {
          if (!open) {
            setFolderPreview(null);
          }
        }}
        onConfirm={handleFolderConfirm}
      />
      <GitHubImportDialog
        open={isGithubDialogOpen}
        conversationId={conversationId}
        agentId={agentId}
        onOpenChange={setIsGithubDialogOpen}
      />
      <DropboxImportDialog
        open={isDropboxDialogOpen}
        conversationId={conversationId}
        onOpenChange={setIsDropboxDialogOpen}
      />
      <SharePointPickerDialog
        isOpen={isSharePointDialogOpen}
        onOpenChange={setIsSharePointDialogOpen}
        onFilesSelected={handleSharePointFilesSelected}
        isDownloading={isProcessing}
        downloadProgress={downloadProgress}
        maxSelectionCount={endpointFileConfig?.fileLimit}
      />
    </>
  );
};

export default React.memo(AttachFileMenu);
