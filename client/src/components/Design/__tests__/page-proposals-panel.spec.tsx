/**
 * @jest-environment jsdom
 */
import React from 'react';
import { request } from 'librechat-data-provider';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PageProposalsPanel from '../page-proposals-panel';

jest.mock('librechat-data-provider', () => ({
  request: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockedRequest = request as unknown as {
  get: jest.Mock;
  post: jest.Mock;
};

const pendingProposal = {
  id: 'prop-1',
  pageId: 'page-1',
  projectId: 'proj-1',
  baseRevision: 3,
  scopeIds: ['node-a'],
  operations: [{ type: 'setText', nodeId: 'node-a', value: 'Hello' }],
  status: 'pending' as const,
  author: 'user-1',
  summary: 'Update headline',
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof PageProposalsPanel>> = {}) {
  const onApplied = jest.fn().mockResolvedValue(undefined);
  const props = {
    pageId: 'page-1',
    revision: 3,
    selectedId: 'node-a' as string | null,
    readOnly: false,
    onApplied,
    ...overrides,
  };
  const utils = render(<PageProposalsPanel {...props} />);
  return { ...utils, onApplied, props };
}

describe('PageProposalsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequest.get.mockResolvedValue({ proposals: [pendingProposal] });
    mockedRequest.post.mockResolvedValue({ ok: true });
  });

  test('loads proposals for page and shows revision/status', async () => {
    renderPanel();
    await waitFor(() =>
      expect(mockedRequest.get).toHaveBeenCalledWith('/api/design/pages/page-1/proposals'),
    );
    expect(await screen.findByTestId('page-proposal-prop-1')).toBeTruthy();
    expect(screen.getByTestId('page-proposals-revision').textContent).toContain('3');
    expect(screen.getByTestId('page-proposal-status-prop-1').textContent).toContain('pending');
    expect(screen.getByTestId('page-proposal-status-prop-1').textContent).toContain(
      'baseRevision: 3',
    );
  });

  test('reloads when revision changes and ignores late list responses', async () => {
    let resolveFirst: (value: { proposals: Array<typeof pendingProposal> }) => void = () =>
      undefined;
    const first = new Promise<{ proposals: Array<typeof pendingProposal> }>((resolve) => {
      resolveFirst = resolve;
    });
    let listCount = 0;
    mockedRequest.get.mockImplementation((url: any) => {
      if (String(url).endsWith('/ai-jobs')) return Promise.resolve({ available: false, jobs: [] });
      listCount++;
      return listCount === 1
        ? first
        : Promise.resolve({ proposals: [{ ...pendingProposal, id: 'prop-2', baseRevision: 4 }] });
    });

    const { rerender, onApplied } = renderPanel({ revision: 3 });
    rerender(
      <PageProposalsPanel
        pageId="page-1"
        revision={4}
        selectedId="node-a"
        readOnly={false}
        onApplied={onApplied}
      />,
    );

    await waitFor(() => expect(listCount).toBe(2));
    resolveFirst({ proposals: [{ ...pendingProposal, id: 'stale' }] });
    expect(await screen.findByTestId('page-proposal-prop-2')).toBeTruthy();
    expect(screen.queryByTestId('page-proposal-stale')).toBeNull();
  });

  test('posts structured setText proposal with selected scope and clears inputs on success', async () => {
    mockedRequest.post.mockResolvedValueOnce({ proposal: pendingProposal });
    renderPanel();
    await screen.findByTestId('page-proposal-prop-1');

    fireEvent.change(screen.getByTestId('page-proposal-summary'), {
      target: { value: 'Fix copy' },
    });
    fireEvent.change(screen.getByTestId('page-proposal-text'), {
      target: { value: 'New text' },
    });
    fireEvent.click(screen.getByTestId('page-proposal-submit'));

    await waitFor(() =>
      expect(mockedRequest.post).toHaveBeenCalledWith('/api/design/pages/page-1/proposals', {
        baseRevision: 3,
        scopeIds: ['node-a'],
        summary: 'Fix copy',
        operations: [{ type: 'setText', nodeId: 'node-a', value: 'New text' }],
      }),
    );
    await waitFor(() =>
      expect((screen.getByTestId('page-proposal-text') as HTMLTextAreaElement).value).toBe(''),
    );
    expect((screen.getByTestId('page-proposal-summary') as HTMLInputElement).value).toBe('');
  });

  test('preserves textarea and summary when create fails', async () => {
    mockedRequest.post.mockRejectedValueOnce({
      response: { status: 409, data: { code: 'revision_mismatch', message: 'Page changed' } },
    });
    renderPanel();
    await screen.findByTestId('page-proposal-prop-1');

    fireEvent.change(screen.getByTestId('page-proposal-summary'), {
      target: { value: 'Keep me' },
    });
    fireEvent.change(screen.getByTestId('page-proposal-text'), {
      target: { value: 'Preserve this' },
    });
    fireEvent.click(screen.getByTestId('page-proposal-submit'));

    expect((await screen.findByTestId('page-proposals-error')).textContent).toContain(
      'Page changed',
    );
    expect((screen.getByTestId('page-proposal-text') as HTMLTextAreaElement).value).toBe(
      'Preserve this',
    );
    expect((screen.getByTestId('page-proposal-summary') as HTMLInputElement).value).toBe('Keep me');
  });

  test('accept calls endpoint then onApplied', async () => {
    const { onApplied } = renderPanel();
    await screen.findByTestId('page-proposal-prop-1');

    fireEvent.click(screen.getByTestId('page-proposal-accept-prop-1'));
    await waitFor(() =>
      expect(mockedRequest.post).toHaveBeenCalledWith(
        '/api/design/page-proposals/prop-1/accept',
        {},
      ),
    );
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  });

  test('reject calls endpoint and does not auto-apply', async () => {
    const { onApplied } = renderPanel();
    await screen.findByTestId('page-proposal-prop-1');

    fireEvent.click(screen.getByTestId('page-proposal-reject-prop-1'));
    await waitFor(() =>
      expect(mockedRequest.post).toHaveBeenCalledWith(
        '/api/design/page-proposals/prop-1/reject',
        {},
      ),
    );
    expect(onApplied).not.toHaveBeenCalled();
  });

  test('readOnly disables create/accept/reject actions', async () => {
    renderPanel({ readOnly: true });
    await screen.findByTestId('page-proposal-prop-1');
    expect((screen.getByTestId('page-proposal-submit') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('page-proposal-summary') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('page-proposal-text') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByTestId('page-proposal-accept-prop-1') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByTestId('page-proposal-reject-prop-1') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test('submit stays disabled without selectedId', async () => {
    renderPanel({ selectedId: null });
    await screen.findByTestId('page-proposals-no-selection');
    fireEvent.change(screen.getByTestId('page-proposal-summary'), { target: { value: 'x' } });
    fireEvent.change(screen.getByTestId('page-proposal-text'), { target: { value: 'y' } });
    expect((screen.getByTestId('page-proposal-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(mockedRequest.post).not.toHaveBeenCalled();
  });
});
