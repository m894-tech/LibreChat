import { useEffect, useState } from 'react';
import { designApi } from './api';
export default function ReferencePanel({
  documentId,
  revision,
  readOnly,
}: {
  documentId: string;
  revision: number;
  readOnly: boolean;
}) {
  const [kind, setKind] = useState<'styles' | 'screens' | 'flows'>('styles');
  const [selectedReference, setSelectedReference] = useState<{ id: string; kind: string } | null>(
    null,
  );
  const [url, setURL] = useState(''),
    [title, setTitle] = useState(''),
    [decision, setDecision] = useState(''),
    [error, setError] = useState(''),
    [saved, setSaved] = useState<any>(null),
    [available, setAvailable] = useState(false),
    [results, setResults] = useState<any[]>([]),
    [query, setQuery] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    designApi
      .getReferenceLock(documentId)
      .then((r) => {
        if (active) {
          setSaved(r.lock);
          setAvailable(r.researchAvailable);
        }
      })
      .catch(() => {
        if (active) setError('Референсы недоступны');
      });
    return () => {
      active = false;
    };
  }, [documentId, revision]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка референсов');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="design-chat">
      <summary>Референсы и направление</summary>
      <p>
        {available
          ? 'Поиск референсов подключён'
          : 'Поиск Refero в модуле не подключён. Можно сохранить ссылку и обоснование вручную.'}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {available ? (
        <>
          <select
            aria-label="Тип референсов"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              setResults([]);
            }}
          >
            <option value="styles">Стили</option>
            <option value="screens">Экраны</option>
            <option value="flows">Сценарии</option>
          </select>
          <input
            aria-label="Поиск направления"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={300}
          />
          <button
            disabled={busy || !query.trim()}
            onClick={() =>
              void run(async () =>
                setResults(
                  (await designApi.researchReferences(documentId, { kind, query })).references,
                ),
              )
            }
          >
            Найти референсы
          </button>
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setURL(r.url);
                setTitle(r.title);
                setSelectedReference({ id: r.id, kind: r.kind });
              }}
            >
              {r.title}
            </button>
          ))}
        </>
      ) : null}
      <label>
        HTTPS-ссылка
        <input
          aria-label="Ссылка референса"
          value={url}
          onChange={(e) => {
            setURL(e.target.value);
            setSelectedReference(null);
          }}
          disabled={readOnly}
          maxLength={2048}
        />
      </label>
      <label>
        Название
        <input
          aria-label="Название референса"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={readOnly}
          maxLength={200}
        />
      </label>
      <label>
        Причина выбора
        <input
          aria-label="Причина выбора"
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          disabled={readOnly}
          maxLength={64}
        />
      </label>
      <button
        disabled={readOnly || busy || !url || !title || !decision}
        onClick={() =>
          void run(async () => {
            const r = await designApi.saveReferenceLock(documentId, {
              expectedRevision: revision,
              decision,
              references: [
                {
                  id: selectedReference?.id ?? crypto.randomUUID(),
                  kind: selectedReference?.kind ?? kind,
                  url,
                  title,
                },
              ],
              traits: [],
            });
            setSaved(r.lock);
          })
        }
      >
        Закрепить направление
      </button>
      {saved?.status && saved.status !== 'missing' ? (
        <div>
          <p>
            Версия {saved.lockedRevision} ·{' '}
            {saved.status === 'stale' ? 'документ изменён' : 'актуально'} · {saved.decision}
          </p>
          {saved.references.map((r: any) => (
            <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer">
              {r.title}
            </a>
          ))}
        </div>
      ) : null}
    </details>
  );
}
