import { createStore } from 'jotai';
import { act, renderHook } from '@testing-library/react';
import type { TContextEstimateRequest, TContextNextRequestEstimate } from 'librechat-data-provider';
import type { UseContextEstimateParams } from '../useContextEstimate';
import {
  CONVO,
  LEAF_A,
  LEAF_B,
  estimateFixture,
  lastCallFixture,
} from '~/store/contextCounter/fixtures';
import { nextEstimateFamily, lastCallFamily, applyContextEvent } from '~/store/contextCounter';
import useContextEstimate, { resetEstimateController } from '../useContextEstimate';

type Deferred = {
  body: TContextEstimateRequest;
  resolve: (estimate: TContextNextRequestEstimate) => void;
  reject: (error: unknown) => void;
};

function createRequester() {
  const calls: Deferred[] = [];
  const requester = jest.fn((body: TContextEstimateRequest) => {
    return new Promise<TContextNextRequestEstimate>((resolve, reject) => {
      calls.push({ body, resolve, reject });
    });
  });
  return { requester, calls };
}

function buildRequest(revision: number, fingerprint: string): TContextEstimateRequest {
  return {
    conversationId: CONVO,
    parentMessageId: LEAF_A,
    text: 'draft',
    files: [],
    revision,
    fingerprint,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useContextEstimate', () => {
  let store: ReturnType<typeof createStore>;
  let requester: ReturnType<typeof createRequester>;

  const setup = (overrides: Partial<UseContextEstimateParams> = {}) => {
    const initial: UseContextEstimateParams = {
      conversationId: CONVO,
      leafId: LEAF_A,
      fingerprint: 'fp-1',
      changeReason: null,
      buildRequest,
      menuOpen: false,
      isSubmitting: false,
      enabled: true,
      requester: requester.requester,
      store,
      ...overrides,
    };
    const hook = renderHook((params: UseContextEstimateParams) => useContextEstimate(params), {
      initialProps: initial,
    });
    return {
      ...hook,
      update: (next: Partial<UseContextEstimateParams>) => {
        Object.assign(initial, next);
        hook.rerender({ ...initial });
      },
    };
  };

  const entry = () => store.get(nextEstimateFamily(CONVO)).get(LEAF_A);

  beforeEach(() => {
    jest.useFakeTimers();
    store = createStore();
    requester = createRequester();
    resetEstimateController();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends nothing while the menu is closed, even as the draft changes per keystroke (§6.3)', () => {
    const hook = setup();
    for (const fp of ['fp-2', 'fp-3', 'fp-4']) {
      hook.update({ fingerprint: fp, changeReason: 'draft_changed' });
    }
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(requester.requester).not.toHaveBeenCalled();
    expect(entry()).toBeUndefined();
  });

  it('requests immediately on open and skips the request when the fingerprint is cached', async () => {
    const hook = setup();
    hook.update({ menuOpen: true });
    expect(requester.requester).toHaveBeenCalledTimes(1);
    expect(requester.calls[0].body).toMatchObject({ revision: 1, fingerprint: 'fp-1' });
    expect(entry()?.status).toBe('calculating');

    await act(async () => {
      requester.calls[0].resolve(estimateFixture());
    });
    await flush();
    expect(entry()).toMatchObject({ status: 'fresh', fingerprint: 'fp-1' });

    hook.update({ menuOpen: false });
    hook.update({ menuOpen: true });
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(requester.requester).toHaveBeenCalledTimes(1);
  });

  it('debounces changes while the menu is open (~700 ms) into one request', () => {
    const hook = setup({ menuOpen: true });
    expect(requester.requester).toHaveBeenCalledTimes(1);

    hook.update({ fingerprint: 'fp-2', changeReason: 'draft_changed' });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    hook.update({ fingerprint: 'fp-3', changeReason: 'draft_changed' });
    act(() => {
      jest.advanceTimersByTime(300);
    });
    hook.update({ fingerprint: 'fp-4', changeReason: 'draft_changed' });
    expect(requester.requester).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(699);
    });
    expect(requester.requester).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(requester.requester).toHaveBeenCalledTimes(2);
    expect(requester.calls[1].body.fingerprint).toBe('fp-4');
  });

  it('§10.15: a late answer of an older revision is ignored', async () => {
    const hook = setup({ menuOpen: true });
    hook.update({ fingerprint: 'fp-2', changeReason: 'model_changed' });
    act(() => {
      jest.advanceTimersByTime(700);
    });
    expect(requester.requester).toHaveBeenCalledTimes(2);
    expect(entry()).toMatchObject({ status: 'calculating', pendingRevision: 2 });

    const stale = estimateFixture({
      revision: 1,
      fingerprint: 'old',
      occupied: {
        messages: 1,
        toolCalls: 0,
        systemPrompt: 0,
        mcpTools: 0,
        attachments: 0,
        other: 0,
      },
    });
    await act(async () => {
      requester.calls[0].resolve(stale);
    });
    await flush();
    expect(entry()).toMatchObject({ status: 'calculating', pendingRevision: 2, estimate: null });

    const current = estimateFixture({ revision: 2 });
    await act(async () => {
      requester.calls[1].resolve(current);
    });
    await flush();
    expect(entry()).toMatchObject({ status: 'fresh', fingerprint: 'fp-2' });
    expect(entry()?.estimate).toBe(current);
  });

  it('marks a fresh forecast stale with the change reason while closed (§10.3, §10.4)', async () => {
    const hook = setup({ menuOpen: true });
    await act(async () => {
      requester.calls[0].resolve(estimateFixture());
    });
    await flush();
    hook.update({ menuOpen: false });
    hook.update({ fingerprint: 'fp-2', changeReason: 'tools_changed' });
    expect(entry()).toMatchObject({ status: 'stale', staleReason: 'tools_changed' });
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(requester.requester).toHaveBeenCalledTimes(1);
  });

  it('§10.26: Send retires the in-flight estimate and cancels the pending debounce', async () => {
    const hook = setup({ menuOpen: true });
    expect(requester.requester).toHaveBeenCalledTimes(1);
    hook.update({ fingerprint: 'fp-2', changeReason: 'draft_changed' });
    act(() => {
      jest.advanceTimersByTime(200);
    });

    hook.update({ isSubmitting: true, fingerprint: 'fp-3', changeReason: 'history_changed' });
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(requester.requester).toHaveBeenCalledTimes(1);
    expect(entry()).toMatchObject({ status: 'stale', staleReason: 'sent', pendingRevision: null });

    await act(async () => {
      requester.calls[0].resolve(estimateFixture());
    });
    await flush();
    expect(entry()?.estimate).toBeNull();
    expect(entry()?.status).toBe('stale');
  });

  it('re-estimates once the turn completes and the menu is still open', () => {
    const hook = setup({ menuOpen: true, isSubmitting: true });
    expect(requester.requester).not.toHaveBeenCalled();
    hook.update({
      isSubmitting: false,
      leafId: LEAF_B,
      fingerprint: 'fp-b',
      changeReason: 'branch_changed',
    });
    act(() => {
      jest.advanceTimersByTime(700);
    });
    expect(requester.requester).toHaveBeenCalledTimes(1);
    expect(store.get(nextEstimateFamily(CONVO)).get(LEAF_B)?.status).toBe('calculating');
  });

  it('«Пересчитать» fires immediately and bypasses the debounce', () => {
    const hook = setup({ menuOpen: true });
    hook.update({ fingerprint: 'fp-2', changeReason: 'draft_changed' });
    act(() => {
      hook.result.current.recalculate();
    });
    expect(requester.requester).toHaveBeenCalledTimes(2);
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(requester.requester).toHaveBeenCalledTimes(2);
  });

  it('§10.14: an answer arriving after unmount still lands in the conversation store', async () => {
    const hook = setup({ menuOpen: true });
    hook.unmount();
    await act(async () => {
      requester.calls[0].resolve(estimateFixture());
    });
    await flush();
    expect(entry()).toMatchObject({ status: 'fresh', fingerprint: 'fp-1' });
  });

  it('draft changes never touch lastCallMeasurement (§10.27)', () => {
    applyContextEvent(
      CONVO,
      {
        type: 'hydrate',
        leafId: LEAF_A,
        lastCall: lastCallFixture(),
      },
      store,
    );
    const before = store.get(lastCallFamily(CONVO));
    const hook = setup({ menuOpen: true });
    hook.update({ fingerprint: 'fp-2', changeReason: 'draft_changed' });
    hook.update({ fingerprint: 'fp-3', changeReason: 'attachments_changed' });
    act(() => {
      jest.advanceTimersByTime(700);
    });
    expect(store.get(lastCallFamily(CONVO))).toBe(before);
  });

  it('records the failure code and does not retry on its own', async () => {
    setup({ menuOpen: true });
    await act(async () => {
      requester.calls[0].reject({ response: { status: 429 } });
    });
    await flush();
    expect(entry()).toMatchObject({
      status: 'error',
      errorCode: 'http_429',
      pendingRevision: null,
    });
    act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(requester.requester).toHaveBeenCalledTimes(1);
  });

  it('rate-limits a burst beyond 5 by deferring, not dropping', () => {
    const hook = setup({ menuOpen: true });
    for (let i = 0; i < 6; i++) {
      act(() => {
        hook.result.current.recalculate();
      });
    }
    expect(requester.requester).toHaveBeenCalledTimes(5);
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(requester.requester).toHaveBeenCalledTimes(6);
  });
});
