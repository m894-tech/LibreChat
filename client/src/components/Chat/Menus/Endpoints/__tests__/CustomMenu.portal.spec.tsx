/* eslint-disable i18next/no-literal-string -- Test harness controls are not product UI. */
import React from 'react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { CustomMenu, CustomMenuItem } from '../CustomMenu';

jest.mock('@librechat/client', () => ({
  usePopoverZIndex: () => 50,
}));

function renderMenu(portal: boolean) {
  return render(
    <div role="dialog" aria-label="Session">
      <CustomMenu
        portal={portal}
        onSearch={() => undefined}
        combobox={<input id="model-search" placeholder="Search models" />}
        comboboxLabel="Search models"
        trigger={<button type="button">Select model</button>}
        defaultOpen
      >
        <CustomMenuItem>mock-model-e</CustomMenuItem>
      </CustomMenu>
    </div>,
  );
}

describe('CustomMenu portal placement', () => {
  it('portals the listbox to the document by default', async () => {
    const user = userEvent.setup();
    renderMenu(true);

    await user.click(screen.getByRole('button', { name: 'Select model' }));
    const dialog = screen.getByRole('dialog', { name: 'Session' });
    const listbox = await screen.findByRole('listbox');
    expect(dialog.contains(listbox)).toBe(false);
  });

  it('keeps the listbox inside the dialog when portal is false so options stay in the a11y tree', async () => {
    const user = userEvent.setup();
    renderMenu(false);

    await user.click(screen.getByRole('button', { name: 'Select model' }));
    const dialog = screen.getByRole('dialog', { name: 'Session' });
    const listbox = await screen.findByRole('listbox');
    expect(dialog.contains(listbox)).toBe(true);
    expect(screen.getByRole('option', { name: 'mock-model-e' })).toBeInTheDocument();
  });
});
