import { useEffect, useState } from 'react';
import { designApi } from './api';
export default function BrandPanel({
  projectId,
  owner,
  documentId,
  revision,
  readOnly,
  onProposal,
  onBind,
}: {
  projectId: string;
  owner: boolean;
  documentId: string;
  revision: number;
  readOnly: boolean;
  onProposal: () => Promise<void>;
  onBind: (id: string, version: string) => Promise<void>;
}) {
  const [name, setName] = useState('Бренд команды'),
    [id, setId] = useState('team-brand'),
    [version, setVersion] = useState('1.0.0'),
    [color, setColor] = useState('#164E63'),
    [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [candidates, setCandidates] = useState<any[]>([]);
  useEffect(() => {
    let active = true;
    void designApi
      .systemCandidates()
      .then((rows) => {
        if (active) setCandidates(rows);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    designApi
      .listBrands(projectId)
      .then((b) => {
        if (active) setItems(b);
      })
      .catch(() => {
        if (active) setError('Бренды недоступны');
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  return (
    <details className="design-chat">
      <summary>Брендовые пакеты</summary>
      <details>
        <summary>Дополнительные системы — кандидаты</summary>
        <p>Содержат манифест, токены, исходник превью и адаптер. Требуют проверки пригодности.</p>
        {candidates.map((c) => (
          <div key={c.brand.id}>
            <img
              alt={c.brand.name + ' — пример'}
              src={'/design-system-candidates/' + c.brand.id + '/preview.png'}
              style={{ width: 100, height: 125, objectFit: 'contain' }}
            />
            <span>{c.brand.name}</span>
            <button
              disabled={!owner || busy}
              onClick={() => {
                setBusy(true);
                void designApi
                  .installSystemCandidate(projectId, c.brand.id)
                  .then(() => designApi.listBrands(projectId))
                  .then(setItems)
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Добавить в проект
            </button>
          </div>
        ))}
      </details>
      <p>
        Опубликованные версии неизменяемы. Можно привязать свойства к опубликованной версии или
        применить фиксированные значения. Новая версия пакета не меняет документы автоматически.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <label>
        Название
        <input
          aria-label="Название бренда"
          disabled={!owner || busy}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
        />
      </label>
      <label>
        Идентификатор
        <input
          aria-label="ID бренда"
          disabled={!owner || busy}
          value={id}
          onChange={(e) => setId(e.target.value)}
          maxLength={64}
        />
      </label>
      <label>
        Версия
        <input
          aria-label="Версия бренда"
          disabled={!owner || busy}
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          maxLength={64}
        />
      </label>
      <label>
        Акцент
        <input
          type="color"
          aria-label="Акцент бренда"
          value={color}
          disabled={!owner || busy}
          onChange={(e) => setColor(e.target.value)}
        />
      </label>
      <button
        disabled={!owner || busy}
        onClick={() => {
          setBusy(true);
          setError('');
          void designApi
            .publishBrand(projectId, {
              id,
              version,
              name,
              baseSystemId: 'neutral-business',
              baseSystemVersion: '1.0.0',
              tokens: { 'color.accent': { type: 'color', value: color, properties: ['fill'] } },
              fonts: [{ family: 'Inter', licenseText: 'SIL OPEN FONT LICENSE Version 1.1' }],
              designNotes: 'Accent override on neutral business.',
            })
            .then(() => designApi.listBrands(projectId))
            .then(setItems)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Опубликовать пакет
      </button>
      {items.map((b) => (
        <p key={b.id + '@' + b.version}>
          {b.package.name} · {b.version}
          <button
            disabled={readOnly || busy}
            onClick={() => {
              setBusy(true);
              void onBind(b.id, b.version)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Привязать к версии
          </button>
          <button
            disabled={readOnly || busy}
            onClick={() => {
              setBusy(true);
              void designApi
                .brandProposal(documentId, revision, b.id, b.version)
                .then(onProposal)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Предложить применение
          </button>
        </p>
      ))}
    </details>
  );
}
