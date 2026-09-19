import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Spinner, useToastContext } from '@librechat/client';
import {
  useAutomationsCapabilitiesQuery,
  useAutomationCatalogsQuery,
  useCreateCronMutation,
  useCreateNativeMutation,
  type CreateCronInput,
  type SecretBindingInput,
} from '~/data-provider/Automations';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Kind =
  | 'resume_conversation'
  | 'session_reminder'
  | 'session_todo'
  | 'session_note'
  | 'script'
  | 'webhook'
  | 'native';
type Frequency = 'once' | 'hourly' | 'daily' | 'every_days' | 'weekdays' | 'weekly' | 'monthly' | 'cron';

const LABELS: Record<Kind, string> = {
  resume_conversation: 'Продолжить чат',
  session_reminder: 'Напоминание',
  session_todo: 'Добавить todo',
  session_note: 'Сохранить заметку',
  script: 'Серверный скрипт',
  webhook: 'Webhook',
  native: 'Задача ИИ в новом чате',
};

const FREQ_LABEL: Record<Frequency, string> = {
  once: 'Один раз',
  hourly: 'Каждые N часов',
  daily: 'Каждый день',
  every_days: 'Каждые N дней',
  weekdays: 'По будням',
  weekly: 'Раз в неделю',
  monthly: 'Ежемесячно',
  cron: 'Cron',
};

const field =
  'mt-1 h-9 w-full rounded-md border border-white/15 bg-black/50 px-2 text-sm text-zinc-100 placeholder:text-zinc-500 [color-scheme:dark]';
const area =
  'mt-1 min-h-24 w-full rounded-md border border-white/15 bg-black/50 p-2 text-sm text-zinc-100 placeholder:text-zinc-500 [color-scheme:dark]';
const labelCls = 'block text-xs font-medium text-zinc-300';
const sectionCls = 'mb-3 rounded-lg border border-white/10 bg-zinc-950/80 p-3';
const h2Cls = 'mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-100';

function localDateTimeToISO(value: string) {
  const d = new Date(value);
  if (!value || !Number.isFinite(+d)) {
    throw new Error('Укажите дату и время');
  }
  return d.toISOString();
}

function scheduleValue(
  freq: Frequency,
  {
    date,
    time,
    every,
    weekday,
    monthday,
    cron,
  }: { date: string; time: string; every: number; weekday: number; monthday: number; cron: string },
) {
  const [hh = '9', mm = '0'] = (time || '09:00').split(':');
  if (freq === 'once') {
    return localDateTimeToISO(date);
  }
  if (freq === 'hourly') {
    return `every ${Math.max(1, every)}h`;
  }
  if (freq === 'daily') {
    return `${Number(mm)} ${Number(hh)} * * *`;
  }
  if (freq === 'every_days') {
    return `every ${Math.max(1, every)}d`;
  }
  if (freq === 'weekdays') {
    return `${Number(mm)} ${Number(hh)} * * 1-5`;
  }
  if (freq === 'weekly') {
    return `${Number(mm)} ${Number(hh)} * * ${weekday}`;
  }
  if (freq === 'monthly') {
    return `${Number(mm)} ${Number(hh)} ${Math.min(28, Math.max(1, monthday))} * *`;
  }
  return cron.trim();
}

export default function AutomationCreatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { showToast } = useToastContext();
  const caps = useAutomationsCapabilitiesQuery();
  const catalogs = useAutomationCatalogsQuery();
  const createCron = useCreateCronMutation();
  const createNative = useCreateNativeMutation();
  const [kind, setKind] = useState<Kind>('resume_conversation');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [conv, setConv] = useState(params.get('conv') || '');
  const [generate, setGenerate] = useState(true);
  const [freq, setFreq] = useState<Frequency>('daily');
  const now = new Date(Date.now() + 60 * 60 * 1000);
  const [date, setDate] = useState(now.toISOString().slice(0, 16));
  const [time, setTime] = useState('09:00');
  const [every, setEvery] = useState(1);
  const [weekday, setWeekday] = useState(1);
  const [monthday, setMonthday] = useState(1);
  const [cron, setCron] = useState('0 9 * * 1-5');
  const [tz, setTz] = useState('Europe/Moscow');
  const [maxRuns, setMaxRuns] = useState<number | ''>('');
  const [noteKey, setNoteKey] = useState('automation_note');
  const [script, setScript] = useState('');
  const [args, setArgs] = useState('');
  const [webhook, setWebhook] = useState('');
  const [selectedServers, setSelectedServers] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [profile, setProfile] = useState('');
  const [secretPurpose, setSecretPurpose] = useState('');
  const [secretVault, setSecretVault] = useState('');
  const [secretItem, setSecretItem] = useState('');
  const [secretField, setSecretField] = useState('');
  const [secretKey, setSecretKey] = useState('Authorization');
  const [bindings, setBindings] = useState<SecretBindingInput[]>([]);

  const isNative = kind === 'native';
  const isSession = ['resume_conversation', 'session_reminder', 'session_todo', 'session_note'].includes(kind);
  const isAgent = kind === 'resume_conversation';

  const availableKinds = useMemo(
    () =>
      (Object.entries(LABELS) as [Kind, string][])
        .filter(([k]) => k !== 'native' || caps.data?.sources.native.commands?.create === true)
        .filter(([k]) => caps.data?.sources.cron.action_types?.[k] !== false || k === 'native'),
    [caps.data],
  );

  const schedule = useMemo(() => {
    try {
      return scheduleValue(freq, { date, time, every, weekday, monthday, cron });
    } catch {
      return '';
    }
  }, [freq, date, time, every, weekday, monthday, cron]);

  const toggle = (list: string[], value: string, set: (v: string[]) => void) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const addBinding = () => {
    if (!secretPurpose || !secretVault || !secretItem || !secretField || !secretKey) {
      return showToast({ status: 'error', message: 'Заполните назначение, vault, item, field и ключ назначения' });
    }
    const destination = kind === 'webhook' ? 'header' : 'env';
    setBindings([...bindings, { purpose: secretPurpose, vault: secretVault, item: secretItem, field: secretField, destination, key: secretKey }]);
    setSecretPurpose('');
    setSecretVault('');
    setSecretItem('');
    setSecretField('');
  };

  const submit = async () => {
    try {
      if (!name.trim()) {
        throw new Error('Укажите название');
      }
      if (!prompt.trim() && kind !== 'script' && kind !== 'webhook') {
        throw new Error('Укажите промпт или текст');
      }
      if (isNative) {
        if (!profile) {
          throw new Error('Выберите Native-профиль');
        }
        let nativeSchedule: CreateCronInput extends never ? never : any = null;
        if (freq === 'once') {
          nativeSchedule = { kind: 'once', at: localDateTimeToISO(date), timezone: tz };
        } else if (freq === 'hourly' || freq === 'every_days') {
          nativeSchedule = { kind: 'interval', minutes: freq === 'hourly' ? every * 60 : every * 1440, timezone: tz };
        } else {
          throw new Error('Native поддерживает только разовый запуск или интервал');
        }
        const out = await createNative.mutateAsync({
          title: name.trim(),
          prompt: prompt.trim(),
          profile,
          schedule: nativeSchedule,
          timeoutMs: 90000,
        });
        showToast({ status: 'success', message: 'Native-задача создана как черновик' });
        navigate(`/automations/native:${out.id}`);
        return;
      }
      if (isSession && !UUID.test(conv)) {
        throw new Error('Для этого действия нужен UUID существующего чата');
      }
      if (!schedule) {
        throw new Error('Проверьте расписание');
      }
      const payload: Record<string, unknown> = {};
      if (['resume_conversation', 'session_reminder', 'session_todo'].includes(kind)) {
        payload.text = prompt.trim();
      }
      if (kind === 'session_note') {
        payload.key = noteKey.trim();
        payload.value = prompt.trim();
      }
      if (kind === 'script') {
        payload.script = script;
        payload.args = args
          .split('\n')
          .map((x) => x.trim())
          .filter(Boolean);
      }
      if (kind === 'webhook') {
        payload.url = webhook;
        payload.data = { prompt: prompt.trim() };
      }
      const body: CreateCronInput = {
        name: name.trim(),
        schedule,
        timezone: tz,
        max_runs: maxRuns === '' ? null : Number(maxRuns),
        target_type: kind,
        conv,
        payload,
        agent_config: isAgent
          ? { generate, profile: null, mcpServers: selectedServers, mcpTools: selectedTools, skills: selectedSkills }
          : null,
        secret_bindings: ['script', 'webhook'].includes(kind) ? bindings : [],
      };
      const out = await createCron.mutateAsync(body);
      showToast({ status: 'success', message: 'Автоматизация создана' });
      navigate(`/automations/cron:${out.id}`);
    } catch (e: any) {
      showToast({ status: 'error', message: e?.response?.data?.error || e.message || 'Ошибка создания' });
    }
  };

  if (caps.isLoading || catalogs.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-100">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-zinc-950 text-zinc-100 [color-scheme:dark]">
      <div className="w-full p-4 pb-24">
        <button className="mb-2 text-xs font-semibold text-zinc-300 hover:text-white" onClick={() => navigate('/automations')}>
          ← К списку
        </button>
        <h1 className="mb-3 text-xl font-bold text-white">Новая автоматизация</h1>

        <section className={sectionCls}>
          <h2 className={h2Cls}>Задача</h2>
          <div className="grid gap-2 md:grid-cols-2">
            <label className={labelCls}>
              Тип
              <select className={field} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                {availableKinds.map(([k, v]) => (
                  <option key={k} value={k} className="bg-zinc-900 text-zinc-100">
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Название
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <label className={`${labelCls} mt-2`}>
            Промпт / текст
            <textarea
              className={area}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Что должен сделать агент или какое сообщение сохранить"
            />
          </label>
          {isSession ? (
            <label className={`${labelCls} mt-2`}>
              Чат (UUID)
              <input className={`${field} font-mono text-xs`} value={conv} onChange={(e) => setConv(e.target.value)} />
            </label>
          ) : null}
          {kind === 'session_note' ? (
            <label className={`${labelCls} mt-2`}>
              Ключ заметки
              <input className={field} value={noteKey} onChange={(e) => setNoteKey(e.target.value)} />
            </label>
          ) : null}
          {kind === 'script' ? (
            <>
              <label className={`${labelCls} mt-2`}>
                Скрипт
                <select className={field} value={script} onChange={(e) => setScript(e.target.value)}>
                  <option value="" className="bg-zinc-900">
                    Выберите
                  </option>
                  {catalogs.data?.scripts.map((x) => (
                    <option key={x} className="bg-zinc-900">
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label className={`${labelCls} mt-2`}>
                Аргументы, по одному в строке
                <textarea className={area} value={args} onChange={(e) => setArgs(e.target.value)} />
              </label>
            </>
          ) : null}
          {kind === 'webhook' ? (
            <label className={`${labelCls} mt-2`}>
              HTTPS URL
              <input className={field} value={webhook} onChange={(e) => setWebhook(e.target.value)} />
            </label>
          ) : null}
          {isNative ? (
            <label className={`${labelCls} mt-2`}>
              Профиль
              <select className={field} value={profile} onChange={(e) => setProfile(e.target.value)}>
                <option value="" className="bg-zinc-900">
                  Выберите
                </option>
                {caps.data?.sources.native.profiles?.map((x) => (
                  <option key={x} className="bg-zinc-900">
                    {x}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </section>

        <section className={sectionCls}>
          <h2 className={h2Cls}>Расписание</h2>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(FREQ_LABEL) as Frequency[])
              .filter((x) => !isNative || ['once', 'hourly', 'every_days'].includes(x))
              .map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => setFreq(x)}
                  className={`rounded-full border px-2 py-1 text-xs ${
                    freq === x
                      ? 'border-[#2CE0CE] bg-[#2CE0CE]/15 text-[#2CE0CE]'
                      : 'border-white/15 text-zinc-200 hover:border-white/40'
                  }`}
                >
                  {FREQ_LABEL[x]}
                </button>
              ))}
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            {freq === 'once' ? (
              <label className={labelCls}>
                Дата/время
                <input type="datetime-local" className={field} value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            ) : null}
            {['hourly', 'every_days'].includes(freq) ? (
              <label className={labelCls}>
                Каждые
                <input
                  type="number"
                  min="1"
                  className={`${field} w-20`}
                  value={every}
                  onChange={(e) => setEvery(Number(e.target.value))}
                />
              </label>
            ) : null}
            {['daily', 'weekdays', 'weekly', 'monthly'].includes(freq) ? (
              <label className={labelCls}>
                Время
                <input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} />
              </label>
            ) : null}
            {freq === 'weekly' ? (
              <label className={labelCls}>
                День
                <select className={field} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                  {[
                    [1, 'Пн'],
                    [2, 'Вт'],
                    [3, 'Ср'],
                    [4, 'Чт'],
                    [5, 'Пт'],
                    [6, 'Сб'],
                    [0, 'Вс'],
                  ].map(([v, l]) => (
                    <option key={String(v)} value={v} className="bg-zinc-900">
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {freq === 'monthly' ? (
              <label className={labelCls}>
                Число
                <input
                  type="number"
                  min="1"
                  max="28"
                  className={`${field} w-20`}
                  value={monthday}
                  onChange={(e) => setMonthday(Number(e.target.value))}
                />
              </label>
            ) : null}
            {freq === 'cron' ? (
              <label className={`${labelCls} min-w-48 flex-1`}>
                Cron
                <input className={`${field} font-mono`} value={cron} onChange={(e) => setCron(e.target.value)} />
              </label>
            ) : null}
            <label className={labelCls}>
              Timezone
              <input className={field} value={tz} onChange={(e) => setTz(e.target.value)} />
            </label>
            {!isNative ? (
              <label className={labelCls}>
                Макс. запусков
                <input
                  type="number"
                  min="1"
                  className={`${field} w-24`}
                  value={maxRuns}
                  onChange={(e) => setMaxRuns(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </label>
            ) : null}
          </div>
          <div className="mt-2 rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-xs text-[#2CE0CE]">
            {schedule || 'Некорректное расписание'}
          </div>
        </section>

        {isAgent ? (
          <section className={sectionCls}>
            <div className="mb-2 flex items-center justify-between">
              <h2 className={`${h2Cls} mb-0`}>Агент: MCP и Skills</h2>
              <label className="flex items-center gap-1 text-xs text-zinc-200">
                <input type="checkbox" checked={generate} onChange={(e) => setGenerate(e.target.checked)} /> Сгенерировать
                ответ
              </label>
            </div>
            <div className="space-y-2">
              {catalogs.data?.mcp.servers.map((s) => (
                <div key={s.name} className="rounded-md border border-white/10 bg-black/30 p-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                    <input
                      type="checkbox"
                      checked={selectedServers.includes(s.name)}
                      onChange={() => toggle(selectedServers, s.name, setSelectedServers)}
                    />
                    {s.title || s.name}
                  </label>
                  {selectedServers.includes(s.name) ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.tools.map((t) => (
                        <button
                          type="button"
                          disabled={!t.available_for_automation}
                          key={t.name}
                          onClick={() => toggle(selectedTools, t.name, setSelectedTools)}
                          className={`rounded border px-2 py-1 text-[11px] ${
                            selectedTools.includes(t.name)
                              ? 'border-[#2CE0CE] bg-[#2CE0CE]/15 text-[#2CE0CE]'
                              : 'border-white/15 text-zinc-300'
                          } ${!t.available_for_automation ? 'opacity-40' : ''}`}
                        >
                          {t.name}
                          {t.write_or_exec ? ' · write' : ''}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              <div>
                <div className="mb-1 text-xs text-zinc-300">Skills</div>
                <div className="flex flex-wrap gap-1">
                  {catalogs.data?.skills.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => toggle(selectedSkills, s.name, setSelectedSkills)}
                      className={`rounded border px-2 py-1 text-xs ${
                        selectedSkills.includes(s.name)
                          ? 'border-[#2CE0CE] bg-[#2CE0CE]/15 text-[#2CE0CE]'
                          : 'border-white/15 text-zinc-300'
                      }`}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {['script', 'webhook'].includes(kind) && catalogs.data?.secret_bindings.supported ? (
          <section className={sectionCls}>
            <h2 className={h2Cls}>Секреты: куда и зачем</h2>
            {bindings.map((b, i) => (
              <div key={i} className="mb-1 flex justify-between rounded border border-white/10 px-2 py-1 text-xs text-zinc-200">
                <span>
                  {b.purpose} → {b.destination}:{b.key}
                </span>
                <button type="button" onClick={() => setBindings(bindings.filter((_, x) => x !== i))}>
                  ×
                </button>
              </div>
            ))}
            <div className="grid gap-2 md:grid-cols-3">
              <input className={field} placeholder="Для чего" value={secretPurpose} onChange={(e) => setSecretPurpose(e.target.value)} />
              <input className={field} placeholder="Vault ID" value={secretVault} onChange={(e) => setSecretVault(e.target.value)} />
              <input className={field} placeholder="Item ID" value={secretItem} onChange={(e) => setSecretItem(e.target.value)} />
              <input className={field} placeholder="Field ID" value={secretField} onChange={(e) => setSecretField(e.target.value)} />
              <input
                className={field}
                placeholder={kind === 'webhook' ? 'Header' : 'ENV'}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={addBinding}>
                Добавить привязку
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">Значение не сохраняется в задаче и не передаётся модели.</p>
          </section>
        ) : null}

        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-zinc-950/95 p-3 backdrop-blur">
          <div className="ml-auto flex w-fit gap-2">
            <Button variant="outline" onClick={() => navigate('/automations')}>
              Отмена
            </Button>
            <Button onClick={submit} disabled={createCron.isLoading || createNative.isLoading}>
              {createCron.isLoading || createNative.isLoading ? <Spinner /> : 'Создать'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
