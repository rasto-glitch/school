// Generic Scholify login. The web app expects `<school-abbreviation>_<name>`
// as the username and routes the user to the right role-home after auth.
// We treat anything past the form post as out-of-scope here — tests assert
// against role-specific landmarks themselves.

import type { Page } from '@playwright/test';
import { config, persistEnvVar } from './env';

export interface Creds { username: string; password: string }

// The non-default password we set when an account hits the new force-
// change-password screen on first login. Must satisfy backend strength
// (>=8, uppercase + special) AND not be one of the shipping defaults
// (Parent@123 etc.) — both checks happen server-side.
const FORCE_CHANGE_NEW_PASSWORD = 'Scholify@E2E-Set1';

export async function login(page: Page, creds: Creds, opts?: { passwordEnvVar?: string }): Promise<void> {
  await page.goto(config.webBase + '/login');
  // The form's labels aren't htmlFor-associated to the inputs, so getByLabel
  // doesn't resolve. Use input[name=...] directly — stable selector.
  await page.locator('input[name="username"]').fill(creds.username);
  await page.locator('input[name="password"]').fill(creds.password);
  await page.getByRole('button', { name: /sign in|log in|login/i }).click();
  // We don't assert a destination here — different roles land on different
  // pages. Caller asserts on the expected role-home.
  await page.waitForLoadState('networkidle');

  // Force-change interception. Accounts created via admin create flows
  // (parent bulk upload, teacher / driver / accountant / supervisor /
  // reception create) ship with must_change_password=true. The first
  // successful login bounces us to /force-change-password and locks
  // every other route until a non-default password is set.
  if (page.url().includes('/force-change-password')) {
    // Two password inputs in order: new, confirm. Use the locator's nth()
    // to avoid relying on field labels which differ across locales.
    const inputs = page.locator('input[type="password"]');
    await inputs.nth(0).fill(FORCE_CHANGE_NEW_PASSWORD);
    await inputs.nth(1).fill(FORCE_CHANGE_NEW_PASSWORD);
    await page.getByRole('button', { name: /set new password|submit/i }).first().click();
    await page.waitForLoadState('networkidle');
    // Persist the new password into .env.test for subsequent test runs,
    // so the next run logs in with the cleared password directly.
    if (opts?.passwordEnvVar) {
      persistEnvVar(opts.passwordEnvVar, FORCE_CHANGE_NEW_PASSWORD);
    }
  }
}

export async function logout(page: Page): Promise<void> {
  // Best-effort. Different role headers have different menu shapes.
  try {
    await page.getByRole('button', { name: /log ?out|sign ?out|logout/i }).first().click({ timeout: 3_000 });
  } catch {
    // Fallback: clear storage and navigate to /login.
    await page.context().clearCookies();
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
    await page.goto(config.webBase + '/login');
  }
}
