import { useState } from 'react';
import type { DesignCapabilities, DesignDocument, DesignProposal } from './types';
import { resolveAIScope, type AIScopeMode } from './ai-scope';
import { findNode, isEffectivelyLocked } from './document';
import { setTextOps } from './operations';
import { LABELS } from './constants';

interface ChatProps {
  document: DesignDocument;
  selectedId: string | null;
  capabilities: DesignCapabilities;
  proposals: DesignProposal[];
  busy: boolean;
  onPropose: (summary: string, operations: ReturnType<typeof setTextOps>) => void;
  onAccept: (proposalId: string) => void;
  onReject: (proposalId: string) => void;
  onGenerate?: (prompt: string, scopeIds: string[]) => void;
  onGenerateImage?: (prompt: string) => void;
}

export default function ChatPanel({
  document: doc,
  selectedId,
  capabilities,
  proposals,
  busy,
  onPropose,
  onAccept,
  onReject,
  onGenerate,
  onGenerateImage,
}: ChatProps) {
  const [text, setText] = useState('');
  const [scopeMode, setScopeMode] = useState<AIScopeMode>('element');
  const scopeIds = resolveAIScope(doc, selectedId, scopeMode);
  const selected = findNode(doc, selectedId);
  const canStructured = Boolean(
    selected && selected.type === 'text' && !isEffectivelyLocked(doc.payload.nodes, selected.id),
  );

  return (
    <div className="design-chat" data-testid="design-chat">
      <h2>{LABELS.chat}</h2>
      <p className="design-muted">{LABELS.proposalHint}</p>
      {!capabilities.textPrompt ? (
        <p className="design-muted" data-testid="design-prompt-unavailable">
          {LABELS.textPromptUnavailable}
        </p>
      ) : null}
      {!capabilities.imageGenerate && !capabilities.imageGeneration ? (
        <p className="design-muted" data-testid="design-imagegen-unavailable">
          {LABELS.imageGenUnavailable}
        </p>
      ) : null}
      <label>
        Область AI-правки
        <select
          aria-label="Область AI-правки"
          value={scopeMode}
          onChange={(e) => setScopeMode(e.target.value as AIScopeMode)}
          disabled={busy}
        >
          <option value="element">Выбранный элемент</option>
          <option value="group">Выбранная группа с вложенными элементами</option>
          <option value="document">Весь документ — явное расширение области</option>
        </select>
      </label>
      <p>Разрешено элементов: {scopeIds.length}. Блокировки остаются в силе.</p>
      <label htmlFor="design-chat-input" className="design-field">
        {LABELS.promptPlaceholder}
        <textarea
          id="design-chat-input"
          data-testid="design-chat-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={LABELS.promptPlaceholder}
        />
      </label>
      {capabilities.imageGenerate && onGenerateImage ? (
        <button
          type="button"
          disabled={busy || selected?.type !== 'image' || !text.trim()}
          onClick={() => onGenerateImage(text)}
        >
          Создать вариант изображения
        </button>
      ) : null}
      {capabilities.textPrompt && onGenerate ? (
        <button
          type="button"
          disabled={busy || !scopeIds.length || !text.trim()}
          onClick={() => onGenerate(text, scopeIds)}
        >
          Запросить AI-предложение
        </button>
      ) : null}
      <button
        type="button"
        data-testid="design-chat-send"
        disabled={busy || !canStructured || text.trim().length === 0}
        onClick={() => {
          if (!selected) {
            return;
          }
          onPropose(text.trim(), setTextOps(selected.id, text.trim()));
          setText('');
        }}
      >
        Предложить правку текста
      </button>
      {!canStructured ? (
        <p className="design-muted">Выберите текстовый незаблокированный элемент.</p>
      ) : null}
      <ul className="design-proposal-list">
        {proposals.map((proposal) => (
          <li key={proposal.id} data-testid={`design-proposal-${proposal.id}`}>
            <p>{proposal.summary}</p>
            <p className="design-muted">{proposal.status}</p>
            {proposal.status === 'pending' ? (
              <div className="design-row">
                <button type="button" disabled={busy} onClick={() => onAccept(proposal.id)}>
                  {LABELS.accept}
                </button>
                <button type="button" disabled={busy} onClick={() => onReject(proposal.id)}>
                  {LABELS.reject}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
