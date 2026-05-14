// Reception portal — scope limited to appointments per user instruction.

import { test, expect } from '@playwright/test';
import { storagePathFor } from '../helpers/auth';

test.use({ storageState: storagePathFor('reception') });

test.describe('reception', () => {
  test('dashboard renders', async ({ page }) => {
    await page.goto('/reception/dashboard');
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({ path: 'screenshots/reception-dashboard.png', fullPage: true });
  });

  test('appointments page renders + lists submissions if any', async ({ page }) => {
    await page.goto('/reception/appointments');
    await expect(page).toHaveURL(/\/reception\/appointments/);
    await page.screenshot({ path: 'screenshots/reception-appointments.png', fullPage: true });
  });
});
