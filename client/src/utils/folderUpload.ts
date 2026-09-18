/** Bounds and filters for composer folder (`webkitdirectory`) attach. */

export const FOLDER_UPLOAD_MAX_FILES = 100;

const SKIP_BASENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export type FolderUploadEntry = {
  file: File;
  relativePath: string;
};

export type FolderUploadResult = {
  folderName: string;
  entries: FolderUploadEntry[];
  truncated: boolean;
  skipped: number;
};

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function isSkippable(file: File, relativePath: string): boolean {
  if (file.size === 0 && (file.type === '' || file.name.startsWith('.'))) {
    return true;
  }
  const name = basename(relativePath || file.name).toLowerCase();
  if (SKIP_BASENAMES.has(name)) {
    return true;
  }
  if (name.startsWith('.')) {
    return true;
  }
  return false;
}

/**
 * Collects files from a directory picker (`webkitdirectory`) FileList,
 * dropping junk / empty placeholders and capping at `maxFiles`.
 */
export function collectFolderFiles(
  fileList: FileList | File[],
  options?: { maxFiles?: number },
): FolderUploadResult {
  const maxFiles = options?.maxFiles ?? FOLDER_UPLOAD_MAX_FILES;
  const raw = Array.from(fileList);
  const entries: FolderUploadEntry[] = [];
  let skipped = 0;
  let truncated = false;
  let folderName = '';

  for (const file of raw) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    if (!folderName) {
      const root = relativePath.split(/[/\\]/)[0];
      folderName = root || file.name;
    }
    if (isSkippable(file, relativePath)) {
      skipped += 1;
      continue;
    }
    if (entries.length >= maxFiles) {
      truncated = true;
      break;
    }
    entries.push({ file, relativePath });
  }

  return { folderName, entries, truncated, skipped };
}

export function folderEntriesToFiles(entries: FolderUploadEntry[]): File[] {
  return entries.map((entry) => entry.file);
}
