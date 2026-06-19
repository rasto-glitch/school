import { Page, expect } from '@playwright/test';
import * as path from 'path';

export type TestRole = 'parent' | 'teacher' | 'admin' | 'supervisor' | 'reception' | 'accountant';

export const ROLES: readonly TestRole[] = ['admin', 'parent', 'teacher', 'supervisor', 'reception', 'accountant'] as const;

const DASHBOARD_PATH: Record<TestRole, string> = {
  parent: '/parent/dashboard',
  teacher: '/teacher/dashboard',
  admin: '/admin/dashboard',
  supervisor: '/supervisor/dashboard',
  reception: '/reception/dashboard',
  // Accountant doesn't land on a /accounting/dashboard — LoginPage routes
  // them to /accounting (the tuition root). See ROLE_DASHBOARDS in LoginPage.tsx.
  accountant: '/accounting',
};

export function credsFor(role: TestRole): { username: string; password: string } | null {
  const u = process.env[`${role.toUpperCase()}_USERNAME`];
  const p = process.env[`${role.toUpperCase()}_PASSWORD`];
  if (!u || !p) return null;
  return { username: u, password: p };
}

function requireCreds(role: TestRole): { username: string; password: string } {
  const c = credsFor(role);
  if (!c) {
    throw new Error(
      `Missing credentials for role "${role}". Set ${role.toUpperCase()}_USERNAME and ${role.toUpperCase()}_PASSWORD in tests/e2e/.env.test`,
    );
  }
  return c;
}

// Drives the login form. Use this when you specifically want to test the login
// UI; otherwise prefer storageState (see helpers/storage.ts + globalSetup.ts)
// to avoid burning logins against the rate-limited backend.
//
// `rememberMe` controls where the JWT lands — localStorage (true) vs
// sessionStorage (false). storageState only captures localStorage, so the
// globalSetup login uses rememberMe=true to make the auth persist.
export async function loginAs(page: Page, role: TestRole, opts: { rememberMe?: boolean } = {}): Promise<void> {
  const { username, password } = requireCreds(role);
  await page.goto('/login');
  await page.getByPlaceholder(/school_username/i).fill(username);
  await page.getByPlaceholder(/Enter your password/i).fill(password);
  if (opts.rememberMe) {
    await page.getByRole('checkbox', { name: /remember me/i }).check();
  }
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(new RegExp(DASHBOARD_PATH[role].replace('/', '\\/')), { timeout: 15_000 });
}

export function dashboardFor(role: TestRole): string {
  return DASHBOARD_PATH[role];
}

// Where each role's saved auth state lives. globalSetup writes these;
// specs read them via `test.use({ storageState: storagePathFor(role) })`.
export function storagePathFor(role: TestRole): string {
  return path.resolve(__dirname, '..', 'storage', `${role}.json`);
}
