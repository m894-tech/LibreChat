import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from 'librechat-data-provider';

export interface PageProposalRecord {
  id: string;
  pageId: string;
  projectId: string;
  baseRevision: number;
  scopeIds: string[];
  operations: Array<{ type: string; nodeId?: string; value?: string }>;
  status: 'pending' | 'applied' | 'rejected';
  author: string;
  summary: string;
}

export interface PageProposalsPanelProps {
  pageId: string;
  revision: number;
  selectedId: string | null;
  readOnly: boolean;
  onApplied: () => Promise<void>;
}

const BASE = '/api/design';

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (
      error as { response?: { data?: { message?: string; code?: string }; status?: number } }
    ).response;
    return response?.data?.message ?? response?.data?.code ?? `HTTP ${response?.status ?? 0}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Request failed';
}

export default function PageProposalsPanel({
  pageId,
  revision,
  selectedId,
  readOnly,
  onApplied,
}: PageProposalsPanelProps) {
  const [aiAvailable, setAIAvailable] = useState(false);
  const [aiPrompt, setAIPrompt] = useState('');
  const [aiRunning, setAIRunning] = useState(false);
  const [aiJobs, setAIJobs] = useState<Array<{ id: string; status: string }>>([]);
  const [proposals, setProposals] = useState<PageProposalRecord[]>([]);
  const [summary, setSummary] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadProposals = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await request.get<{ proposals: PageProposalRecord[] }>(
        `${BASE}/pages/${encodeURIComponent(pageId)}/proposals`,
      );
      if (!mounted.current || seq !== loadSeq.current) {
        return;
      }
      setProposals(Array.isArray(result?.proposals) ? result.proposals : []);
    } catch (err) {
      if (!mounted.current || seq !== loadSeq.current) {
        return;
      }
      setError(errorMessage(err));
    } finally {
      if (mounted.current && seq === loadSeq.current) {
        setLoading(false);
      }
    }
  }, [pageId]);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals, revision]);

  useEffect(() => {
    let active = true;
    void request
      .get<{ available: boolean; jobs: Array<{ id: string; status: string }> }>(
        `${BASE}/pages/${encodeURIComponent(pageId)}/ai-jobs`,
      )
      .then((r) => {
        if (active) {
          setAIAvailable(r.available === true);
          setAIJobs(r.jobs ?? []);
        }
      })
      .catch(() => {
        if (active) setAIAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [pageId, revision, aiRunning]);
  const canSubmit =
    !readOnly &&
    !submitting &&
    !aiRunning &&
    actingId === null &&
    !loading &&
    Boolean(selectedId) &&
    summary.trim().length > 0 &&
    summary.trim().length <= 200 &&
    text.length <= 8000 &&
    text.trim().length > 0;

  async function handleSubmit() {
    if (!selectedId || readOnly || !canSubmit) {
      return;
    }
    const trimmedSummary = summary.trim();
    const trimmedText = text;
    setSubmitting(true);
    setError(null);
    try {
      await request.post(`${BASE}/pages/${encodeURIComponent(pageId)}/proposals`, {
        baseRevision: revision,
        scopeIds: [selectedId],
        summary: trimmedSummary,
        operations: [{ type: 'setText', nodeId: selectedId, value: trimmedText }],
      });
      if (!mounted.current) {
        return;
      }
      setSummary('');
      setText('');
      await loadProposals();
    } catch (err) {
      if (!mounted.current) {
        return;
      }
      setError(errorMessage(err));
    } finally {
      if (mounted.current) {
        setSubmitting(false);
      }
    }
  }

  async function handleAccept(proposalId: string) {
    if (readOnly || actingId !== null) {
      return;
    }
    setActingId(proposalId);
    setError(null);
    try {
      await request.post(`${BASE}/page-proposals/${encodeURIComponent(proposalId)}/accept`, {});
      if (!mounted.current) {
        return;
      }
      await onApplied();
      await loadProposals();
    } catch (err) {
      if (!mounted.current) {
        return;
      }
      setError(errorMessage(err));
    } finally {
      if (mounted.current) {
        setActingId(null);
      }
    }
  }

  async function handleReject(proposalId: string) {
    if (readOnly || actingId !== null) {
      return;
    }
    setActingId(proposalId);
    setError(null);
    try {
      await request.post(`${BASE}/page-proposals/${encodeURIComponent(proposalId)}/reject`, {});
      if (!mounted.current) {
        return;
      }
      await loadProposals();
    } catch (err) {
      if (!mounted.current) {
        return;
      }
      setError(errorMessage(err));
    } finally {
      if (mounted.current) {
        setActingId(null);
      }
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2 text-sm" data-testid="page-proposals-panel">
      <h2 className="font-medium text-text-primary">Предложения страницы</h2>
      {aiAvailable ? (
        <>
          <label>
            Запрос модели к выбранному тексту
            <textarea
              aria-label="AI-запрос страницы"
              maxLength={8000}
              value={aiPrompt}
              onChange={(e) => setAIPrompt(e.target.value)}
              disabled={readOnly || aiRunning}
            />
          </label>
          <button
            disabled={readOnly || aiRunning || !selectedId || !aiPrompt.trim()}
            onClick={() => {
              if (!selectedId) return;
              setAIRunning(true);
              setError(null);
              void request
                .post(`${BASE}/pages/${encodeURIComponent(pageId)}/ai-proposals`, {
                  clientId: crypto.randomUUID(),
                  expectedRevision: revision,
                  scopeIds: [selectedId],
                  prompt: aiPrompt,
                })
                .then(async (r) => {
                  if (!mounted.current) return;
                  if (r.job.status !== 'succeeded')
                    setError(
                      'Результат модели не готов: ' +
                        r.job.status +
                        '. Не повторяйте автоматически.',
                    );
                  await loadProposals();
                })
                .catch((e) => {
                  if (mounted.current) setError(errorMessage(e));
                })
                .finally(() => {
                  if (mounted.current) setAIRunning(false);
                });
            }}
          >
            Запросить AI-предложение
          </button>
        </>
      ) : (
        <p>AI-правки страницы не подключены</p>
      )}
      {aiJobs.map((j) => (
        <p key={j.id}>
          Задание:{' '}
          {j.status === 'submission_unknown'
            ? 'результат неизвестен, без автоматического повтора'
            : j.status}
        </p>
      ))}
      <p className="text-text-secondary" data-testid="page-proposals-hint">
        Явная правка выбранного текста, привязанная к версии. Это не AI-генерация. Изменение требует
        принятия.
      </p>
      <p className="text-text-secondary" data-testid="page-proposals-revision">
        Версия страницы: {revision}
      </p>
      {!selectedId ? (
        <p className="text-text-secondary" data-testid="page-proposals-no-selection">
          Выберите текстовый элемент для предложения.
        </p>
      ) : (
        <p className="text-text-secondary" data-testid="page-proposals-selected">
          Выбранный элемент: {selectedId}
        </p>
      )}
      <label htmlFor="page-proposal-summary" className="flex flex-col gap-1">
        Описание
        <input
          id="page-proposal-summary"
          data-testid="page-proposal-summary"
          className="rounded border border-border-light bg-surface-primary px-2 py-1"
          value={summary}
          maxLength={200}
          disabled={readOnly || submitting || aiRunning}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Краткое описание правки"
        />
      </label>
      <label htmlFor="page-proposal-text" className="flex flex-col gap-1">
        Предлагаемый текст
        <textarea
          id="page-proposal-text"
          data-testid="page-proposal-text"
          className="min-h-[88px] rounded border border-border-light bg-surface-primary px-2 py-1"
          value={text}
          maxLength={8000}
          disabled={readOnly || submitting || aiRunning}
          onChange={(event) => setText(event.target.value)}
          placeholder="Новый текст выбранного элемента"
        />
      </label>
      <button
        type="button"
        data-testid="page-proposal-submit"
        className="rounded border border-border-light px-2 py-1"
        disabled={!canSubmit}
        onClick={() => {
          void handleSubmit();
        }}
      >
        Создать предложение
      </button>
      {loading ? (
        <p className="text-text-secondary" data-testid="page-proposals-loading">
          Загрузка предложений…
        </p>
      ) : null}
      {error ? (
        <p className="text-red-600" data-testid="page-proposals-error" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2 overflow-auto" data-testid="page-proposals-list">
        {proposals.map((proposal) => (
          <li
            key={proposal.id}
            className="rounded border border-border-light p-2"
            data-testid={`page-proposal-${proposal.id}`}
          >
            <p className="text-text-primary">{proposal.summary}</p>
            <p className="text-text-secondary" data-testid={`page-proposal-status-${proposal.id}`}>
              status: {proposal.status} · baseRevision: {proposal.baseRevision}
            </p>
            {proposal.status === 'pending' ? (
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  data-testid={`page-proposal-accept-${proposal.id}`}
                  disabled={readOnly || actingId !== null}
                  onClick={() => {
                    void handleAccept(proposal.id);
                  }}
                >
                  Принять
                </button>
                <button
                  type="button"
                  data-testid={`page-proposal-reject-${proposal.id}`}
                  disabled={readOnly || actingId !== null}
                  onClick={() => {
                    void handleReject(proposal.id);
                  }}
                >
                  Отклонить
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
