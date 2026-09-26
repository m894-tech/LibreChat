import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import DraftPreview from '../draft-preview';
jest.mock('../api', () => ({ designApi: { listDocumentDrafts: jest.fn().mockResolvedValue([]) } }));
jest.mock('../canvas', () => ({ __esModule: true, default: () => null }));
const doc: any = { id: 'd1', revision: 1, payload: { nodes: [] } };
it('does not advertise generation when unavailable', () => {
  render(
    <DraftPreview
      document={doc}
      enabled={false}
      readOnly={false}
      assetUrls={{}}
      onProposal={async () => {}}
    />,
  );
  expect(screen.getByText('Потоковая генерация не настроена')).toBeInTheDocument();
  expect(screen.queryByText('Сформировать превью')).not.toBeInTheDocument();
});
it('requires brief and explicit whole-document authorization', () => {
  render(
    <DraftPreview
      document={doc}
      enabled={true}
      readOnly={false}
      assetUrls={{}}
      onProposal={async () => {}}
    />,
  );
  const start = screen.getByText('Сформировать превью');
  expect(start).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Бриф макета'), { target: { value: 'Create promotion' } });
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(start).not.toBeDisabled();
});
