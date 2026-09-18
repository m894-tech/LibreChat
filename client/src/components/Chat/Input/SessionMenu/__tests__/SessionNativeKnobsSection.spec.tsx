import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { NativeModelControls } from '~/hooks/Input/useNativeModelControls';
import SessionNativeKnobsSection from '../SessionNativeKnobsSection';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const applyChip = jest.fn();
const controls: NativeModelControls = {
  family: {
    id: 'grok-imagine-video',
    label: 'Imagine Video',
    kind: 'video',
    match: ['grok-imagine-video'],
    defaults: { resolution: '720p' },
    groups: [
      {
        id: 'resolution',
        label: 'Resolution',
        chips: [
          { id: '720p', label: '720p', apply: { resolution: '720p' } },
          { id: '1080p', label: '1080p', apply: { resolution: '1080p' } },
        ],
      },
    ],
  },
  values: { resolution: '720p' },
  payload: { family: 'grok-imagine-video', resolution: '720p' },
  applyChip,
};

describe('SessionNativeKnobsSection', () => {
  beforeEach(() => applyChip.mockClear());

  it('renders nothing without a family', () => {
    const { container } = render(
      <SessionNativeKnobsSection controls={{ family: null, values: {}, applyChip }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('applies a chip without leaving the session menu', async () => {
    const user = userEvent.setup();
    render(<SessionNativeKnobsSection controls={controls} />);
    expect(screen.getByTestId('session-native-knobs')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '1080p' }));
    expect(applyChip).toHaveBeenCalledWith(controls.family?.groups[0].chips[1]);
    expect(screen.getByTestId('session-native-knobs')).toBeInTheDocument();
  });
});
