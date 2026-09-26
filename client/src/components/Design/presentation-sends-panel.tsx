import { useEffect, useState } from 'react';
import { designApi } from './api';
export interface PresentationSendView {
  id: string;
  sourceRevision: number;
  destinationId: string;
  status: 'running' | 'succeeded' | 'submission_unknown';
  slideId?: string;
}
export default function PresentationSendsPanel({
  documentId,
  readOnly,
}: {
  documentId: string;
  readOnly: boolean;
}) {
  const [rows, setRows] = useState<PresentationSendView[]>([]),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const items = await designApi.listPresentationSends(documentId);
        if (active) setRows(items);
      } catch {
        if (active) setError('История передачи недоступна');
      } finally {
        if (active) timer = setTimeout(load, 5000);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [documentId]);
  if (!rows.length && !error) return null;
  return (
    <details className="design-chat">
      <summary>Передача в презентации</summary>
      {error ? <p role="alert">{error}</p> : null}
      {rows.map((r) => (
        <div key={r.id}>
          <p>
            Версия макета {r.sourceRevision} → {r.destinationId}
          </p>
          <p>
            {r.status === 'succeeded'
              ? 'Подтверждено назначением'
              : r.status === 'running'
                ? 'Передача выполняется'
                : 'Результат неизвестен. Повторная отправка запрещена.'}
          </p>
          {r.status !== 'succeeded' ? (
            <button
              disabled={readOnly || busy !== null}
              onClick={() => {
                setBusy(r.id);
                setError('');
                void designApi
                  .reconcilePresentationSend(r.id)
                  .then((updated) =>
                    setRows((prev) => prev.map((p) => (p.id === updated.id ? updated : p))),
                  )
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(null));
              }}
            >
              Проверить квитанцию — без повторной отправки
            </button>
          ) : null}
        </div>
      ))}
    </details>
  );
}
