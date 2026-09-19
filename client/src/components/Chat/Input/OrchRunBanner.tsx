import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiBaseUrl, request } from 'librechat-data-provider';
import { cn } from '~/utils';
import {
  ensureSessionProfile,
  normalizeSessionProfileConversationId,
  SESSION_PROFILE_CHANGED_EVENT,
  type SessionOrchMode,
} from '~/utils/sessionProfiles';

type OrchRunView = {
  state?: string | null;
  resolvedMode?: string | null;
  scheduler?: string | null;
  packages?: Array<{ id: string; platform?: string; state?: string }>;
  nodes?: Array<{ id: string; state?: string; cls?: string }>;
  verdict?: { choice?: string } | null;
};

function tone(state?: string) {
  const s = String(state || '').toLowerCase();
  if (s === 'completed' || s === 'accepted') return 'ok';
  if (s === 'running') return 'run';
  if (s === 'failed' || s === 'cancelled') return 'fail';
  return 'idle';
}

function Chip({ label, state }: { label: string; state?: string }) {
  const t = tone(state);
  return (
    <span
      className={cn(
        'rounded-md border px-1.5 py-0.5 text-[10px]',
        t === 'ok' && 'border-emerald-600 text-emerald-300',
        t === 'run' && 'border-[#2CE0CE] text-[#2CE0CE]',
        t === 'fail' && 'border-red-600 text-red-300',
        t === 'idle' && 'border-zinc-700 text-zinc-500',
      )}
    >
      {label}
    </span>
  );
}

export default function OrchRunBanner({
  conversationId,
  isSubmitting,
}: {
  conversationId?: string | null;
  isSubmitting: boolean;
}) {
  const convoKey = normalizeSessionProfileConversationId(conversationId);
  const [mode, setMode] = useState<SessionOrchMode>(() => ensureSessionProfile(convoKey).orchMode);

  useEffect(() => {
    setMode(ensureSessionProfile(convoKey).orchMode);
    const onChanged = () => setMode(ensureSessionProfile(convoKey).orchMode);
    window.addEventListener(SESSION_PROFILE_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(SESSION_PROFILE_CHANGED_EVENT, onChanged);
  }, [convoKey]);

  const pollId = convoKey === 'new' ? 'new' : convoKey;
  const live =
    isSubmitting || mode === 'm2' || mode === 'm3' || mode === 'compare' || mode === 'team' || mode === 'auto';

  const q = useQuery({
    queryKey: ['orch-run-banner', pollId, isSubmitting],
    queryFn: async () => {
      try {
        return await request.get<OrchRunView>(`${apiBaseUrl()}/api/agents/orch-run/${pollId}`);
      } catch {
        return null;
      }
    },
    enabled: live && (isSubmitting || pollId !== 'new'),
    refetchInterval: isSubmitting ? 2000 : 8000,
    retry: false,
  });
  const run = q.data;

  if (mode === 'off' && !run) {
    return null;
  }

  const items =
    (run?.packages && run.packages.length
      ? run.packages.map((p) => ({ key: p.id, label: `${p.id}${p.platform ? '@' + p.platform : ''}:${p.state || ''}`, state: p.state }))
      : run?.nodes?.map((n) => ({
          key: n.id,
          label: `${n.id}${n.cls ? ' ' + n.cls : ''}:${n.state || ''}`,
          state: n.state,
        }))) || [];

  const title = (run?.resolvedMode || mode || 'orch').toUpperCase();
  const waiting = isSubmitting && !items.length;

  return (
    <div
      className="flex flex-wrap items-center gap-1 px-3 pb-1 [color-scheme:dark]"
      data-testid="orch-run-banner"
    >
      <span className="text-[10px] uppercase tracking-wide text-[#2CE0CE]">{title}</span>
      {run?.state ? <span className="text-[10px] text-zinc-400">{run.state}</span> : null}
      {run?.scheduler ? <span className="text-[10px] text-zinc-600">{run.scheduler}</span> : null}
      {waiting ? (
        <span className="text-[10px] text-[#2CE0CE]">узлы стартуют — не зависло</span>
      ) : null}
      {items.map((it) => (
        <Chip key={it.key} label={it.label} state={it.state} />
      ))}
      {run?.verdict?.choice ? (
        <Chip label={`winner ${run.verdict.choice}`} state="completed" />
      ) : null}
      {isSubmitting && items.some((it) => tone(it.state) === 'run') ? (
        <span className="text-[10px] text-zinc-500">идёт nested…</span>
      ) : null}
    </div>
  );
}
