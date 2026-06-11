// Smoke test — proves the harness is wired up correctly before any real test
// runs. Verifies Chromium launches, the live deployment is reachable, and the
// login page renders with the username/password fields the login helper
// expects. Delete or skip this file once the suite is stable.

import { test, expect } from '@playwright/test';
import { config } from '../helpers/env';

test('smoke: login page reachable with expected fields', async ({ page }) => {
  const res = await page.goto(config.webBase + '/login');
  expect(res?.ok(), `GET /login returned ${res?.status()}`).toBe(true);
  await expect(page.locator('input[name="username"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('input[name="password"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
});
