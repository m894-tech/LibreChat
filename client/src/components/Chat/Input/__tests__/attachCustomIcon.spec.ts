import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const inputRoot = join(__dirname, '..');
const source = (file: string): string => readFileSync(join(inputRoot, file), 'utf8');
const attachmentIconSource = readFileSync(
  join(__dirname, '../../../../../../packages/client/src/svgs/AttachmentIcon.tsx'),
  'utf8',
);

describe('Composer attach custom glyph', () => {
  it.each(['Files/AttachFile.tsx', 'Files/AttachFileMenu.tsx'])(
    '%s never imports lucide Paperclip and uses AttachmentIcon',
    (file) => {
      const contents = source(file);
      expect(contents).not.toMatch(/\bPaperclip\b/);
      expect(contents).toContain('AttachmentIcon');
      expect(contents).toContain('size-9');
      expect(contents).toContain('rounded-full');
    },
  );

  it('AttachFileChat routes through AttachFile / AttachFileMenu only', () => {
    const contents = source('Files/AttachFileChat.tsx');
    expect(contents).not.toMatch(/\bPaperclip\b/);
    expect(contents).toContain("from './AttachFileMenu'");
    expect(contents).toContain("from './AttachFile'");
  });

  it('AttachmentIcon ships the pre-meili filled clip marker', () => {
    expect(attachmentIconSource).toContain('data-lc-attach="pre-meili-clip"');
    expect(attachmentIconSource).toContain('fill="currentColor"');
    expect(attachmentIconSource).not.toMatch(/\bstroke=/);
  });
});
