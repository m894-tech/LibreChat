import type { JobService } from './jobs';
export interface DesignDispatcher {
  stop(): Promise<void>;
}
/** Application-owned recovery worker, no cron. Polls serially, explicitly disposable. */
export function startDesignDispatcher(
  service: JobService,
  options: { intervalMs?: number; onError?: (code: string) => void } = {},
): DesignDispatcher {
  const interval = options.intervalMs ?? 2000;
  if (interval < 250 || interval > 60000) throw Error('Invalid dispatcher interval');
  let stopped = false;
  let running: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cycle = async () => {
    if (stopped) return;
    try {
      await service.claimAndProcessNext();
    } catch {
      options.onError?.('design_dispatch_error');
    } finally {
      if (!stopped) timer = setTimeout(schedule, interval);
    }
  };
  const schedule = () => {
    running = cycle();
  };
  schedule();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
