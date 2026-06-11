// Day 4 — Driver (deep). Day-1 assigned 5 students to QA Driver One. This
// spec drives the full route flow: view roster, optionally mark a student
// excluded ("absent"), start the drive (which requires geolocation
// permission — granted in beforeAll), then stop it.

import { test, expect, Page, BrowserContext } from '@playwright/test';
import { config, credentials } from '../helpers/env';
import { login } from '../helpers/login';
import { recordFinding, appendRunLog } from '../helpers/findings';

test.describe.configure({ mode: 'serial' });

test.describe('day 4 — driver (deep)', () => {
  let page: Page;
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    const dr = credentials.driver();
    if (!dr.username || !dr.password) {
      throw new Error('DRIVER_USERNAME / DRIVER_PASSWORD missing from .env.test — run day 1 first.');
    }
    // Geolocation must be granted up front — StartDrivePage uses
    // navigator.geolocation.getCurrentPosition. We pin coordinates over
    // Erbil so the request resolves without prompting.
    context = await browser.newContext({
      geolocation: { latitude: 36.1911, longitude: 44.0094 },
      permissions: ['geolocation'],
    });
    page = await context.newPage();
    page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
  });

  test.afterAll(async () => {
    await appendRunLog('day 4 (driver, deep)', 'see findings', 'live portal.scholify.krd');
    await page.close();
    await context.close();
  });

  test('4.1 driver logs in and lands on /driver/dashboard', async () => {
    await login(page, credentials.driver(), { passwordEnvVar: 'DRIVER_PASSWORD' });
    await expect(page).toHaveURL(/\/driver\/dashboard/, { timeout: 15_000 });
  });

  test('4.2 walk every driver surface', async () => {
    const surfaces = ['/driver/dashboard', '/driver/drive', '/driver/students', '/driver/profile'];
    for (const p of surfaces) {
      const res = await page.goto(config.webBase + p);
      if ((res?.status() ?? 0) >= 400) {
        recordFinding({ day: 'driver', severity: 'High', feature: p, issue: `GET ${p} → ${res?.status()}`, repro: `Login as driver → ${p}` });
        continue;
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      const errored = await page.locator('text=/something went wrong|application error/i').first().isVisible().catch(() => false);
      if (errored) recordFinding({ day: 'driver', severity: 'High', feature: p, issue: 'Error boundary', repro: `Login as driver → ${p}` });
    }
  });

  test('4.3 students roster — should list the 5 assigned in day-1', async () => {
    await page.goto(config.webBase + '/driver/students');
    await page.waitForLoadState('networkidle');

    // The roster renders each student as a Card containing the student's
    // first-letter avatar in a circular div. Count those avatar wrappers
    // as a stable proxy for student row count.
    const studentRows = page.locator('div.bg-primary-100.rounded-full');
    const count = await studentRows.count();
    if (count < 5) {
      recordFinding({
        day: 'driver',
        severity: 'High',
        feature: 'Driver students roster — short',
        issue: `Day-1 assigned 5 students; /driver/students shows ${count}.`,
        repro: 'Login as driver → /driver/students.',
      });
    } else {
      console.log(`[driver-students] ${count} students on roster`);
    }
  });

  test('4.4 start drive → stop drive', async () => {
    await page.goto(config.webBase + '/driver/drive');
    await page.waitForLoadState('networkidle');

    // Wait for the "Start Drive" button to appear (after the students list
    // resolves).
    const startBtn = page.getByRole('button', { name: /start drive/i });
    await expect(startBtn).toBeVisible({ timeout: 10_000 });
    await startBtn.click();

    // Drive started toast.
    const startedToast = page.locator('.Toastify__toast--success').first();
    await expect(startedToast).toBeVisible({ timeout: 10_000 });
    const startText = (await startedToast.textContent())?.toLowerCase() ?? '';
    console.log(`[drive] start toast: ${startText}`);

    // Dismiss any active toast then stop.
    await page.waitForTimeout(2_000);
    const stopBtn = page.getByRole('button', { name: /stop drive|end drive/i });
    await expect(stopBtn).toBeVisible({ timeout: 10_000 });
    await stopBtn.click();
    const stoppedToast = page.locator('.Toastify__toast--success').last();
    await expect(stoppedToast).toBeVisible({ timeout: 10_000 });
    const stopText = (await stoppedToast.textContent())?.toLowerCase() ?? '';
    console.log(`[drive] stop toast: ${stopText}`);
  });

  test('4.5 exclude a student then start + stop drive again', async () => {
    await page.goto(config.webBase + '/driver/drive');
    await page.waitForLoadState('networkidle');

    // Tick the first student to mark them absent for this drive.
    const firstStudentBox = page.locator('input[type="checkbox"]').first();
    if (await firstStudentBox.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await firstStudentBox.click();
    }

    const startBtn = page.getByRole('button', { name: /start drive/i });
    await expect(startBtn).toBeVisible({ timeout: 10_000 });
    await startBtn.click();
    await expect(page.locator('.Toastify__toast--success').first()).toBeVisible({ timeout: 10_000 });

    await page.waitForTimeout(2_000);
    const stopBtn = page.getByRole('button', { name: /stop drive|end drive/i });
    await stopBtn.click();
    await expect(page.locator('.Toastify__toast--success').last()).toBeVisible({ timeout: 10_000 });
  });
});
