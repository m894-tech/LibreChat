import React from 'react';
import { Provider } from 'jotai';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import type { ContextCounterViewModel } from '../types';
import {
  staleVm,
  normalVm,
  noLimitVm,
  overflowVm,
  calculatingVm,
  unavailableVm,
  errorVm,
} from '../fixtures';
import { ContextCounterIndicator } from '../Indicator';
import { changeLanguageSafely } from '~/locales/i18n';
import { useContextCounterFormatter } from '../hooks';
import { MiniIndicator } from '../MiniIndicator';

const actions = { recalculate: jest.fn(), compress: jest.fn() };

function Mini({ vm }: { vm: ContextCounterViewModel }) {
  const format = useContextCounterFormatter();
  return <MiniIndicator vm={vm} format={format} />;
}

beforeAll(async () => {
  await changeLanguageSafely('en');
});

describe('MiniIndicator — §9 table', () => {
  it.each([
    ['fresh', normalVm, '≈90.1 / 451.3K 20%', undefined],
    ['no limit', noLimitVm, '≈90.1K', undefined],
    ['calculating', calculatingVm, 'calculating…', 'true'],
    ['stale', staleVm, '≈90.1 / 451.3K 20% · outdated', 'true'],
    ['overflow', overflowVm, '≈487.0 / 451.3K 108%', undefined],
    ['unavailable', unavailableVm, 'no data', 'true'],
    ['error', errorVm, 'no data', 'true'],
  ])('%s', (_name, vm, text, dimmed) => {
    render(<Mini vm={vm} />);
    const mini = screen.getByTestId('cc-mini');
    expect(mini).toHaveTextContent(text);
    if (dimmed == null) {
      expect(mini).not.toHaveAttribute('data-dimmed');
    } else {
      expect(mini).toHaveAttribute('data-dimmed', dimmed);
    }
  });
});

describe('ContextCounterIndicator — menu shell', () => {
  it('keeps the toggle mode and the mini-indicator after the menu closes (§10.14/29)', async () => {
    const user = userEvent.setup();
    render(
      <Provider>
        <ContextCounterIndicator vm={normalVm} actions={actions} />
      </Provider>,
    );
    const trigger = screen.getByTestId('context-counter');
    expect(trigger).toHaveAttribute('aria-label', 'Context: ≈90.1 / 451.3K 20%');

    await user.click(trigger);
    const toggle = await screen.findByTestId('cc-mode-toggle');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('cc-menu')).not.toBeInTheDocument());
    expect(screen.getByTestId('cc-mini')).toHaveTextContent('≈90.1 / 451.3K 20%');

    await user.click(trigger);
    expect(await screen.findByTestId('cc-mode-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('agrees with the menu on status and precision (§10.33)', async () => {
    const user = userEvent.setup();
    render(
      <Provider>
        <ContextCounterIndicator vm={calculatingVm} actions={actions} />
      </Provider>,
    );
    expect(screen.getByTestId('cc-mini')).toHaveTextContent('calculating…');
    await user.click(screen.getByTestId('context-counter'));
    expect(await screen.findByTestId('cc-status')).toHaveTextContent('Calculating context');
    expect(screen.getByTestId('cc-header-value')).toHaveTextContent('≈');
  });
});
