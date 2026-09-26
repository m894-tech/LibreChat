import { useEffect, useState } from 'react';
import { designApi } from './api';
export default function ImageEditJobs({
  documentId,
  onRefreshProposals,
}: {
  documentId: string;
  onRefreshProposals: () => Promise<void>;
}) {
  const [jobs, setJobs] = useState<
      Array<{ id: string; kind: string; status: string; proposalId?: string }>
    >([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const items = await designApi.imageEditJobs(documentId);
        if (active) setJobs(items);
      } catch {
        if (active) setError('Не удалось проверить задания редактирования');
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
  if (!jobs.length && !error) return null;
  return (
    <details className="design-chat">
      <summary>Задания редактирования изображений</summary>
      {error ? <p role="alert">{error}</p> : null}
      {jobs.map((j) => (
        <div key={j.id}>
          <p>
            {j.kind}:{' '}
            {j.status === 'submission_unknown'
              ? 'Подтверждение отсутствует. Повторного запроса к модели не будет.'
              : j.status === 'running'
                ? 'Выполняется'
                : j.status === 'succeeded'
                  ? 'Предложение готово'
                  : 'Не завершено'}
          </p>
          {j.proposalId ? (
            <button
              onClick={() =>
                void onRefreshProposals().catch(() => setError('Не удалось загрузить предложения'))
              }
            >
              Обновить предложения
            </button>
          ) : null}
        </div>
      ))}
    </details>
  );
}
