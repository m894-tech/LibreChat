import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewPanel from '../review-panel';
import { designApi } from '../api';
jest.mock('../api', () => ({
  designApi: {
    reviewComments: jest.fn(),
    approvalStatus: jest.fn(),
    addReviewComment: jest.fn(),
    approveRevision: jest.fn(),
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  (designApi.reviewComments as jest.Mock).mockResolvedValue([]);
  (designApi.approvalStatus as jest.Mock).mockResolvedValue({ isCurrentApproved: false });
});
it('viewer cannot write comments or approve', async () => {
  render(<ReviewPanel documentId="d1" revision={1} selectedId={null} readOnly owner={false} />);
  await screen.findByText('Версия 1 не согласована');
  expect(screen.getByText('Добавить комментарий')).toBeDisabled();
  expect(screen.getByText('Согласовать эту версию')).toBeDisabled();
});
it('owner approves exact displayed revision', async () => {
  (designApi.approveRevision as jest.Mock).mockResolvedValue(undefined);
  render(<ReviewPanel documentId="d1" revision={3} selectedId={null} readOnly={false} owner />);
  await screen.findByText('Версия 3 не согласована');
  fireEvent.click(screen.getByText('Согласовать эту версию'));
  await waitFor(() => expect(designApi.approveRevision).toHaveBeenCalledWith('d1', 3));
});
