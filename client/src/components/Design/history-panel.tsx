import { useEffect, useState } from 'react';
import { designApi } from './api';
interface Revision {
  revision: number;
  actorId: string;
  createdAt: string;
}
export default function HistoryPanel({
  documentId,
  revision,
  disabled,
  onRestore,
}: {
  documentId: string;
  revision: number;
  disabled: boolean;
  onRestore: (revision: number) => Promise<boolean | void>;
}) {
  const [items, setItems] = useState<Revision[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    void designApi
      .listHistory(documentId)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch(() => {
        if (active) setError('История недоступна');
      });
    return () => {
      active = false;
    };
  }, [documentId, revision]);
  return (
    <details className="design-chat">
      <summary>История версий</summary>
      {error ? <p role="alert">{error}</p> : null}
      {items.slice(0, 100).map((r) => (
        <div key={r.revision}>
          <span>
            Версия {r.revision}
            {r.revision === revision ? ' — текущая' : ''}
          </span>
          <button
            disabled={disabled || r.revision === revision}
            onClick={() => void onRestore(r.revision)}
          >
            Восстановить как новую
          </button>
        </div>
      ))}
    </details>
  );
}
