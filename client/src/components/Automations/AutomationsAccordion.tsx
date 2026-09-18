import { useNavigate } from 'react-router-dom';
import { Plus, Timer } from 'lucide-react';
import { Button } from '@librechat/client';
import { useAutomationsListQuery } from '~/data-provider/Automations';
import { useLocalize } from '~/hooks';

/** Side-panel entry: short list + open full page. */
export default function AutomationsAccordion() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const list = useAutomationsListQuery();
  const items = (list.data?.items || [])
    .filter((x) => !['completed', 'cancelled'].includes(x.status))
    .slice(0, 8);

  return (
    <div className="flex h-auto w-full flex-col gap-2 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-text-primary">{localize('com_ui_automations')}</div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => navigate('/automations/new')}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/automations')}>
            Открыть
          </Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-md border border-border-light">
        {list.isLoading ? (
          <div className="p-3 text-xs text-text-secondary">Загрузка…</div>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2 p-3 text-xs text-text-secondary">
            <Timer className="h-4 w-4" />
            {localize('com_ui_automations_empty')}
          </div>
        ) : (
          items.map((x) => (
            <button
              key={x.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 border-b border-border-light px-2 py-2 text-left last:border-b-0 hover:bg-surface-hover"
              onClick={() => navigate(`/automations/cron:${encodeURIComponent(x.id)}`)}
            >
              <span className="truncate text-xs font-semibold text-text-primary">{x.name}</span>
              <span className="shrink-0 font-mono text-[10px] uppercase text-text-secondary">{x.status}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
