import { memo, useCallback } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { ChevronLeft, ChevronRight, Clock3, RotateCcw, X } from 'lucide-react';
import { moveQueuedItem } from '~/utils/composerQueuePersist';
import { useLocalize } from '~/hooks';
import store from '~/store';

function ComposerQueueChips({ index }: { index: number }) {
  const localize = useLocalize();
  const queue = useRecoilValue(store.composerQueueByIndex(index));
  const setQueue = useSetRecoilState(store.composerQueueByIndex(index));

  const remove = useCallback(
    (id: string) => setQueue((items) => items.filter((item) => item.id !== id)),
    [setQueue],
  );
  const move = useCallback(
    (id: string, direction: 'left' | 'right') =>
      setQueue((items) => moveQueuedItem(items, id, direction)),
    [setQueue],
  );
  const retryNow = useCallback(
    (id: string) =>
      setQueue((items) => {
        const found = items.find((item) => item.id === id);
        if (!found) {
          return items;
        }
        return [found, ...items.filter((item) => item.id !== id)];
      }),
    [setQueue],
  );

  if (queue.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 px-2 pt-2">
      <p className="px-0.5 text-[11px] text-text-secondary">
        {localize('com_ui_queue_client_only')}
      </p>
      <div
        className="flex flex-wrap gap-1.5"
        role="list"
        aria-label={localize('com_ui_message_queue')}
      >
        {queue.map((item, position) => (
          <span
            key={item.id}
            role="listitem"
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-border-light bg-surface-secondary px-2 py-0.5 text-xs text-text-secondary"
            title={item.text}
          >
            <Clock3 className="h-3 w-3 shrink-0 text-amber-500" aria-hidden="true" />
            <span className="shrink-0 font-medium">{position + 1}</span>
            <span className="max-w-[14rem] truncate">{item.text}</span>
            <button
              type="button"
              aria-label={localize('com_ui_queue_move_earlier')}
              disabled={position === 0}
              onClick={() => move(item.id, 'left')}
              className="rounded-full p-0.5 hover:bg-surface-tertiary disabled:opacity-30"
            >
              <ChevronLeft className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={localize('com_ui_queue_move_later')}
              disabled={position === queue.length - 1}
              onClick={() => move(item.id, 'right')}
              className="rounded-full p-0.5 hover:bg-surface-tertiary disabled:opacity-30"
            >
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={localize('com_ui_queue_retry')}
              onClick={() => retryNow(item.id)}
              className="rounded-full p-0.5 hover:bg-surface-tertiary"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={localize('com_ui_remove_queued_message', { 0: item.text })}
              onClick={() => remove(item.id)}
              className="-mr-0.5 ml-0.5 rounded-full p-0.5 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

export default memo(ComposerQueueChips);
