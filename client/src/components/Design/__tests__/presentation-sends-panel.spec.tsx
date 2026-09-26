import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Panel from '../presentation-sends-panel';
import { designApi } from '../api';
jest.mock('../api', () => ({
  designApi: { listPresentationSends: jest.fn(), reconcilePresentationSend: jest.fn() },
}));
it('unknown send can be checked without resend', async () => {
  (designApi.listPresentationSends as jest.Mock).mockResolvedValue([
    { id: 'send', sourceRevision: 1, destinationId: 'dest', status: 'submission_unknown' },
  ]);
  (designApi.reconcilePresentationSend as jest.Mock).mockResolvedValue({
    id: 'send',
    sourceRevision: 1,
    destinationId: 'dest',
    status: 'succeeded',
  });
  render(<Panel documentId="doc" readOnly={false} />);
  fireEvent.click(await screen.findByText('Проверить квитанцию — без повторной отправки'));
  await screen.findByText('Подтверждено назначением');
  expect(designApi.reconcilePresentationSend).toHaveBeenCalledWith('send');
});
it('viewer cannot reconcile writer destination', async () => {
  (designApi.listPresentationSends as jest.Mock).mockResolvedValue([
    { id: 'send', sourceRevision: 1, destinationId: 'dest', status: 'running' },
  ]);
  render(<Panel documentId="doc" readOnly />);
  expect(await screen.findByText('Проверить квитанцию — без повторной отправки')).toBeDisabled();
});
