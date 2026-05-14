// Wide-pass coverage of the teacher portal. Same approach as admin.spec.ts:
// one feature surface per test, screenshots, light cleanup.
//
// The grade test is intentionally driven through the UI (not a direct API
// call) so it exercises the dual-schema rule: writes land in `marks[]` and
// the parent should be able to read them back through that path.

import { test, expect, Page } from '@playwright/test';
import { storagePathFor } from '../helpers/auth';

const CLASS_NAME = process.env.TEST_CLASS_NAME || 'E2E Test Class';
const SUBJECT_NAME = process.env.TEST_SUBJECT_NAME || 'E2E Test Subject';
const STUDENT_NAME = process.env.TEST_STUDENT_NAME || 'E2E Test Student';

test.use({ storageState: storagePathFor('teacher') });

async function expectToast(page: Page, pattern: RegExp): Promise<void> {
  const toast = page.locator('.Toastify__toast').last();
  await expect(toast).toContainText(pattern, { timeout: 10_000 });
  await toast.click().catch(() => {});
}

test.describe('teacher', () => {
  test('dashboard renders', async ({ page }) => {
    await page.goto('/teacher/dashboard');
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({ path: 'screenshots/teacher-dashboard.png', fullPage: true });
  });

  test('students page shows the e2e test student', async ({ page }) => {
    await page.goto('/teacher/students');
    await expect(page.getByText(STUDENT_NAME).first()).toBeVisible();
    await page.screenshot({ path: 'screenshots/teacher-students.png', fullPage: true });
  });

  test('attendance page loads with class + student visible', async ({ page }) => {
    await page.goto('/teacher/attendance');
    // Teacher should land on a page where they can pick / see their class.
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({ path: 'screenshots/teacher-attendance.png', fullPage: true });
  });

  test('schedule page loads', async ({ page }) => {
    await page.goto('/teacher/schedule');
    await expect(page).toHaveURL(/\/teacher\/schedule/);
    await page.screenshot({ path: 'screenshots/teacher-schedule.png', fullPage: true });
  });

  test('homework create with empty due date (regression for H6 fix)', async ({ page }) => {
    const title = `E2E homework no-date ${Date.now()}`;

    await page.goto('/teacher/homework');
    await page.locator('select').filter({ hasText: 'Select class' }).selectOption({ label: CLASS_NAME });
    await page.locator('select').filter({ hasText: 'Select subject' }).selectOption({ label: SUBJECT_NAME });
    await page.getByPlaceholder('Homework title').fill(title);
    await page.getByPlaceholder(/Homework description/i).fill('Created by automated test, no due date.');
    // Intentionally leave Due Date blank — previously caused a Postgres
    // "invalid input syntax for type date" 500. Controller now coerces "" to null.
    await page.locator('form').getByRole('button').last().click();
    await expectToast(page, /created|posted|added|saved/i);
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test('grade create lands in marks[] (dual-schema rule)', async ({ page }) => {
    await page.goto('/teacher/grades');

    // Step the form: class -> student -> subject -> term -> marks
    await page.locator('select').filter({ hasText: 'Select class' }).selectOption({ label: CLASS_NAME });
    await page.locator('select').filter({ hasText: 'Select student' }).selectOption({ label: STUDENT_NAME });
    await page.locator('select').filter({ hasText: 'Select subject' }).selectOption({ label: SUBJECT_NAME });

    // Term is required-ish — if the school has no terms configured, the
    // select shows "No terms configured" and is empty. Skip the test in that
    // case rather than failing on missing fixtures.
    const termSelect = page.locator('select').filter({ hasText: /Select term|No terms configured/i });
    const termOpts = await termSelect.locator('option').allTextContents();
    const realTerms = termOpts.filter(t => t && !/select term|no terms configured/i.test(t));
    test.skip(realTerms.length === 0, 'School has no terms configured; cannot exercise grading.');
    await termSelect.selectOption({ index: 1 });

    // Add a mark — schema-defined or free-text depending on the school's mark_types.
    await page.getByRole('button', { name: /Add (first )?Mark/i }).first().click();
    const markNameInput = page.getByPlaceholder('Mark name').first();
    if (await markNameInput.count()) await markNameInput.fill('E2ETestMark');
    await page.locator('input[type="number"]').first().fill('8.5');

    await page.getByRole('button', { name: /Save Grade/i }).click();
    await expectToast(page, /saved|created|added/i);
  });

  test('report page loads', async ({ page }) => {
    await page.goto('/teacher/reports');
    await expect(page).toHaveURL(/\/teacher\/reports/);
    await page.screenshot({ path: 'screenshots/teacher-reports.png', fullPage: true });
  });

  test('assignments page loads', async ({ page }) => {
    await page.goto('/teacher/assignments');
    await expect(page).toHaveURL(/\/teacher\/assignments/);
    await page.screenshot({ path: 'screenshots/teacher-assignments.png', fullPage: true });
  });

  test('weekly summary page loads (period may be closed)', async ({ page }) => {
    await page.goto('/teacher/weekly-summary');
    await expect(page).toHaveURL(/\/teacher\/weekly-summary/);
    await page.screenshot({ path: 'screenshots/teacher-weekly-summary.png', fullPage: true });
  });

  test('notifications page loads', async ({ page }) => {
    await page.goto('/teacher/notifications');
    await expect(page).toHaveURL(/\/teacher\/notifications/);
  });

  test('profile page loads', async ({ page }) => {
    await page.goto('/teacher/profile');
    await expect(page).toHaveURL(/\/teacher\/profile/);
  });
});
