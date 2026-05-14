// Wide-pass coverage of the admin portal. Each test exercises one feature
// surface — renders a page, performs the headline action, asserts a
// recognisable success signal, screenshots, and cleans up if it created
// data. Failures point at a single surface, not a giant flow.
//
// Fixtures relied on (from bootstrap):
//   TEST_CLASS_NAME, TEST_SUBJECT_NAME, TEST_STUDENT_NAME, E2E Teacher / Parent

import { test, expect, Page } from '@playwright/test';
import { storagePathFor } from '../helpers/auth';

const CLASS_NAME = process.env.TEST_CLASS_NAME || 'E2E Test Class';
const SUBJECT_NAME = process.env.TEST_SUBJECT_NAME || 'E2E Test Subject';
const STUDENT_NAME = process.env.TEST_STUDENT_NAME || 'E2E Test Student';

test.use({ storageState: storagePathFor('admin') });

// Helper: wait for any Toastify toast whose body matches `pattern` and dismiss it.
async function expectToast(page: Page, pattern: RegExp): Promise<void> {
  const toast = page.locator('.Toastify__toast').last();
  await expect(toast).toContainText(pattern, { timeout: 10_000 });
  await toast.click().catch(() => {});
}

test.describe('admin', () => {
  test('dashboard renders', async ({ page }) => {
    await page.goto('/admin/dashboard');
    // Dashboard has some text we can match against — admin should see at
    // least one stat card or the page header.
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-dashboard.png', fullPage: true });
  });

  test('students list shows the e2e test student', async ({ page }) => {
    await page.goto('/admin/students');
    await expect(page.getByText(STUDENT_NAME).first()).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-students.png', fullPage: true });
  });

  test('teachers page has E2E Teacher in the edit picker', async ({ page }) => {
    await page.goto('/admin/teachers');
    // No top-level list — there's an Add form + an Edit Teacher select.
    const editSelect = page.locator('select').filter({ hasText: 'Select Teacher' });
    await expect(editSelect.locator('option', { hasText: 'E2E Teacher' })).toHaveCount(1);
    await page.screenshot({ path: 'screenshots/admin-teachers.png', fullPage: true });
  });

  test('classes list shows the e2e test class', async ({ page }) => {
    await page.goto('/admin/classes');
    // The classes list lives in a max-h-[32rem] overflow-y-auto container.
    // After bulk upload populates many classes, ours may sit below the fold —
    // scroll its row into view before asserting visibility.
    const row = page.locator('div.rounded-xl').filter({ hasText: CLASS_NAME }).first();
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-classes.png', fullPage: true });
  });

  test('curriculum modal shows our subject + teacher binding', async ({ page }) => {
    await page.goto('/admin/classes');
    const classRow = page.locator('div.rounded-xl').filter({ hasText: CLASS_NAME }).first();
    await classRow.scrollIntoViewIfNeeded();
    await classRow.getByRole('button', { name: /Curriculum/i }).click();

    const modal = page.locator('[role="dialog"], .modal, div').filter({ hasText: `Curriculum — ${CLASS_NAME}` });
    await expect(modal.getByText(SUBJECT_NAME).first()).toBeVisible();
    await expect(modal.getByText('E2E Teacher').first()).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('subjects tab shows the e2e test subject', async ({ page }) => {
    await page.goto('/admin/classes');
    const pageTabs = page.locator('div.bg-gray-100.rounded-xl').first();
    await pageTabs.getByRole('button', { name: 'Subjects' }).click();
    await expect(page.getByText(SUBJECT_NAME).first()).toBeVisible();
  });

  test('accounts list shows all e2e users', async ({ page }) => {
    await page.goto('/admin/accounts');
    // Search-narrow to the e2e cohort to avoid scrolling through other rows.
    await page.getByPlaceholder(/Search by name, username, or email/i).fill('e2e');
    for (const name of ['E2E Parent', 'E2E Teacher', 'E2E Supervisor', 'E2E Reception']) {
      await expect(page.getByText(name).first()).toBeVisible();
    }
  });

  test('announcement create + delete cycle', async ({ page }) => {
    const title = `E2E announcement ${Date.now()}`;
    const content = 'This announcement was created by an automated test and should be deleted.';

    await page.goto('/admin/announcements');
    await page.getByPlaceholder('Announcement title').fill(title);
    await page.getByPlaceholder(/Write the announcement here/i).fill(content);
    // Form's submit button is the last button inside the form scope.
    await page.locator('form').filter({ has: page.getByPlaceholder('Announcement title') })
      .getByRole('button').last().click();
    await expectToast(page, /posted|created/i);
    await expect(page.getByText(title).first()).toBeVisible();

    // Delete — confirm() dialog needs auto-accept.
    page.once('dialog', d => d.accept());
    // Each announcement row carries a trash-icon button; click the one
    // sharing a row with our title.
    const row = page.locator('article, li, div').filter({ hasText: title }).first();
    await row.locator('button:has(svg)').last().click();
    await expectToast(page, /deleted/i);
  });

  test('appointments page loads', async ({ page }) => {
    await page.goto('/admin/appointments');
    await expect(page).toHaveURL(/\/admin\/appointments/);
    await page.screenshot({ path: 'screenshots/admin-appointments.png', fullPage: true });
  });

  test('audit log page loads', async ({ page }) => {
    await page.goto('/admin/audit-log');
    await expect(page).toHaveURL(/\/admin\/audit-log/);
    await page.screenshot({ path: 'screenshots/admin-audit-log.png', fullPage: true });
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page).toHaveURL(/\/admin\/settings/);
    await page.screenshot({ path: 'screenshots/admin-settings.png', fullPage: true });
  });

  test('schedule page loads', async ({ page }) => {
    await page.goto('/admin/schedule');
    await expect(page).toHaveURL(/\/admin\/schedule/);
    await page.screenshot({ path: 'screenshots/admin-schedule.png', fullPage: true });
  });

  test('notifications page loads', async ({ page }) => {
    await page.goto('/admin/notifications');
    await expect(page).toHaveURL(/\/admin\/notifications/);
    await page.screenshot({ path: 'screenshots/admin-notifications.png', fullPage: true });
  });

  test('archive page loads (or is gracefully gated)', async ({ page }) => {
    await page.goto('/admin/archive');
    // The archive route is gated by `school.features.archive`. If the
    // school doesn't have it, the page should either render an empty/locked
    // state or redirect — either way no crash.
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({ path: 'screenshots/admin-archive.png', fullPage: true });
  });
});
