import { collectFolderFiles, FOLDER_UPLOAD_MAX_FILES } from '../folderUpload';

function makeFile(name: string, opts?: { size?: number; path?: string; type?: string }): File {
  const file = new File(['x'.repeat(opts?.size ?? 1)], name, {
    type: opts?.type ?? 'text/plain',
  });
  if (opts?.path) {
    Object.defineProperty(file, 'webkitRelativePath', { value: opts.path });
  }
  return file;
}

describe('collectFolderFiles', () => {
  it('keeps nested files and derives the folder name', () => {
    const result = collectFolderFiles([
      makeFile('a.ts', { path: 'src/a.ts' }),
      makeFile('b.ts', { path: 'src/nested/b.ts' }),
    ]);
    expect(result.folderName).toBe('src');
    expect(result.entries).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it('skips dotfiles and empty placeholders', () => {
    const result = collectFolderFiles([
      makeFile('.DS_Store', { path: 'proj/.DS_Store', size: 0, type: '' }),
      makeFile('keep.txt', { path: 'proj/keep.txt' }),
    ]);
    expect(result.entries.map((e) => e.relativePath)).toEqual(['proj/keep.txt']);
    expect(result.skipped).toBe(1);
  });

  it('truncates at the max file cap', () => {
    const files = Array.from({ length: FOLDER_UPLOAD_MAX_FILES + 5 }, (_, i) =>
      makeFile(`f${i}.txt`, { path: `dir/f${i}.txt` }),
    );
    const result = collectFolderFiles(files);
    expect(result.entries).toHaveLength(FOLDER_UPLOAD_MAX_FILES);
    expect(result.truncated).toBe(true);
  });
});
