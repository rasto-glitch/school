// Canary spec: confirm each role's cached storage state still works.
// Driven by storageState only — no login form interaction. If a role's
// storage file is missing or expired, globalSetup either refreshed it or
// the role's test will fail here loudly.
//
// To explicitly exercise the login *form*, see specs/auth.spec.ts (TBD).

import { test, expect } from '@playwright/test';
import { ROLES, dashboardFor, storagePathFor } from '../helpers/auth';

for (const role of ROLES) {
  test.describe(role, () => {
    test.use({ storageState: storagePathFor(role) });

    test('storage state lands directly on the dashboard', async ({ page }) => {
      await page.goto(dashboardFor(role));
      await expect(page).toHaveURL(new RegExp(dashboardFor(role).replace('/', '\\/')));
      await page.screenshot({ path: `screenshots/smoke-${role}.png`, fullPage: true });
    });
  });
}
