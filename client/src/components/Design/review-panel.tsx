import { useEffect, useState } from 'react';
import { designApi } from './api';
export default function ReviewPanel({
  documentId,
  revision,
  selectedId,
  readOnly,
  owner,
}: {
  documentId: string;
  revision: number;
  selectedId: string | null;
  readOnly: boolean;
  owner: boolean;
}) {
  const [text, setText] = useState(''),
    [comments, setComments] = useState<
      Array<{ id: string; text: string; revision: number; nodeId: string | null }>
    >([]),
    [approved, setApproved] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setError('');
    Promise.all([designApi.reviewComments(documentId), designApi.approvalStatus(documentId)])
      .then(([c, a]) => {
        if (active) {
          setComments(c);
          setApproved(a.isCurrentApproved);
        }
      })
      .catch(() => {
        if (active) setError('Согласование недоступно');
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
      setError(e instanceof Error ? e.message : 'Ошибка согласования');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="design-chat">
      <summary>Обсуждение и согласование</summary>
      <p>{approved ? `Версия ${revision} согласована` : `Версия ${revision} не согласована`}</p>
      {error ? <p role="alert">{error}</p> : null}
      <label>
        Комментарий к версии
        <textarea
          aria-label="Комментарий к версии"
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={readOnly || busy}
        />
      </label>
      <button
        disabled={readOnly || busy || !text.trim()}
        onClick={() =>
          void run(async () => {
            await designApi.addReviewComment(documentId, {
              revision,
              text,
              ...(selectedId ? { nodeId: selectedId } : {}),
            });
            setText('');
            setComments(await designApi.reviewComments(documentId));
          })
        }
      >
        Добавить комментарий
      </button>
      <button
        disabled={!owner || busy || approved || readOnly}
        onClick={() =>
          void run(async () => {
            await designApi.approveRevision(documentId, revision);
            setApproved((await designApi.approvalStatus(documentId)).isCurrentApproved);
          })
        }
      >
        Согласовать эту версию
      </button>
      {comments.map((c) => (
        <p key={c.id}>
          <small>
            Версия {c.revision}
            {c.nodeId ? ' · элемент ' + c.nodeId : ''}
          </small>
          <br />
          {c.text}
        </p>
      ))}
    </details>
  );
}
