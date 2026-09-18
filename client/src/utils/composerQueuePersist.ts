import type { QueuedComposerItem } from '~/common';

export const COMPOSER_QUEUE_STORAGE_PREFIX = 'm894_composer_queue_v1__';

function storageKey(index: string | number): string {
  return `${COMPOSER_QUEUE_STORAGE_PREFIX}${index}`;
}

function isQueuedItem(value: unknown): value is QueuedComposerItem {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as QueuedComposerItem;
  return (
    typeof item.id === 'string' &&
    typeof item.userMessageId === 'string' &&
    typeof item.text === 'string' &&
    Array.isArray(item.files) &&
    Array.isArray(item.manualSkills) &&
    item.conversation != null
  );
}

/** Files cannot be restored from localStorage; persist metadata only. */
export function serializeComposerQueue(items: QueuedComposerItem[]): QueuedComposerItem[] {
  return items.map((item) => ({
    ...item,
    files: item.files.map((file) => ({
      ...file,
      preview: undefined,
      file: undefined,
    })),
  }));
}

export function loadComposerQueue(index: string | number): QueuedComposerItem[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey(index));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isQueuedItem);
  } catch {
    return [];
  }
}

export function saveComposerQueue(index: string | number, items: QueuedComposerItem[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(storageKey(index), JSON.stringify(serializeComposerQueue(items)));
  } catch {
    /* quota */
  }
}

export function clearComposerQueue(index: string | number): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.removeItem(storageKey(index));
  } catch {
    /* ignore */
  }
}

export function moveQueuedItem(
  items: QueuedComposerItem[],
  id: string,
  direction: 'left' | 'right',
): QueuedComposerItem[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    return items;
  }
  const next = [...items];
  const swapWith = direction === 'left' ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= next.length) {
    return items;
  }
  const tmp = next[index];
  next[index] = next[swapWith];
  next[swapWith] = tmp;
  return next;
}
