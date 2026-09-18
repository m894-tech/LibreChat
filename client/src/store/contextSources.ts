import { atom } from 'recoil';

export type ContextSourceType = 'file' | 'folder' | 'github' | 'sharepoint' | 'dropbox';
export type ContextSourceStatus = 'processing' | 'ready' | 'failed' | 'disabled';

export type ContextSource = {
  id: string;
  type: ContextSourceType;
  title: string;
  status: ContextSourceStatus;
  conversationId?: string | null;
  fileCount?: number;
  totalBytes?: number;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

const STORAGE_KEY = 'm894_context_sources_v1';

function readAll(): ContextSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ContextSource[]) : [];
  } catch {
    return [];
  }
}

export const contextSourcesAtom = atom<ContextSource[]>({
  key: 'contextSourcesAtom',
  default: typeof window === 'undefined' ? [] : readAll(),
  effects: [
    ({ onSet }) => {
      onSet((newValue) => {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(Array.isArray(newValue) ? newValue : []),
          );
        } catch {
          /* ignore */
        }
      });
    },
  ],
});
