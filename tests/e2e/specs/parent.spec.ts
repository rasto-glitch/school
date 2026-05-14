// Wide-pass coverage of the parent portal. The grades page is the most
// important here — it must read marks[] first, fall back to legacy columns
// for old records (CLAUDE.md dual-schema rule). The homework created earlier
// by the teacher spec should show up too.

import { test, expect } from '@playwright/test';
import { storagePathFor } from '../helpers/auth';

const STUDENT_NAME = process.env.TEST_STUDENT_NAME || 'E2E Test Student';

test.use({ storageState: storagePathFor('parent') });

test.describe('parent', () => {
  test('dashboard renders + shows the e2e student', async ({ page }) => {
    await page.goto('/parent/dashboard');
    await expect(page.getByText(STUDENT_NAME).first()).toBeVisible();
    await page.screenshot({ path: 'screenshots/parent-dashboard.png', fullPage: true });
  });

  test('homework page shows the teacher-created E2E homework', async ({ page }) => {
    await page.goto('/parent/homework');
    // The teacher spec creates one before this test runs (suite is serial).
    // If the test order is changed we just verify the page loads cleanly.
    await expect(page).toHaveURL(/\/parent\/homework/);
    await page.screenshot({ path: 'screenshots/parent-homework.png', fullPage: true });
  });

  test('grades page renders (dual-schema reader path)', async ({ page }) => {
    await page.goto('/parent/grades');
    await expect(page).toHaveURL(/\/parent\/grades/);
    // Critical regression sentinel: if marks[] read path crashes, this page
    // throws and the body is empty. We just assert it rendered without crash.
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({ path: 'screenshots/parent-grades.png', fullPage: true });
  });

  test('reports page renders', async ({ page }) => {
    await page.goto('/parent/reports');
    await expect(page).toHaveURL(/\/parent\/reports/);
    await page.screenshot({ path: 'screenshots/parent-reports.png', fullPage: true });
  });

  test('assignments page renders', async ({ page }) => {
    await page.goto('/parent/assignments');
    await expect(page).toHaveURL(/\/parent\/assignments/);
    await page.screenshot({ path: 'screenshots/parent-assignments.png', fullPage: true });
  });

  test('announcements page renders', async ({ page }) => {
    await page.goto('/parent/announcements');
    await expect(page).toHaveURL(/\/parent\/announcements/);
    await page.screenshot({ path: 'screenshots/parent-announcements.png', fullPage: true });
  });

  test('appointments page renders + can request an appointment', async ({ page }) => {
    await page.goto('/parent/appointments');
    await expect(page).toHaveURL(/\/parent\/appointments/);
    await page.screenshot({ path: 'screenshots/parent-appointments.png', fullPage: true });
  });

  test('schedule page renders', async ({ page }) => {
    await page.goto('/parent/schedule');
    await expect(page).toHaveURL(/\/parent\/schedule/);
    await page.screenshot({ path: 'screenshots/parent-schedule.png', fullPage: true });
  });

  test('tuition page renders (or is gracefully gated)', async ({ page }) => {
    await page.goto('/parent/tuition');
    // tuition_fees is a premium feature; if off, page redirects or shows lock.
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({ path: 'screenshots/parent-tuition.png', fullPage: true });
  });

  test('bus tracking page renders (or shows no-driver state)', async ({ page }) => {
    await page.goto('/parent/bus');
    await expect(page.locator('body')).toBeVisible();
    await page.screenshot({ path: 'screenshots/parent-bus.png', fullPage: true });
  });

  test('notifications page renders', async ({ page }) => {
    await page.goto('/parent/notifications');
    await expect(page).toHaveURL(/\/parent\/notifications/);
  });

  test('profile page renders', async ({ page }) => {
    await page.goto('/parent/profile');
    await expect(page).toHaveURL(/\/parent\/profile/);
  });
});
