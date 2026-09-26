import { useEffect, useState } from 'react';
import { designApi } from './api';
export interface GenerationJobView {
  id: string;
  documentId: string;
  capability: string;
  status: string;
  cancelRequested: boolean;
  error?: { message: string };
}
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'submission_unknown']);
const LABELS: Record<string, string> = {
  queued: 'В очереди',
  submitting: 'Отправляется',
  submitted: 'Отправлено',
  running: 'Выполняется',
  succeeded: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменено',
  submission_unknown: 'Результат отправки неизвестен — повторная оплата заблокирована',
};
/** Recovers persistent jobs on document reopen. Never re-submits after network errors. */
export default function GenerationJobs({
  documentId,
  readOnly,
  onResult,
}: {
  documentId: string;
  readOnly: boolean;
  onResult: (job: GenerationJobView) => Promise<void>;
}) {
  const [jobs, setJobs] = useState<GenerationJobView[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setJobs([]);
    setError('');
    const load = async () => {
      try {
        const items = await designApi.listGenerationJobs(documentId);
        if (active) setJobs(items);
      } catch {
        if (active) setError('Не удалось загрузить задания');
      } finally {
        if (active) timer = setTimeout(load, 2500);
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [documentId]);
  const action = async (job: GenerationJobView, cancel: boolean) => {
    setBusy(job.id);
    setError('');
    try {
      if (cancel) {
        await designApi.cancelGenerationJob(job.id);
        setJobs(await designApi.listGenerationJobs(documentId));
      } else await onResult(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Действие не выполнено');
    } finally {
      setBusy(null);
    }
  };
  if (!jobs.length && !error) return null;
  return (
    <section aria-label="Задания генерации" className="design-chat">
      <h2>Задания генерации</h2>
      {error ? <p role="alert">{error}</p> : null}
      {jobs.map((job) => (
        <div key={job.id}>
          <p>
            {LABELS[job.status] ?? job.status}
            {job.cancelRequested ? ' · отмена запрошена' : ''}
          </p>
          {job.error ? <p>{job.error.message}</p> : null}
          {!TERMINAL.has(job.status) ? (
            <button
              disabled={readOnly || busy === job.id || job.cancelRequested}
              onClick={() => void action(job, true)}
            >
              Запросить отмену
            </button>
          ) : null}
          {job.status === 'succeeded' ? (
            <button disabled={readOnly || busy === job.id} onClick={() => void action(job, false)}>
              Открыть предложение
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
