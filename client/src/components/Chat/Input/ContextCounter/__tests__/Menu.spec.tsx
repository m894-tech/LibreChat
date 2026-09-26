import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within, waitFor } from '@testing-library/react';
import type { ContextCounterMode, ContextCounterViewModel } from '../types';
import {
  errorVm,
  staleVm,
  normalVm,
  noLimitVm,
  partialVm,
  overflowVm,
  trimmedVm,
  emptyChatVm,
  streamingVm,
  exhaustedVm,
  compressingVm,
  calculatingVm,
  unavailableVm,
  modelChangedVm,
  toolsChangedVm,
  lastCallMismatchVm,
  lastCallServerEstimateVm,
} from '../fixtures';
import { changeLanguageSafely } from '~/locales/i18n';
import { ContextCounterMenu } from '../Menu';

const actions = { recalculate: jest.fn(), compress: jest.fn() };

function Harness({
  vm,
  initialMode = 'next',
}: {
  vm: ContextCounterViewModel;
  initialMode?: ContextCounterMode;
}) {
  const [mode, setMode] = React.useState<ContextCounterMode>(initialMode);
  return <ContextCounterMenu vm={vm} mode={mode} onModeChange={setMode} actions={actions} />;
}

const bottomControls = () => screen.queryAllByTestId(/^cc-action-(recalculate|compress|waiting)$/);

beforeAll(async () => {
  await changeLanguageSafely('en');
});

describe('ContextCounterMenu — header, toggle and modes', () => {
  it('renders the next-request estimate with ≈, a shared unit and a percent of B', () => {
    render(<Harness vm={normalVm} />);
    expect(screen.getByTestId('cc-header-value')).toHaveTextContent('≈90.1 / 451.3K');
    expect(screen.getByTestId('cc-header-percent')).toHaveTextContent('20%');
    expect(screen.getByTestId('cc-mode-toggle')).toHaveTextContent(
      'Next request · server estimate',
    );
    expect(screen.getByTestId('cc-mode-toggle')).not.toHaveTextContent('provider data');
    expect(screen.getByTestId('cc-last-call-model')).toHaveTextContent(
      'Model: claude-sonnet-4 · provider data',
    );
  });

  it('toggles next ↔ last with aria-pressed and swaps the header, bar and label (§10.29)', async () => {
    const user = userEvent.setup();
    render(<Harness vm={normalVm} />);
    const toggle = screen.getByTestId('cc-mode-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('cc-action-compress')).toHaveTextContent('Compact context');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveTextContent('Last call · provider data');
    expect(screen.getByTestId('cc-header-value')).toHaveTextContent('72.0 / 112.0K');
    expect(screen.getByTestId('cc-header-value')).not.toHaveTextContent('≈');
    expect(screen.getByTestId('cc-header-percent')).toHaveTextContent('64%');
    expect(screen.getByTestId('cc-last-call-row')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('cc-next-line')).toHaveTextContent('Next request');
    expect(screen.getByTestId('cc-action-compress')).toHaveTextContent(
      'Compact history before the next request',
    );

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('distinguishes a confirmed total from an estimated composition (§10.6)', async () => {
    const user = userEvent.setup();
    render(<Harness vm={normalVm} />);
    await user.click(screen.getByTestId('cc-mode-toggle'));
    expect(screen.getByTestId('cc-header-value')).not.toHaveTextContent('≈');
    expect(screen.getByTestId('cc-row-messages')).toHaveTextContent('≈30.0K');
    expect(screen.getByTestId('cc-status')).toHaveTextContent(
      'Total from the provider. Composition is an estimate.',
    );
  });

  it('shows «provider data» only when the source is provider usage (§10.5)', async () => {
    const user = userEvent.setup();
    render(<Harness vm={lastCallServerEstimateVm} />);
    expect(screen.getByTestId('cc-last-call-model')).toHaveTextContent('server estimate');
    await user.click(screen.getByTestId('cc-mode-toggle'));
    expect(screen.getByTestId('cc-mode-toggle')).toHaveTextContent('Last call · server estimate');
    expect(screen.getByTestId('cc-header-value')).toHaveTextContent('≈72.0 / 112.0K');
    expect(screen.queryByText(/provider data/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('cc-row-messages')).not.toBeInTheDocument();
  });
});

describe('ContextCounterMenu — one bottom button (§10.20)', () => {
  it.each([
    ['normal', normalVm, 'cc-action-compress'],
    ['overflow', overflowVm, 'cc-action-compress'],
    ['stale', staleVm, 'cc-action-recalculate'],
    ['unavailable', unavailableVm, 'cc-action-recalculate'],
    ['error', errorVm, 'cc-action-recalculate'],
    ['partial', partialVm, 'cc-action-recalculate'],
    ['calculating', calculatingVm, 'cc-action-recalculate'],
    ['streaming', streamingVm, 'cc-action-waiting'],
    ['compressing', compressingVm, 'cc-action-compress'],
  ])('%s renders exactly one bottom control', (_name, vm, expected) => {
    render(<Harness vm={vm} />);
    const controls = bottomControls();
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAttribute('data-testid', expected);
  });

  it('shows a waiting status without any button while streaming', () => {
    render(<Harness vm={streamingVm} />);
    expect(screen.getByTestId('cc-action-waiting')).toHaveTextContent(
      'Waiting for the model response',
    );
    expect(
      screen.queryByRole('button', { name: /compact|recalculate|retry/i }),
    ).not.toBeInTheDocument();
  });

  it('disables the button with a short reason during a conflicting operation (§8)', () => {
    render(<Harness vm={compressingVm} />);
    expect(screen.getByTestId('cc-action-compress')).toBeDisabled();
    expect(screen.getByTestId('cc-action-disabled-reason')).toHaveTextContent(
      'compression in progress',
    );
  });

  it('labels the error retry and wires both callbacks', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness vm={errorVm} />);
    expect(screen.getByTestId('cc-status')).toHaveTextContent('Could not recalculate');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(actions.recalculate).toHaveBeenCalledTimes(1);
    unmount();
    render(<Harness vm={overflowVm} />);
    await user.click(screen.getByTestId('cc-action-compress'));
    expect(actions.compress).toHaveBeenCalledTimes(1);
  });
});

describe('ContextCounterMenu — overflow and excluded history', () => {
  it('caps the bar at 100 while the text shows 108% (§10.18)', () => {
    render(<Harness vm={overflowVm} />);
    expect(screen.getByTestId('cc-header-percent')).toHaveTextContent('108%');
    const bar = screen.getByTestId('cc-fill-bar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', '108%');
    expect(bar).toHaveAttribute('data-overflow', 'true');
  });

  it('shows the exclusion line with the server count and pre-prune percent (§10.8)', () => {
    render(<Harness vm={overflowVm} />);
    expect(screen.getByTestId('cc-excluded-notice')).toHaveTextContent(
      '14 old messages will not be sent · 108%',
    );
  });

  it('keeps the warning after trimming even at 70% (§10.9/23)', () => {
    render(<Harness vm={trimmedVm} />);
    expect(screen.getByTestId('cc-header-percent')).toHaveTextContent('70%');
    expect(screen.getByTestId('cc-excluded-notice')).toHaveTextContent(
      '14 old messages will not be sent',
    );
  });

  it('opens «What will be left out?» as an in-menu popover without changing the route (§10.23)', async () => {
    /** jsdom lays nothing out, so Ariakit would deem every element invisible
     *  and skip the focus return; report visibility the way a browser does. */
    const proto = HTMLElement.prototype as HTMLElement & { checkVisibility?: () => boolean };
    const previous = proto.checkVisibility;
    proto.checkVisibility = () => true;
    const user = userEvent.setup();
    const pathname = window.location.pathname;
    render(<Harness vm={overflowVm} />);
    const link = screen.getByTestId('cc-excluded-link');
    await user.click(link);
    const popover = await screen.findByTestId('cc-excluded-popover');
    expect(window.location.pathname).toBe(pathname);
    expect(popover).toHaveTextContent('Does not fit the input budget');
    expect(within(popover).getAllByRole('listitem')).toHaveLength(3);
    expect(popover).toHaveTextContent('…and 11 more messages');
    expect(popover).toHaveTextContent('Nothing is deleted from the conversation.');
    expect(screen.getByTestId('cc-menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('cc-excluded-popover')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(link).toHaveFocus());
    expect(screen.getByTestId('cc-menu')).toBeInTheDocument();
    proto.checkVisibility = previous;
  });
});

describe('ContextCounterMenu — §4 states', () => {
  it('flags a model change and keeps the old percent against its own budget (§10.31)', () => {
    render(<Harness vm={modelChangedVm} />);
    expect(screen.getByTestId('cc-status')).toHaveTextContent(
      'Model changed · recalculation needed',
    );
    expect(screen.getByTestId('cc-action-recalculate')).toBeInTheDocument();
    expect(screen.getByTestId('cc-last-call-mismatch')).toHaveTextContent(
      'measured for claude-sonnet-4 · configuration differs now',
    );
    expect(screen.getByTestId('cc-last-call-row')).toHaveTextContent('64%');
  });

  it('names a tools change explicitly', () => {
    render(<Harness vm={toolsChangedVm} />);
    expect(screen.getByTestId('cc-status')).toHaveTextContent(
      'Tools changed · recalculation needed',
    );
  });

  it('shows the badge in last mode with a 1M-window model selected (§10.31)', async () => {
    const user = userEvent.setup();
    render(<Harness vm={lastCallMismatchVm} />);
    await user.click(screen.getByTestId('cc-mode-toggle'));
    expect(screen.getByTestId('cc-header-percent')).toHaveTextContent('64%');
    expect(screen.getByTestId('cc-last-call-mismatch')).toBeInTheDocument();
  });

  it('renders no percent and an indeterminate bar without a limit', () => {
    render(<Harness vm={noLimitVm} />);
    expect(screen.getByTestId('cc-header-value')).toHaveTextContent('≈90.1K');
    expect(screen.queryByTestId('cc-header-percent')).not.toBeInTheDocument();
    expect(screen.getByTestId('cc-fill-bar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByTestId('cc-status')).toHaveTextContent('Limit unknown');
  });

  it('labels an exhausted budget instead of dividing by zero', () => {
    render(<Harness vm={exhaustedVm} />);
    expect(screen.getByTestId('cc-status')).toHaveTextContent('Budget exhausted by the reserve');
    expect(screen.queryByTestId('cc-header-percent')).not.toBeInTheDocument();
    expect(screen.getByTestId('cc-menu')).not.toHaveTextContent('NaN');
  });

  it('announces calculating and marks the previous value as stale', () => {
    render(<Harness vm={calculatingVm} />);
    expect(screen.getByTestId('cc-status')).toHaveTextContent(
      'Calculating context · outdated, recalculating…',
    );
    expect(screen.getByTestId('cc-menu')).toHaveAttribute('aria-busy', 'true');
  });

  it('marks a partial estimate', () => {
    render(<Harness vm={partialVm} />);
    expect(screen.getByTestId('cc-status')).toHaveTextContent(
      'Estimate incomplete · The total may grow.',
    );
  });

  it('shows «no data» with empty rows when nothing is measured', () => {
    render(<Harness vm={unavailableVm} />);
    expect(screen.getByTestId('cc-header-value')).toHaveTextContent('no data');
    expect(screen.getByTestId('cc-last-call')).toHaveTextContent('No completed call yet');
    expect(screen.getByTestId('cc-session-usage')).toHaveTextContent('No calls yet');
  });

  it('treats an empty chat as occupied by instructions and tools', () => {
    render(<Harness vm={emptyChatVm} />);
    expect(screen.getByTestId('cc-empty-chat')).toBeInTheDocument();
    expect(screen.getByTestId('cc-header-value')).toHaveTextContent('≈79.5 / 451.3K');
    expect(screen.getByTestId('cc-header-percent')).toHaveTextContent('18%');
    expect(screen.getByTestId('cc-row-messages')).toHaveTextContent('0');
    expect(screen.getByTestId('cc-row-cache')).toHaveTextContent('—');
  });
});

describe('ContextCounterMenu — breakdown and spend (§10.19/21)', () => {
  it('shows ● rows summing to the header, ○ cache/free as reference, and branch spend in one menu', () => {
    render(<Harness vm={normalVm} />);
    expect(screen.getByTestId('cc-row-messages')).toHaveTextContent('742');
    expect(screen.getByTestId('cc-row-toolCalls')).toHaveTextContent('9.9K');
    expect(screen.getByTestId('cc-row-toolCalls')).toHaveTextContent('2%');
    expect(screen.getByTestId('cc-row-systemPrompt')).toHaveTextContent('21.1K');
    expect(screen.getByTestId('cc-row-mcpTools')).toHaveTextContent('58.4K');
    expect(screen.getByTestId('cc-row-cache')).toHaveTextContent('89.6K');
    expect(screen.getByTestId('cc-row-free')).toHaveTextContent('361.2K');
    expect(screen.getByTestId('cc-last-call')).toHaveTextContent('Last call');
    expect(screen.getByTestId('cc-session-usage')).toHaveTextContent('Session usage · this branch');
    expect(screen.getByTestId('cc-session-input')).toHaveTextContent('218.4K');
    expect(screen.getByTestId('cc-session-cache-read')).toHaveTextContent('1.6M');
    expect(screen.queryByTestId('cc-session-cache-write')).not.toBeInTheDocument();
    expect(screen.getByTestId('cc-session-usage')).toHaveTextContent(
      'Sum of calls, not window fill.',
    );
  });
});
