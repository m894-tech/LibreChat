import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PageWorkspace from '../page-workspace';
import { designApi } from '../api';
jest.mock('../page-proposals-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('../api', () => ({
  designApi: {
    listPages: jest.fn(),
    listBrands: jest.fn(),
    createPage: jest.fn(),
    getPage: jest.fn(),
    pageHistory: jest.fn(),
    applyPage: jest.fn(),
  },
  downloadBlob: jest.fn(),
}));
const fixture: any = {
  id: 'p1',
  projectId: 'proj',
  revision: 1,
  document: {
    kind: 'web',
    schemaVersion: 1,
    title: 'Page',
    viewport: { desktop: 1024, mobile: 375 },
    assetRefs: [],
    nodes: [
      {
        id: 'root',
        type: 'section',
        parentId: null,
        locked: false,
        props: { direction: 'column', gap: 12, padding: 20, background: '#FFFFFF' },
      },
      {
        id: 'heading',
        type: 'text',
        parentId: 'root',
        locked: false,
        props: { text: 'Тестовая страница', size: 20, color: '#000000', weight: 400 },
      },
    ],
  },
};
beforeEach(() => {
  URL.revokeObjectURL = jest.fn();
  jest.clearAllMocks();
  (designApi.listPages as jest.Mock).mockResolvedValue([fixture]);
  (designApi.listBrands as jest.Mock).mockResolvedValue([]);
  (designApi.getPage as jest.Mock).mockResolvedValue(fixture);
  (designApi.pageHistory as jest.Mock).mockResolvedValue([]);
});
it('renders stored registered page and mobile width without executable markup', async () => {
  render(<PageWorkspace projectId="proj" readOnly={false} onBack={jest.fn()} />);
  await waitFor(() =>
    expect(screen.getByLabelText('Страницы').querySelector('option[value=p1]')).not.toBeNull(),
  );
  fireEvent.change(screen.getByLabelText('Страницы'), { target: { value: 'p1' } });
  await screen.findByText('Тестовая страница');
  fireEvent.click(screen.getByText('Mobile'));
  expect(screen.getByTestId('registered-page')).toHaveStyle({ width: '375px' });
});
it('viewer cannot create or write selected node', async () => {
  render(<PageWorkspace projectId="proj" readOnly onBack={jest.fn()} />);
  expect(
    screen
      .getAllByRole('button', { name: 'Создать страницу' })
      .every((b) => (b as HTMLButtonElement).disabled),
  ).toBe(true);
  await waitFor(() =>
    expect(screen.getByLabelText('Страницы').querySelector('option[value=p1]')).not.toBeNull(),
  );
  fireEvent.change(screen.getByLabelText('Страницы'), { target: { value: 'p1' } });
  fireEvent.click(await screen.findByText('Тестовая страница'));
  expect(screen.getByLabelText('Текст страницы')).toBeDisabled();
  expect(screen.getByText('Сохранить текст')).toBeDisabled();
});

it('interaction mode disables edit controls and opens only safe links', async () => {
  const linked = JSON.parse(JSON.stringify(fixture));
  linked.document.nodes.push({
    id: 'link',
    type: 'button',
    parentId: 'root',
    locked: false,
    props: { label: 'Docs', href: 'https://example.org/docs' },
  });
  (designApi.getPage as jest.Mock).mockResolvedValue(linked);
  render(<PageWorkspace projectId="proj" readOnly={false} onBack={jest.fn()} />);
  await waitFor(() =>
    expect(screen.getByLabelText('Страницы').querySelector('option[value=p1]')).not.toBeNull(),
  );
  fireEvent.change(screen.getByLabelText('Страницы'), { target: { value: 'p1' } });
  await screen.findByText('Docs');
  fireEvent.click(screen.getByText('Режим взаимодействия'));
  expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText('Добавить текст')).toBeDisabled();
});

it('does not discard unsaved page text on back/navigation or other property action', async () => {
  const back = jest.fn();
  render(<PageWorkspace projectId="proj" readOnly={false} onBack={back} />);
  await waitFor(() =>
    expect(screen.getByLabelText('Страницы').querySelector('option[value=p1]')).not.toBeNull(),
  );
  fireEvent.change(screen.getByLabelText('Страницы'), { target: { value: 'p1' } });
  fireEvent.click(await screen.findByText('Тестовая страница'));
  fireEvent.change(screen.getByLabelText('Текст страницы'), { target: { value: 'Unsaved local' } });
  fireEvent.click(screen.getByText('Назад к холсту'));
  expect(back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Добавить текст'));
  expect(designApi.applyPage).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Текст страницы')).toHaveValue('Unsaved local');
});
