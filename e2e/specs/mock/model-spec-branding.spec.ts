import { expect, test } from '@playwright/test';
import { getPrimaryE2EUser } from '../../setup/users.mock';
import { NEW_CHAT_PATH, openModelSelector, selectModelSpec } from './helpers';

/** Spec with `showOnLanding: true` and an HTML `description` in e2e/config/librechat.e2e.yaml. */
const BRANDED_SPEC = {
  label: 'E2E Branded',
  descriptionText: 'Branded answers',
  descriptionIcon: '/assets/openai.svg',
};

/** The `softDefault: true` spec does not set `showOnLanding`, so it is unbranded. */
const UNBRANDED_SPEC_LABEL = 'E2E Soft Default';

test.describe('model spec branding on landing', () => {
  test('branded spec replaces the greeting with its label and rendered description', async ({
    page,
  }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectModelSpec(page, BRANDED_SPEC.label);

    const main = page.getByRole('main');
    await expect(main).toContainText(BRANDED_SPEC.label);
    await expect(main).toContainText(BRANDED_SPEC.descriptionText);
    await expect(main.locator(`img[src$="${BRANDED_SPEC.descriptionIcon}"]`)).toBeVisible();

    const user = getPrimaryE2EUser();
    await expect(main).not.toContainText(user.name);
  });

  test('unbranded spec keeps the personalized greeting', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });
    await selectModelSpec(page, UNBRANDED_SPEC_LABEL);

    const user = getPrimaryE2EUser();
    await expect(page.getByRole('main')).toContainText(user.name);
  });

  test('branded spec renders its description in the model selector', async ({ page }) => {
    await page.goto(NEW_CHAT_PATH, { timeout: 10000 });

    /** sessionMenu ON: Session pill → sheet → model search (same as openModelSelector). */
    await openModelSelector(page);

    const search = page.locator('#model-search');
    await expect(search).toBeVisible({ timeout: 10000 });
    await search.click({ timeout: 5000 });
    await search.fill('');
    await search.pressSequentially(BRANDED_SPEC.label, { delay: 15 });
    const option = page.getByRole('option', { name: new RegExp(BRANDED_SPEC.label) });
    await expect(option.first()).toBeVisible({ timeout: 15000 });
    await expect(option.first()).toContainText(BRANDED_SPEC.descriptionText);
    await expect(
      option.first().locator(`img[src$="${BRANDED_SPEC.descriptionIcon}"]`),
    ).toBeVisible();
  });
});
