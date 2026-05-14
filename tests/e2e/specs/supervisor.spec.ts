// Wide-pass coverage of the supervisor portal. Supervisor's distinctive
// feature is opening/closing weekly-summary periods, which gates teacher
// writes. We just verify each page renders for now.

import { test, expect } from '@playwright/test';
import { storagePathFor } from '../helpers/auth';

test.use({ storageState: storagePathFor('supervisor') });

test.describe('supervisor', () => {
  test('dashboard renders', async ({ page }) => {
    await page.goto('/supervisor/dashboard');
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({ path: 'screenshots/supervisor-dashboard.png', fullPage: true });
  });

  test('absent-today page renders', async ({ page }) => {
    await page.goto('/supervisor/absent-today');
    await expect(page).toHaveURL(/\/supervisor\/absent-today/);
    await page.screenshot({ path: 'screenshots/supervisor-absent-today.png', fullPage: true });
  });

  test('attendance overview page renders', async ({ page }) => {
    await page.goto('/supervisor/attendance');
    await expect(page).toHaveURL(/\/supervisor\/attendance/);
    await page.screenshot({ path: 'screenshots/supervisor-attendance.png', fullPage: true });
  });

  test('homework overview page renders', async ({ page }) => {
    await page.goto('/supervisor/homework');
    await expect(page).toHaveURL(/\/supervisor\/homework/);
  });

  test('assignments overview page renders', async ({ page }) => {
    await page.goto('/supervisor/assignments');
    await expect(page).toHaveURL(/\/supervisor\/assignments/);
  });

  test('weekly summary periods page renders', async ({ page }) => {
    await page.goto('/supervisor/weekly-summary');
    await expect(page).toHaveURL(/\/supervisor\/weekly-summary/);
    await page.screenshot({ path: 'screenshots/supervisor-weekly-summary.png', fullPage: true });
  });

  test('student reports page renders', async ({ page }) => {
    await page.goto('/supervisor/student-reports');
    await expect(page).toHaveURL(/\/supervisor\/student-reports/);
  });

  test('notifications page renders', async ({ page }) => {
    await page.goto('/supervisor/notifications');
    await expect(page).toHaveURL(/\/supervisor\/notifications/);
  });

  test('profile page renders', async ({ page }) => {
    await page.goto('/supervisor/profile');
    await expect(page).toHaveURL(/\/supervisor\/profile/);
  });
});
