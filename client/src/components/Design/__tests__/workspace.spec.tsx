import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DesignWorkspace from '../DesignWorkspace';
import { R1_SYSTEMS } from '../systems';
import { designApi } from '../api';
const mockDoc: any = {
  id: 'd1',
  projectId: 'p1',
  kind: 'canvas',
  schemaVersion: 1,
  title: 'Canvas',
  revision: 1,
  designSystem: { id: 'neutral-business', version: '1.0.0' },
  payload: { width: 1080, height: 1350, nodes: [] },
  assetRefs: [],
  archived: false,
};
jest.mock('../api', () => ({
  designApi: {
    listSystems: jest.fn(),
    probeCapabilities: jest.fn(),
    listProjects: jest.fn(),
    listDocuments: jest.fn(),
    getDocument: jest.fn(),
    listProposals: jest.fn(),
    listGenerationJobs: jest.fn(),
    listHistory: jest.fn(),
    projectSystems: jest.fn(),
    applyOperations: jest.fn(),
  },
  parseDesignError: (e: any) => ({ status: e.status ?? 0, message: e.message ?? 'error' }),
  downloadBlob: jest.fn(),
}));
jest.mock('../image-edit-jobs', () => ({ __esModule: true, default: () => null }));
jest.mock('../reference-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('../brand-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('../review-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('../canvas', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-canvas" />,
}));
jest.mock('../inspector', () => ({
  __esModule: true,
  default: ({ onOperations, readOnly }: any) => (
    <button
      disabled={readOnly}
      onClick={() => onOperations([{ type: 'setText', nodeId: 't1', value: 'Локальный текст' }])}
    >
      Test edit
    </button>
  ),
}));
jest.mock('../layers', () => ({ __esModule: true, default: () => null }));
jest.mock('../chat', () => ({ __esModule: true, default: () => null }));
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/?documentId=d1');
  mockDoc.payload.nodes = [
    {
      id: 't1',
      type: 'text',
      parentId: null,
      locked: false,
      props: {
        x: 0,
        y: 0,
        width: 300,
        height: 80,
        rotation: 0,
        opacity: 1,
        text: 'Original',
        fontSize: 14,
        fontFamily: 'Inter',
        fill: '#000000',
      },
      bindings: {},
    },
  ];
  (designApi.listSystems as jest.Mock).mockResolvedValue({ systems: R1_SYSTEMS, source: 'server' });
  (designApi.probeCapabilities as jest.Mock).mockResolvedValue({
    textPrompt: false,
    imageUpload: false,
    proposals: true,
  });
  (designApi.listProjects as jest.Mock).mockResolvedValue([
    {
      id: 'p1',
      name: 'One',
      ownerId: 'owner',
      members: { owner: 'owner' },
      effectiveRole: 'owner',
    },
    { id: 'p2', name: 'Two', members: { owner: 'owner' }, effectiveRole: 'owner' },
  ]);
  (designApi.listDocuments as jest.Mock).mockResolvedValue([mockDoc]);
  (designApi.getDocument as jest.Mock).mockResolvedValue(mockDoc);
  (designApi.listProposals as jest.Mock).mockResolvedValue([]);
  (designApi.listGenerationJobs as jest.Mock).mockResolvedValue([]);
  (designApi.listHistory as jest.Mock).mockResolvedValue([]);
  (designApi.projectSystems as jest.Mock).mockResolvedValue(R1_SYSTEMS);
});
it('loads deep link with actual backend role rather than inspecting other member roles', async () => {
  (designApi.listProjects as jest.Mock).mockResolvedValue([
    { id: 'p1', name: 'One', members: { other: 'owner', me: 'viewer' }, effectiveRole: 'viewer' },
  ]);
  render(<DesignWorkspace />);
  await screen.findByTestId('mock-canvas');
  expect(screen.getByTestId('design-save')).toBeDisabled();
});
it('serializes immediate save and explicit save into one request', async () => {
  let finish: (x: any) => void = () => {};
  (designApi.applyOperations as jest.Mock).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  render(<DesignWorkspace />);
  await screen.findByTestId('mock-canvas');
  fireEvent.click(screen.getByText('Test edit'));
  fireEvent.click(screen.getByTestId('design-save'));
  expect(designApi.applyOperations).toHaveBeenCalledTimes(1);
  finish({ ...mockDoc, revision: 2 });
  await waitFor(() => expect(screen.getByTestId('design-save')).not.toBeDisabled());
});
it('retains conflicting draft and blocks switching project', async () => {
  (designApi.applyOperations as jest.Mock).mockRejectedValue({ status: 409, message: 'Conflict' });
  render(<DesignWorkspace />);
  await screen.findByTestId('mock-canvas');
  fireEvent.click(screen.getByText('Test edit'));
  await screen.findByText(/Конфликт ревизии/);
  fireEvent.change(screen.getByTestId('design-project-list'), { target: { value: 'p2' } });
  expect(screen.getByTestId('design-project-list')).toHaveValue('p1');
  expect(screen.getByTestId('mock-canvas')).toBeInTheDocument();
  expect(screen.getByText(/Сначала сохраните или разрешите конфликт/)).toBeInTheDocument();
});
it('ignores stale document load after switching to another project', async () => {
  window.history.replaceState(null, '', '/');
  let resolveOld: (x: any) => void = () => {};
  (designApi.getDocument as jest.Mock).mockImplementation(
    () => new Promise((r) => (resolveOld = r)),
  );
  render(<DesignWorkspace />);
  await waitFor(() => expect(screen.getByTestId('design-project-list')).toHaveValue('p1'));
  await waitFor(() =>
    expect(
      screen.getByTestId('design-document-list').querySelector('option[value=d1]'),
    ).not.toBeNull(),
  );
  fireEvent.change(screen.getByTestId('design-document-list'), { target: { value: 'd1' } });
  fireEvent.change(screen.getByTestId('design-project-list'), { target: { value: 'p2' } });
  resolveOld(mockDoc);
  await waitFor(() => expect(screen.getByTestId('design-project-list')).toHaveValue('p2'));
  expect(screen.queryByTestId('mock-canvas')).not.toBeInTheDocument();
});
