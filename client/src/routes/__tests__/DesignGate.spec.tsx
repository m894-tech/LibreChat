import React from 'react';
import { render, screen } from '@testing-library/react';
import DesignGate from '../DesignGate';

let mockConfig: { data?: { interface?: { design?: boolean } }; isLoading?: boolean } = {
  data: { interface: { design: false } },
  isLoading: false,
};

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => mockConfig,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock(
  '../Design',
  () => ({
    __esModule: true,
    default: () => <div>TEST_DESIGN_EDITOR</div>,
  }),
  { virtual: true },
);

describe('Design feature gate', () => {
  it('hides editor by default', () => {
    mockConfig = { data: {}, isLoading: false };
    render(<DesignGate />);
    expect(screen.getByRole('status')).toHaveTextContent('com_ui_design_disabled');
    expect(screen.queryByText('TEST_DESIGN_EDITOR')).not.toBeInTheDocument();
  });

  it('shows loading without mounting editor', () => {
    mockConfig = { isLoading: true };
    render(<DesignGate />);
    expect(screen.getByRole('status')).toHaveTextContent('com_ui_design_loading');
  });

  it('loads editor only when enabled', async () => {
    mockConfig = { data: { interface: { design: true } }, isLoading: false };
    render(<DesignGate />);
    expect(await screen.findByText('TEST_DESIGN_EDITOR')).toBeInTheDocument();
  });
});
