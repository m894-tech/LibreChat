import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Controls, { defaultPageChild } from '../page-node-controls';
it('creates only registered nested containers and does not issue operations for locked content', () => {
  const root = defaultPageChild('section', 'root', null),
    text = defaultPageChild('text', 'text', 'root');
  root.locked = true;
  const operations = jest.fn();
  render(
    <Controls
      nodes={[root, text]}
      selected="text"
      disabled={false}
      onSelect={jest.fn()}
      onOperations={operations}
    />,
  );
  expect(screen.getByLabelText('Размер текста страницы')).toBeDisabled();
  expect(screen.getByText('Добавить контейнер')).toBeDisabled();
  expect(operations).not.toHaveBeenCalled();
});
it('explicit link edit delegates schema validation to normal operation path', () => {
  const root = defaultPageChild('section', 'root', null),
    link = defaultPageChild('button', 'link', 'root');
  const operations = jest.fn();
  render(
    <Controls
      nodes={[root, link]}
      selected="link"
      disabled={false}
      onSelect={jest.fn()}
      onOperations={operations}
    />,
  );
  fireEvent.blur(screen.getByLabelText('Адрес ссылки страницы'), {
    target: { value: 'https://example.org/new' },
  });
  expect(operations).toHaveBeenCalledWith([
    { type: 'setProperty', nodeId: 'link', property: 'href', value: 'https://example.org/new' },
  ]);
});
