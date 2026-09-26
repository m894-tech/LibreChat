import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GenerationJobs from '../generation-jobs';
import { designApi } from '../api';
jest.mock('../api', () => ({
  designApi: { listGenerationJobs: jest.fn(), cancelGenerationJob: jest.fn() },
}));
afterEach(() => jest.clearAllMocks());
it('shows persistent uncertain result without resubmit or cancel button', async () => {
  (designApi.listGenerationJobs as jest.Mock).mockResolvedValue([
    {
      id: 'job1',
      status: 'submission_unknown',
      documentId: 'd',
      capability: 'imageGeneration',
      cancelRequested: false,
    },
  ]);
  render(<GenerationJobs documentId="d" readOnly={false} onResult={jest.fn()} />);
  expect(await screen.findByText(/повторная оплата заблокирована/)).toBeInTheDocument();
  expect(screen.queryByText('Запросить отмену')).not.toBeInTheDocument();
});
it('requests cancellation once and keeps status as requested', async () => {
  (designApi.listGenerationJobs as jest.Mock)
    .mockResolvedValueOnce([
      {
        id: 'job1',
        status: 'running',
        documentId: 'd',
        capability: 'textProposal',
        cancelRequested: false,
      },
    ])
    .mockResolvedValue([
      {
        id: 'job1',
        status: 'running',
        documentId: 'd',
        capability: 'textProposal',
        cancelRequested: true,
      },
    ]);
  (designApi.cancelGenerationJob as jest.Mock).mockResolvedValue(undefined);
  render(<GenerationJobs documentId="d" readOnly={false} onResult={jest.fn()} />);
  fireEvent.click(await screen.findByText('Запросить отмену'));
  await waitFor(() => expect(designApi.cancelGenerationJob).toHaveBeenCalledWith('job1'));
  expect(await screen.findByText(/отмена запрошена/)).toBeInTheDocument();
});
