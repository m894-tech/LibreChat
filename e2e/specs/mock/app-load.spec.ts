import { expect, test } from '@playwright/test';
import { getPrimaryE2EUser } from '../../setup/users.mock';
import { NEW_CHAT_PATH, landingModelControl } from './helpers';

test.describe('app loads cleanly', () => {
  test('authenticated user lands on a rendered chat view without runtime errors', async ({
    page,
  }) => {
    const user = getPrimaryE2EUser();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });

    await expect(page).toHaveURL(/\/c\/new$/);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('main')).toContainText(user.name);
    await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();
    /** sessionMenu ON mounts the Session pill, not a standalone "Select a model" chip. */
    await expect(landingModelControl(page).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('nav-user')).toBeVisible();

    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
    expect(pageErrors, `Unexpected runtime errors: ${pageErrors.join(', ')}`).toHaveLength(0);
  });
});
