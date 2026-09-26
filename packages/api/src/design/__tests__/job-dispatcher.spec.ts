import { startDesignDispatcher } from '../job-dispatcher';
it('polls serially and stops without starting further work', async () => {
  jest.useFakeTimers();
  let resolve: (x: null) => void = () => {};
  const poll = jest.fn(() => new Promise<null>((r) => (resolve = r)));
  const service: any = { claimAndProcessNext: poll };
  const d = startDesignDispatcher(service, { intervalMs: 250 });
  expect(poll).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1000);
  expect(poll).toHaveBeenCalledTimes(1);
  resolve(null);
  await Promise.resolve();
  await Promise.resolve();
  const ending = d.stop();
  await ending;
  jest.advanceTimersByTime(1000);
  expect(poll).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});
it('rejects accidental tight polling', () => {
  expect(() => startDesignDispatcher({} as any, { intervalMs: 1 })).toThrow();
});
