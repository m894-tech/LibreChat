import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HistoryPanel from '../history-panel';
import { designApi } from '../api';
jest.mock('../api', () => ({ designApi: { listHistory: jest.fn() } }));
it('restores exact historical revision and disables current one', async () => {
  (designApi.listHistory as jest.Mock).mockResolvedValue([{ revision: 3 }, { revision: 2 }]);
  const restore = jest.fn();
  render(<HistoryPanel documentId="d" revision={3} disabled={false} onRestore={restore} />);
  await waitFor(() => expect(screen.getAllByText('Восстановить как новую')).toHaveLength(2));
  const buttons = screen.getAllByText('Восстановить как новую');
  expect(buttons[0]).toBeDisabled();
  fireEvent.click(buttons[1]);
  expect(restore).toHaveBeenCalledWith(2);
});
