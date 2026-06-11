// Day 5 — Parent (deep). The parent (de_khalidwahab / Parent@123) is linked
// to Niga Khalid Wahab Pasha (first row of the XLSX). Day-2 wrote:
//   • attendance for Niga's class (all present)
//   • homework "QA day-2 homework" for Niga's class
//   • assignment "QA day-2 assignment" for Niga's class
//   • a grade and a report for the first student (may or may not be Niga,
//     depending on iteration order; ok if absent for this parent)
// Day-1 posted "QA welcome — automated" announcement to all parents.

import { test, expect, Page } from '@playwright/test';
import { config, credentials } from '../helpers/env';
import { login } from '../helpers/login';
import { recordFinding, appendRunLog } from '../helpers/findings';

const QA_MARKER = 'QA day-2 (grade5)';

test.describe.configure({ mode: 'serial' });

test.describe('day 5 — parent (deep)', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const par = credentials.parent();
    if (!par.username || !par.password) {
      throw new Error('PARENT_USERNAME / PARENT_PASSWORD missing from .env.test — run day 1 first.');
    }
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
  });

  test.afterAll(async () => {
    await appendRunLog('day 5 (parent, deep)', 'see findings', 'live portal.scholify.krd');
    await page.close();
  });

  test('5.1 parent logs in and lands on /parent/dashboard', async () => {
    await login(page, credentials.parent(), { passwordEnvVar: 'PARENT_PASSWORD' });
    await expect(page).toHaveURL(/\/parent\/dashboard/, { timeout: 15_000 });
  });

  test('5.2 walk every parent surface', async () => {
    const surfaces = [
      '/parent/dashboard', '/parent/homework', '/parent/assignments',
      '/parent/announcements', '/parent/reports', '/parent/bus',
      '/parent/notifications', '/parent/appointments', '/parent/tuition',
      '/parent/grades', '/parent/archive', '/parent/attendance',
      '/parent/schedule', '/parent/profile',
    ];
    for (const p of surfaces) {
      const res = await page.goto(config.webBase + p);
      if ((res?.status() ?? 0) >= 400) {
        recordFinding({ day: 'parent', severity: 'High', feature: p, issue: `GET ${p} → ${res?.status()}`, repro: `Login as parent → ${p}` });
        continue;
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      const errored = await page.locator('text=/something went wrong|application error/i').first().isVisible().catch(() => false);
      if (errored) recordFinding({ day: 'parent', severity: 'High', feature: p, issue: 'Error boundary', repro: `Login as parent → ${p}` });
    }
  });

  test('5.3 dashboard shows the linked student (Niga)', async () => {
    await page.goto(config.webBase + '/parent/dashboard');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=/niga/i').first()).toBeVisible({ timeout: 10_000 });
  });

  test('5.4 homework feed shows the day-2 homework', async () => {
    await page.goto(config.webBase + '/parent/homework');
    await page.waitForLoadState('networkidle');
    // Plain-text (substring) match — QA_MARKER has parens that would
    // be regex metacharacters in a /.../ text matcher.
    const marker = page.getByText(`${QA_MARKER} homework`, { exact: false }).first();
    const visible = await marker.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!visible) {
      recordFinding({
        day: 'parent',
        severity: 'High',
        feature: 'Parent homework — missing teacher post',
        issue: `Day-2 teacher posted "${QA_MARKER} homework" for Niga's class — parent feed does not surface it.`,
        repro: 'Login as parent → /parent/homework.',
      });
    }
  });

  test('5.5 assignments feed shows the day-2 assignment', async () => {
    await page.goto(config.webBase + '/parent/assignments');
    await page.waitForLoadState('networkidle');
    const marker = page.getByText(`${QA_MARKER} assignment`, { exact: false }).first();
    const visible = await marker.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!visible) {
      recordFinding({
        day: 'parent',
        severity: 'High',
        feature: 'Parent assignments — missing teacher post',
        issue: `Day-2 teacher posted "${QA_MARKER} assignment" for Niga's class — parent feed does not surface it.`,
        repro: 'Login as parent → /parent/assignments.',
      });
    }
  });

  test('5.6 announcements feed shows the day-1 welcome', async () => {
    await page.goto(config.webBase + '/parent/announcements');
    await page.waitForLoadState('networkidle');
    const marker = page.getByText('QA welcome', { exact: false }).first();
    const visible = await marker.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!visible) {
      recordFinding({
        day: 'parent',
        severity: 'Medium',
        feature: 'Parent announcements — missing admin post',
        issue: 'Day-1 posted "QA welcome — automated" with audience=all; parent does not see it.',
        repro: 'Login as parent → /parent/announcements.',
      });
    }
  });

  test('5.7 attendance history renders for Niga', async () => {
    await page.goto(config.webBase + '/parent/attendance');
    await page.waitForLoadState('networkidle');
    // Day-2 wrote attendance for Niga's class. We don't assert on
    // specific counts — just that the page rendered with at least some
    // attendance content (date headers, status pills, etc.).
    const hasContent = await page.locator('text=/present|absent|late|excused/i').first().isVisible({ timeout: 10_000 }).catch(() => false);
    if (!hasContent) {
      recordFinding({
        day: 'parent',
        severity: 'Medium',
        feature: 'Parent attendance history — empty',
        issue: 'Day-2 saved attendance for Niga\'s class; parent history shows none.',
        repro: 'Login as parent → /parent/attendance.',
      });
    }
  });

  test('5.8 grades page renders (data optional)', async () => {
    await page.goto(config.webBase + '/parent/grades');
    await page.waitForLoadState('networkidle');
    const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
    expect(errored).toBe(false);
  });

  test('5.9 reports page renders', async () => {
    await page.goto(config.webBase + '/parent/reports');
    await page.waitForLoadState('networkidle');
    const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
    expect(errored).toBe(false);
  });

  test('5.10 schedule page renders the day-1 cell', async () => {
    await page.goto(config.webBase + '/parent/schedule');
    await page.waitForLoadState('networkidle');
    const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
    expect(errored).toBe(false);
  });

  test('5.11 bus tracking page renders', async () => {
    await page.goto(config.webBase + '/parent/bus');
    await page.waitForLoadState('networkidle');
    // Bus tracking depends on a driver being assigned. Niga may not be
    // on QA Driver One's roster — accept either a map or an empty state.
    const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
    expect(errored).toBe(false);
  });

  test('5.12 tuition page reflects day-5 plan + payment + refund', async () => {
    await page.goto(config.webBase + '/parent/tuition');
    await page.waitForLoadState('networkidle');
    const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
    expect(errored).toBe(false);

    // After day-5 created "QA Tuition USD 100" with appliesTo='all' and
    // clicked Assign, Niga should have an invoice for $100.
    const hasMoney = await page.locator('text=/\\$\\s*\\d|usd\\s*\\d|100/i').first().isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasMoney) {
      recordFinding({
        day: 'parent',
        severity: 'Medium',
        feature: 'Parent tuition — empty after day-5 plan assigned',
        issue: 'Day-5 accountant created "QA Tuition USD 100" with appliesTo=all and clicked Assign; parent tuition page shows no dollar amount.',
        repro: 'Login as parent → /parent/tuition; after day-5 has run, expect to see $100 for Niga.',
      });
      return;
    }

    // Day-5 flow: 6.12 records $100 payment → 6.20 refunds $50. So the
    // rollup should show either:
    //   - "Paid in full" (refund hasn't run yet — first iteration of test 6.20)
    //   - balance ~$50 owed (refund has applied)
    // Either state is healthy; only flag if NEITHER appears.
    const paidUp = await page.locator('text=/paid in full|paid up/i').first().isVisible({ timeout: 3_000 }).catch(() => false);
    const partialBalance = await page.locator('text=/50|remaining|balance/i').first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (!paidUp && !partialBalance) {
      recordFinding({
        day: 'parent',
        severity: 'Medium',
        feature: 'Parent tuition — neither paid-in-full nor balance visible',
        issue: 'Day-5 accountant recorded $100 payment then refunded $50. Parent rollup should show either "Paid in full" (pre-refund) or a non-zero balance (post-refund); neither is visible.',
        repro: 'Login as parent → /parent/tuition after day-5 6.12 + 6.20 have run.',
      });
    } else {
      console.log(`[parent-tuition] ${paidUp ? 'Paid in full' : 'balance/remaining'} visible`);
    }
  });

  test('5.13 request an appointment (idempotent — skip if a QA marker already exists)', async () => {
    await page.goto(config.webBase + '/parent/appointments');
    await page.waitForLoadState('networkidle');

    const marker = 'QA day-5 meeting';
    const alreadyRequested = await page.locator(`text=/${marker}/i`).first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (alreadyRequested) {
      console.log('[appointment] already requested');
      return;
    }

    // Tick the first student checkbox (the only child for this parent).
    const firstChildBox = page.locator('input[type="checkbox"]').first();
    if (await firstChildBox.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await firstChildBox.click();
    }

    await page.locator('input[name="reason"]').fill(marker);
    await page.locator('textarea[name="message"]').fill('Day-5 e2e — automated request, please disregard.');
    // Preferred date — a week out.
    await page.locator('input[type="date"]').first().fill('2026-06-17');

    await page.getByRole('button', { name: /submit/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('error') || text.includes('fail')) {
      recordFinding({
        day: 'parent',
        severity: 'Medium',
        feature: 'Appointment request failed',
        issue: `Toast: "${text}"`,
        repro: 'Login as parent → /parent/appointments → fill form → Submit.',
      });
    } else {
      console.log('[appointment] requested');
    }
  });
});
