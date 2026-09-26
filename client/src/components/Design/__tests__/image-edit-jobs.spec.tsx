import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ImageEditJobs from '../image-edit-jobs';
import { designApi } from '../api';
jest.mock('../api', () => ({ designApi: { imageEditJobs: jest.fn() } }));
it('shows unknown send without any resend button', async () => {
  (designApi.imageEditJobs as jest.Mock).mockResolvedValue([
    { id: 'j', kind: 'inpaint', status: 'submission_unknown' },
  ]);
  render(<ImageEditJobs documentId="d" onRefreshProposals={jest.fn()} />);
  expect(await screen.findByText(/Повторного запроса к модели не будет/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
it('ready proposal refresh does not invoke image provider', async () => {
  (designApi.imageEditJobs as jest.Mock).mockResolvedValue([
    { id: 'j', kind: 'outpaint', status: 'succeeded', proposalId: 'p' },
  ]);
  const refresh = jest.fn().mockResolvedValue(undefined);
  render(<ImageEditJobs documentId="d" onRefreshProposals={refresh} />);
  fireEvent.click(await screen.findByText('Обновить предложения'));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});
