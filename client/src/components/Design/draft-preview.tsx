import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { DesignDocument } from './types';
import DesignCanvas from './canvas';
import { designApi } from './api';
interface DraftRecord {
  id: string;
  status: string;
  snapshot: DesignDocument;
  error?: string;
}
/** Preview branch only: generation must never replace the editor head until proposal accept. */
export default function DraftPreview({
  document: doc,
  enabled,
  readOnly,
  assetUrls,
  onProposal,
}: {
  document: DesignDocument;
  enabled: boolean;
  readOnly: boolean;
  assetUrls: Record<string, string>;
  onProposal: () => Promise<void>;
}) {
  const [brief, setBrief] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [record, setRecord] = useState<DraftRecord | null>(null),
    [running, setRunning] = useState(false),
    [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null),
    exportRef = useRef<(() => string | null) | null>(null);
  useEffect(() => {
    let active = true;
    setRecord(null);
    if (enabled)
      void designApi
        .listDocumentDrafts(doc.id)
        .then((items) => {
          if (active && items[0]) setRecord(items[0]);
        })
        .catch(() => {});
    return () => {
      active = false;
      requestRef.current?.abort();
    };
  }, [doc.id, enabled]);
  const start = async () => {
    const controller = new AbortController();
    requestRef.current = controller;
    setRunning(true);
    setError('');
    setRecord(null);
    let consumed = 0,
      buffer = '';
    const consume = (text: string) => {
      if (text.length < consumed) return;
      buffer += text.slice(consumed);
      consumed = text.length;
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end < 0) break;
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = event.split('\n').find((l) => l.startsWith('data: '));
        if (data) {
          const value = JSON.parse(data.slice(6)) as DraftRecord;
          if (value.snapshot && value.id) setRecord(value);
        }
      }
    };
    try {
      const response = await axios.post(
        `/api/design/documents/${encodeURIComponent(doc.id)}/generation-draft`,
        {
          clientId: crypto.randomUUID(),
          prompt: brief,
          expectedRevision: doc.revision,
          documentScopeConfirmed: confirmed,
        },
        {
          responseType: 'text',
          signal: controller.signal,
          timeout: 75000,
          onDownloadProgress: (progress) => {
            const xhr = progress.event?.target as XMLHttpRequest | undefined;
            if (typeof xhr?.responseText === 'string') consume(xhr.responseText);
          },
        },
      );
      consume(response.data);
    } catch (e) {
      setError(
        controller.signal.aborted
          ? 'Остановлено: сохранённые блоки не применены; расходы провайдера возможны'
          : e instanceof Error
            ? e.message
            : 'Ошибка генерации',
      );
    } finally {
      requestRef.current = null;
      setRunning(false);
    }
  };
  const createProposal = async () => {
    if (!record) return;
    try {
      await designApi.draftProposal(record.id);
      await onProposal();
      setRecord(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Предложение не создано');
    }
  };
  return (
    <section className="design-chat" aria-label="Макет по брифу">
      <h2>Макет по брифу</h2>
      {!enabled ? (
        <p>Потоковая генерация не настроена</p>
      ) : (
        <>
          <label>
            Бриф
            <textarea
              aria-label="Бриф макета"
              maxLength={8000}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              disabled={running || readOnly}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={running || readOnly}
            />
            Разрешаю добавить элементы во весь документ. Существующие блокировки сохраняются.
          </label>
          <button
            disabled={!brief.trim() || !confirmed || running || readOnly}
            onClick={() => void start()}
          >
            Сформировать превью
          </button>
          {running ? (
            <button onClick={() => requestRef.current?.abort()}>Остановить генерацию</button>
          ) : null}
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {record ? (
        <>
          <p>Черновик: {record.status}. Исходный документ не изменён.</p>
          <div style={{ height: 260, position: 'relative', minWidth: 0 }}>
            <DesignCanvas
              document={record.snapshot}
              selectedId={null}
              readOnly={true}
              assetUrls={assetUrls}
              onSelect={() => {}}
              onDragEnd={() => {}}
              exportRef={exportRef}
            />
          </div>
          <button
            disabled={record.status !== 'succeeded' || readOnly || running}
            onClick={() => void createProposal()}
          >
            Передать на подтверждение
          </button>
        </>
      ) : null}
    </section>
  );
}
