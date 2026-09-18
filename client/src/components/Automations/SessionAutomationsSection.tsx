import { useNavigate } from 'react-router-dom';
import { Timer, ChevronRight, Pause, Play, X } from 'lucide-react';
import { Constants } from 'librechat-data-provider';
import { useAutomationsByConvQuery, useCronConvActionMutation, type ByConvResponse } from '~/data-provider/Automations';
import { useToastContext } from '@librechat/client';

const STATUS_LABEL: Record<string, string> = {
  active: 'Запланировано',
  paused: 'На паузе',
  failed: 'Ошибка',
  blocked: 'Заблокировано',
};
const KIND_LABEL: Record<string, string> = { success: 'успех', error: 'ошибка', skipped: 'пропуск' };

export default function SessionAutomationsSection({
  conversationId,
  snapshot,
}: {
  conversationId?: string | null;
  snapshot?: ByConvResponse | null;
}) {
  const navigate = useNavigate();
  const valid = !!conversationId && conversationId !== Constants.NEW_CONVO;
  const { showToast } = useToastContext();
  const byConv = useAutomationsByConvQuery(valid && !snapshot ? conversationId : null, 30000);
  const action = useCronConvActionMutation(valid ? conversationId : null);
  const data = snapshot ?? byConv.data;
  const items = data?.items ?? [];
  const executor = data?.executor;
  const busy = action.isLoading;

  const run = async (id: string, a: 'pause' | 'resume' | 'cancel') => {
    try {
      await action.mutateAsync({ id, action: a });
      showToast({ status: 'success', message: 'Состояние обновлено' });
    } catch (e: any) {
      showToast({ status: 'error', message: e?.response?.data?.error || e.message || 'Ошибка' });
    }
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
        Автоматизации
      </div>
      {valid && items.length > 0 ? (
        <div className="flex flex-col gap-1 px-2 py-1">
          {items.map((j) => {
            const last = j.last_runs?.[0];
            const lastOk = last?.kind === 'success';
            return (
              <div
                key={j.id}
                className="rounded-md border border-border-light bg-surface-secondary px-2 py-1.5 text-xs"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="min-w-0 truncate font-semibold" title={j.name}>
                    {j.name}
                  </span>
                  <span
                    className={
                      j.status === 'active'
                        ? 'shrink-0 text-green-600 dark:text-[#2CE0CE]'
                        : j.status === 'paused'
                          ? 'shrink-0 text-amber-600 dark:text-[#FFC940]'
                          : 'shrink-0 text-red-600 dark:text-[#FF4D57]'
                    }
                  >
                    {STATUS_LABEL[j.status] || j.status}
                  </span>
                </div>
                <div className="mt-0.5 text-text-secondary">
                  {j.status === 'active' && j.next_run_at
                    ? `след. запуск: ${new Date(j.next_run_at).toLocaleString('ru-RU')}`
                    : j.ended_reason === 'cancelled_by_user'
                      ? 'отменена'
                      : j.status === 'paused'
                        ? 'пауза'
                        : (j.ended_reason ?? '')}
                  {j.success_count != null && j.success_count > 0
                    ? ` · ответов: ${j.success_count}`
                    : ''}
                  {j.retry_count ? ` · повторов: ${j.retry_count}` : ''}
                </div>
                {last ? (
                  <div className={lastOk ? 'text-text-secondary' : 'text-red-600 dark:text-[#FF4D57]'}>
                    последний: {KIND_LABEL[last.kind || ''] || last.status}
                    {last.error ? ` · ${last.error}` : ''} ·{' '}
                    {new Date(last.run_at || '').toLocaleTimeString('ru-RU')}
                  </div>
                ) : null}
                <div className="mt-1 flex gap-1">
                  {j.status === 'active' ? (
                    <button
                      type="button"
                      title="Пауза"
                      disabled={busy}
                      onClick={() => run(j.id, 'pause')}
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-border-light text-zinc-400 hover:bg-surface-tertiary disabled:opacity-35"
                    >
                      <Pause className="h-3 w-3" />
                    </button>
                  ) : null}
                  {j.status === 'paused' ? (
                    <button
                      type="button"
                      title="Возобновить"
                      disabled={busy}
                      onClick={() => run(j.id, 'resume')}
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-border-light text-zinc-400 hover:bg-surface-tertiary disabled:opacity-35"
                    >
                      <Play className="h-3 w-3" />
                    </button>
                  ) : null}
                  {['active', 'paused'].includes(j.status) ? (
                    <button
                      type="button"
                      title="Отменить"
                      disabled={busy}
                      onClick={() => run(j.id, 'cancel')}
                      className="inline-flex h-6 w-6 items-center justify-center rounded border border-border-light text-zinc-400 hover:bg-surface-tertiary disabled:opacity-35"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {executor && !executor.healthy ? (
            <div className="px-1 text-[10px] text-amber-600 dark:text-[#FFC940]">
              Исполнитель недоступен — запуски задерживаются
            </div>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        disabled={!valid}
        onClick={() => navigate(`/automations/new?conv=${encodeURIComponent(conversationId || '')}`)}
        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover disabled:opacity-40"
      >
        <span className="flex items-center gap-2">
          <Timer className="icon-md" />
          Автоматизировать этот чат
        </span>
        <ChevronRight className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => navigate('/automations')}
        className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
      >
        <span>Все автоматизации</span>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
