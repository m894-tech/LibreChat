import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ReferencePanel from '../reference-panel';
import { designApi } from '../api';
jest.mock('../api', () => ({ designApi: { getReferenceLock: jest.fn() } }));
it('does not advertise live Refero search when not configured', async () => {
  (designApi.getReferenceLock as jest.Mock).mockResolvedValue({
    lock: { status: 'missing' },
    researchAvailable: false,
  });
  render(<ReferencePanel documentId="d" revision={1} readOnly={false} />);
  await waitFor(() => expect(designApi.getReferenceLock).toHaveBeenCalled());
  expect(screen.getByText(/Поиск Refero в модуле не подключён/)).toBeInTheDocument();
  expect(screen.queryByText('Найти референсы')).not.toBeInTheDocument();
});
it('existing pinned reference becomes visibly stale instead of auto changing document', async () => {
  (designApi.getReferenceLock as jest.Mock).mockResolvedValue({
    lock: {
      status: 'stale',
      lockedRevision: 1,
      decision: 'Type',
      references: [{ id: 'r', title: 'Reference', url: 'https://example.org' }],
    },
    researchAvailable: false,
  });
  render(<ReferencePanel documentId="d" revision={2} readOnly={true} />);
  expect(await screen.findByText(/документ изменён/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Reference' })).toHaveAttribute(
    'rel',
    'noopener noreferrer',
  );
});
