import { useEffect, useState } from 'react';
import type { DesignDocument } from './types';
import RegionMaskEditor from './RegionMaskEditor';
import { isEffectivelyLocked } from './document';
import { designApi } from './api';
export default function RegionPanel({
  document: doc,
  selectedId,
  readOnly,
  sourceURL,
  onProposal,
  inpaintEnabled,
}: {
  document: DesignDocument;
  selectedId: string | null;
  readOnly: boolean;
  sourceURL?: string;
  onProposal: () => Promise<void>;
  inpaintEnabled?: boolean;
}) {
  const node = doc.payload.nodes.find((n) => n.id === selectedId);
  const [candidate, setCandidate] = useState<{ id: string; version: number } | null>(null),
    [size, setSize] = useState<{ width: number; height: number } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [prompt, setPrompt] = useState(''),
    [aiMode, setAIMode] = useState(false),
    [padding, setPadding] = useState(64);
  useEffect(() => {
    setCandidate(null);
    setSize(null);
    setError('');
    if (!sourceURL) return;
    const img = new Image();
    let active = true;
    img.onload = () => {
      if (active) setSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      if (active) setError('Исходное изображение недоступно');
    };
    img.src = sourceURL;
    return () => {
      active = false;
    };
  }, [sourceURL, selectedId]);
  if (node?.type !== 'image' || !sourceURL) return null;
  const locked = readOnly || isEffectivelyLocked(doc.payload.nodes, node.id);
  return (
    <section className="design-chat">
      <h2>Заменить выбранную область</h2>
      <button
        disabled={locked || busy}
        onClick={() => {
          setBusy(true);
          void designApi
            .resizeProposal(doc.id, node.id, doc.revision, 2)
            .then(onProposal)
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Увеличить ×2 (Lanczos, не AI)
      </button>
      <p>
        Выберите готовое изображение-кандидат того же размера. Это композитинг, не вызов
        AI-редактора. Вне маски исходные пиксели сохранятся.
      </p>
      <input
        type="file"
        aria-label="Кандидат для области"
        accept="image/png,image/jpeg,image/webp"
        disabled={locked || busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          void designApi
            .uploadAsset(f, doc.projectId)
            .then((a) => setCandidate({ id: a.assetId, version: a.version }))
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      />
      {inpaintEnabled ? (
        <>
          <label>
            <input
              type="checkbox"
              checked={aiMode}
              disabled={locked || busy}
              onChange={(e) => setAIMode(e.target.checked)}
            />
            Редактировать область с помощью модели
          </label>
          {aiMode ? (
            <label>
              Запрос
              <textarea
                aria-label="Запрос inpaint"
                maxLength={2000}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
          ) : null}
        </>
      ) : null}
      {inpaintEnabled && prompt.trim() ? (
        <div>
          <label>
            Расширение края (пиксели)
            <input
              type="number"
              min={1}
              max={512}
              value={padding}
              onChange={(e) => setPadding(Number(e.target.value))}
            />
          </label>
          <button
            disabled={locked || busy || !!node.props.crop || node.props.rotation !== 0}
            onClick={() => {
              setBusy(true);
              void designApi
                .outpaint(doc.id, node.id, doc.revision, prompt, padding)
                .then(async (result) => {
                  if (result.status !== 'succeeded')
                    throw new Error('Статус расширения: ' + result.status);
                  await onProposal();
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Предложить расширение краёв
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {size && (candidate || (aiMode && prompt.trim())) ? (
        <RegionMaskEditor
          key={node.id + '-' + (candidate?.id ?? 'ai')}
          width={size.width}
          height={size.height}
          sourceURL={sourceURL}
          disabled={locked || busy}
          onApply={async (mask) => {
            if (aiMode) {
              const job = await designApi.inpaint(doc.id, node.id, doc.revision, prompt, mask);
              if (job.status !== 'succeeded')
                throw new Error(
                  'Статус inpaint: ' + job.status + '; автоматическая повторная отправка запрещена',
                );
            } else {
              if (!candidate) throw new Error('Выберите кандидат');
              await designApi.regionProposal(
                doc.id,
                node.id,
                doc.revision,
                candidate.id,
                candidate.version,
                mask,
              );
            }
            await onProposal();
          }}
        />
      ) : null}
    </section>
  );
}
