// One-time bootstrap. Run with `npm run bootstrap` after filling BASE_URL,
// TEST_SCHOOL_ABBREVIATION, ADMIN_USERNAME, ADMIN_PASSWORD in .env.test.
//
// Drives the admin UI to create the e2e test users + a class + a subject +
// a student wired to the e2e parent, then writes the resulting credentials
// into .env.test so the feature specs can log in as them.
//
// Idempotent: if a user/class/subject/student already exists from a previous
// run, the duplicate-name error toast is swallowed and the spec moves on.

import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import { loginAs, storagePathFor } from '../helpers/auth';
import { setEnvKeys } from '../helpers/envFile';

const ABBREV = (process.env.TEST_SCHOOL_ABBREVIATION || '').toLowerCase();
if (!ABBREV) {
  throw new Error('Set TEST_SCHOOL_ABBREVIATION in tests/e2e/.env.test before running the bootstrap.');
}

// Deterministic. `e2e_` makes these easy to find/clean up in the DB later.
const SUFFIXES = {
  parent: 'e2e_parent',
  teacher: 'e2e_teacher',
  supervisor: 'e2e_supervisor',
  reception: 'e2e_reception',
  accountant: 'e2e_accountant',
} as const;

const PASSWORDS = {
  parent: 'E2eParent@123',
  teacher: 'E2eTeacher@123',
  supervisor: 'E2eSupervisor@123',
  reception: 'E2eReception@123',
  accountant: 'E2eAccountant@123',
} as const;

const CLASS_NAME = 'E2E Test Class';
const SUBJECT_NAME = 'E2E Test Subject';
const STUDENT_NAME = 'E2E Test Student';

function fullUsername(suffix: string): string {
  return suffix.startsWith(`${ABBREV}_`) ? suffix : `${ABBREV}_${suffix}`;
}

// Wait for a toast that matches one of the given patterns. Reads the
// NEWEST toast (Toastify stacks, so `.first()` would be stale from prior
// creates). Throws if nothing matches within the timeout, so each step
// is actually verified instead of silently passing on a stale notification.
async function waitForCreateOutcome(page: Page, ...patterns: RegExp[]): Promise<string> {
  const allPatterns = patterns.length ? patterns : [/.*/];
  const combined = new RegExp(allPatterns.map(p => p.source).join('|'), 'i');
  const toast = page.locator('.Toastify__toast').last();
  // Wait for a matching toast specifically — ignore unrelated stacked ones.
  await expect(toast).toContainText(combined, { timeout: 15_000 });
  const body = (await toast.textContent()) ?? '';
  // Dismiss so the next iteration's `.last()` is fresh.
  await toast.click().catch(() => {});
  return body;
}

// Reuse globalSetup's admin storage state when present so re-running the
// bootstrap during development does not burn admin logins against the
// 15/15min rate limit. Fall back to UI login when the file is missing
// (first run before any cache exists).
test.describe.serial('bootstrap', () => {
  test.use({ storageState: fs.existsSync(storagePathFor('admin')) ? storagePathFor('admin') : undefined });

  test('admin creates parent / teacher / supervisor / reception via /admin/accounts', async ({ page }) => {
    if (!fs.existsSync(storagePathFor('admin'))) await loginAs(page, 'admin', { rememberMe: true });
    else await page.goto('/admin/dashboard');

    for (const role of ['parent', 'teacher', 'supervisor', 'reception'] as const) {
      const lastName = role[0].toUpperCase() + role.slice(1);
      await page.goto('/admin/accounts');
      await page.getByText(/Create Account/i).first().waitFor();

      await page.locator('select').first().selectOption(role);
      await page.getByPlaceholder('First name').fill('E2E');
      await page.getByPlaceholder('Last name').fill(lastName);
      await page.getByPlaceholder('Login username').fill(SUFFIXES[role]);
      await page.getByPlaceholder('Initial password').fill(PASSWORDS[role]);
      await page.getByRole('button', { name: /Create Account/i }).click();
      // Verify against this role's specific success or duplicate message —
      // matching `/created/i` alone would happily accept a stale toast from
      // a previous iteration.
      await waitForCreateOutcome(
        page,
        new RegExp(`Account created for E2E ${lastName}`, 'i'),
        new RegExp(`Username ".*${SUFFIXES[role]}.*" already exists`, 'i'),
      );
    }

    setEnvKeys({
      PARENT_USERNAME: fullUsername(SUFFIXES.parent),
      PARENT_PASSWORD: PASSWORDS.parent,
      TEACHER_USERNAME: fullUsername(SUFFIXES.teacher),
      TEACHER_PASSWORD: PASSWORDS.teacher,
      SUPERVISOR_USERNAME: fullUsername(SUFFIXES.supervisor),
      SUPERVISOR_PASSWORD: PASSWORDS.supervisor,
      RECEPTION_USERNAME: fullUsername(SUFFIXES.reception),
      RECEPTION_PASSWORD: PASSWORDS.reception,
    });

    // Accountant is gated on the school having the tuition_fees (accounting)
    // premium feature. The role select only includes "Accountant" when the
    // flag is on; if it isn't, we skip silently so the bootstrap still works
    // for non-premium schools.
    await page.goto('/admin/accounts');
    await page.getByText(/Create Account/i).first().waitFor();
    const roleSelect = page.locator('select').first();
    const hasAccountantOption = await roleSelect.locator('option[value="accountant"]').count() > 0;
    if (!hasAccountantOption) {
      console.log('[bootstrap] accountant: tuition_fees premium feature is off, skipping accountant create');
    } else {
      await roleSelect.selectOption('accountant');
      await page.getByPlaceholder('First name').fill('E2E');
      await page.getByPlaceholder('Last name').fill('Accountant');
      await page.getByPlaceholder('Login username').fill(SUFFIXES.accountant);
      await page.getByPlaceholder('Initial password').fill(PASSWORDS.accountant);
      await page.getByRole('button', { name: /Create Account/i }).click();
      await waitForCreateOutcome(
        page,
        new RegExp(`Account created for E2E Accountant`, 'i'),
        new RegExp(`Username ".*${SUFFIXES.accountant}.*" already exists`, 'i'),
      );
      setEnvKeys({
        ACCOUNTANT_USERNAME: fullUsername(SUFFIXES.accountant),
        ACCOUNTANT_PASSWORD: PASSWORDS.accountant,
      });
    }
  });

  test('admin creates class + subject + student wired to the e2e parent', async ({ page }) => {
    if (!fs.existsSync(storagePathFor('admin'))) await loginAs(page, 'admin', { rememberMe: true });
    else await page.goto('/admin/dashboard');

    // Helper: scope tab clicks to the in-page tab switcher, not the sidebar
    // nav (which also has a "Classes" link).
    const pageTabs = () => page.locator('div.bg-gray-100.rounded-xl').first();

    // 1. Class — /admin/classes lands on Classes tab by default.
    await page.goto('/admin/classes');
    await page.getByPlaceholder(/Grade 5A/i).fill(CLASS_NAME);
    await page.getByPlaceholder(/Grade 5$/i).fill('Grade E2E');
    await page.getByPlaceholder(/2024-2025/i).fill('2025-2026');
    await page.getByRole('button', { name: /^Create Class$/ }).click();
    await waitForCreateOutcome(page, /Class created/i, /already exists/i);

    // 2. Subject — switch to Subjects tab via the page tab switcher.
    await pageTabs().getByRole('button', { name: 'Subjects' }).click();
    await page.getByPlaceholder(/Mathematics/i).fill(SUBJECT_NAME);
    await page.getByRole('button', { name: /^Add Subject$/ }).click();
    await waitForCreateOutcome(page, /Subject created/i, /already exists/i);

    // 3. Curriculum row — re-navigate to force the Classes tab, then find
    // the row containing our class by text and scroll it into view.
    await page.goto('/admin/classes');
    const classRow = page.locator('div.rounded-xl').filter({ hasText: CLASS_NAME }).first();
    await classRow.scrollIntoViewIfNeeded();
    await classRow.getByRole('button', { name: /Curriculum/i }).click();

    // Curriculum modal opens. The two <select>s are inside the modal's
    // "Add" row; identify them by their first-option placeholder.
    const subjectSelect = page.locator('select').filter({ hasText: 'Subject…' });
    const teacherSelect = page.locator('select').filter({ hasText: 'Teacher…' });
    await subjectSelect.selectOption({ label: SUBJECT_NAME });
    await teacherSelect.selectOption({ label: 'E2E Teacher' });
    await page.getByRole('button', { name: /^Add$/ }).click();
    await waitForCreateOutcome(page, /^Added$/i, /already exists/i);
    await page.keyboard.press('Escape');

    // 4. Student linked to the e2e parent, in the class. The page has an
    // in-page tab switcher for Active / New Student.
    await page.goto('/admin/students');
    await pageTabs().getByRole('button', { name: /New Student/i }).click();
    await page.getByPlaceholder('Full Name').fill(STUDENT_NAME);
    const parentSelect = page.locator('select').filter({ hasText: 'Select Parent' });
    await parentSelect.selectOption({ label: 'E2E Parent' });
    const classSelect = page.locator('select').filter({ hasText: 'Select Class' });
    await classSelect.selectOption({ label: CLASS_NAME });
    // Submit button is just labeled "Send"; scope it to the Add Student form
    // so we do not pick up the same label elsewhere on the page.
    await page.locator('form').filter({ has: page.getByPlaceholder('Full Name') })
      .getByRole('button', { name: /^Send$/ }).click();
    await waitForCreateOutcome(page, /Student added|created/i, /already exists/i);

    setEnvKeys({
      TEST_CLASS_NAME: CLASS_NAME,
      TEST_SUBJECT_NAME: SUBJECT_NAME,
      TEST_STUDENT_NAME: STUDENT_NAME,
    });
  });
});
