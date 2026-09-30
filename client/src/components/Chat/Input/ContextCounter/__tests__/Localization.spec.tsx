import React from 'react';
import { render, screen } from '@testing-library/react';
import i18n, { changeLanguageSafely } from '~/locales/i18n';
import { overflowVm, normalVm } from '../fixtures';
import { ContextCounterMenu } from '../Menu';

const actions = { recalculate: jest.fn(), compress: jest.fn() };

describe('Russian localization — §9 plurals and §5.1 formatting', () => {
  beforeAll(async () => {
    await changeLanguageSafely('ru');
  });

  afterAll(async () => {
    await changeLanguageSafely('en');
  });

  it.each([
    [1, '1 старое сообщение не войдёт в запрос'],
    [2, '2 старых сообщения не войдут в запрос'],
    [5, '5 старых сообщений не войдут в запрос'],
    [11, '11 старых сообщений не войдут в запрос'],
    [21, '21 старое сообщение не войдёт в запрос'],
    [22, '22 старых сообщения не войдут в запрос'],
  ])('picks the ICU plural form for %i (§10.32)', (count, expected) => {
    expect(i18n.t('com_ui_cc_excluded_count', { count })).toBe(expected);
  });

  it.each([
    [1, '…и ещё 1 сообщение'],
    [3, '…и ещё 3 сообщения'],
    [11, '…и ещё 11 сообщений'],
  ])('pluralizes the remainder for %i', (count, expected) => {
    expect(i18n.t('com_ui_cc_excluded_more', { count })).toBe(expected);
  });

  it('uses the summary wording when history is folded rather than dropped', () => {
    expect(i18n.t('com_ui_cc_summarized_count', { count: 3 })).toBe(
      '3 старых сообщения уйдут в резюме',
    );
  });

  it('renders the menu with comma decimals, «тыс.»/«млн» and Russian labels', () => {
    render(
      <ContextCounterMenu vm={normalVm} mode="next" onModeChange={jest.fn()} actions={actions} />,
    );
    expect(screen.getByTestId('cc-header-value')).toHaveTextContent('≈90,1 / 451,3 тыс.');
    expect(screen.getByTestId('cc-mode-toggle')).toHaveTextContent(
      'Следующий запрос · серверная оценка',
    );
    expect(screen.getByTestId('cc-row-toolCalls')).toHaveTextContent('9,9 тыс.');
    expect(screen.getByTestId('cc-session-cache-read')).toHaveTextContent('1,6 млн');
    expect(screen.getByTestId('cc-session-usage')).toHaveTextContent(
      'Расход за сессию · эта ветка',
    );
    expect(screen.getByTestId('cc-action-compress')).toHaveTextContent('Сжать контекст');
  });

  it('renders the exclusion line in Russian with the real overflow percent', () => {
    render(
      <ContextCounterMenu vm={overflowVm} mode="next" onModeChange={jest.fn()} actions={actions} />,
    );
    expect(screen.getByTestId('cc-excluded-notice')).toHaveTextContent(
      '14 старых сообщений не войдут в запрос · 108%',
    );
    expect(screen.getByTestId('cc-excluded-link')).toHaveTextContent('Что не войдёт?');
  });
});
