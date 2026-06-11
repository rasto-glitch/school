// Day 3 — Supervisor (deep). Supervisor is a school-wide read-mostly role.
// Day-2 wrote real data: attendance for one class (all present), a homework,
// an assignment, a grade, and a report. This spec verifies each surfaces
// in the supervisor's views.

import { test, expect, Page } from '@playwright/test';
import { config, credentials } from '../helpers/env';
import { login } from '../helpers/login';
import { recordFinding, appendRunLog } from '../helpers/findings';

const QA_MARKER = 'QA day-2 (grade5)';

test.describe.configure({ mode: 'serial' });

test.describe('day 3 — supervisor (deep)', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const sup = credentials.supervisor();
    if (!sup.username || !sup.password) {
      throw new Error('SUPERVISOR_USERNAME / SUPERVISOR_PASSWORD missing from .env.test — run day 1 first.');
    }
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
  });

  test.afterAll(async () => {
    await appendRunLog('day 3 (supervisor, deep)', 'see findings', 'live portal.scholify.krd');
    await page.close();
  });

  test('3.1 supervisor logs in and lands on /supervisor/dashboard', async () => {
    await login(page, credentials.supervisor(), { passwordEnvVar: 'SUPERVISOR_PASSWORD' });
    await expect(page).toHaveURL(/\/supervisor\/dashboard/, { timeout: 15_000 });
  });

  test('3.2 walk every supervisor surface', async () => {
    const surfaces = [
      '/supervisor/dashboard',
      '/supervisor/absent-today',
      '/supervisor/attendance',
      '/supervisor/homework',
      '/supervisor/assignments',
      '/supervisor/weekly-summary',
      '/supervisor/student-reports',
      '/supervisor/notifications',
      '/supervisor/profile',
    ];
    for (const p of surfaces) {
      const res = await page.goto(config.webBase + p);
      if ((res?.status() ?? 0) >= 400) {
        recordFinding({ day: 'supervisor', severity: 'High', feature: p, issue: `GET ${p} → ${res?.status()}`, repro: `Login as supervisor → ${p}` });
        continue;
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      const errored = await page.locator('text=/something went wrong|application error/i').first().isVisible().catch(() => false);
      if (errored) recordFinding({ day: 'supervisor', severity: 'High', feature: p, issue: 'Error boundary', repro: `Login as supervisor → ${p}` });
    }
  });

  test('3.3 absent-today shows the day-2 absence', async () => {
    await page.goto(config.webBase + '/supervisor/absent-today');
    await page.waitForLoadState('networkidle');
    // Day-2 marked the first student of Grade 5 absent — should appear
    // here today. The page typically lists each absent student as a row.
    const main = page.locator('main, [role="main"]').first();
    await expect(main).toBeVisible({ timeout: 10_000 });

    // Match whole-page empty-state copy only. The previous regex caught
    // per-class summary chrome (e.g. "Grade 1: 0 absent") and falsely
    // flagged the page as empty when other classes did have absences —
    // see FINDINGS.md finding #5, confirmed false positive on 2026-06-11.
    const emptyState = page.locator('text=/no one absent today|no absences today|nobody absent today|no students absent/i').first();
    const looksEmpty = await emptyState.isVisible({ timeout: 3_000 }).catch(() => false);
    if (looksEmpty) {
      recordFinding({
        day: 'supervisor',
        severity: 'High',
        feature: 'Absent-today — empty after teacher marked an absence',
        issue: 'Day-2 teacher marked the first Grade-5 student absent and saved; absent-today page shows the empty state.',
        repro: 'Login as supervisor → /supervisor/absent-today after day-2 ran.',
      });
    }
  });

  test('3.4 attendance overview — filters render and a class can be selected', async () => {
    await page.goto(config.webBase + '/supervisor/attendance');
    await page.waitForLoadState('networkidle');

    // Verify both filters present.
    const classSelect = page.locator('select').first();
    const dateInput = page.locator('input[type="date"]').first();
    await expect(classSelect).toBeVisible({ timeout: 10_000 });
    await expect(dateInput).toBeVisible({ timeout: 5_000 });

    // Pick the first class and ensure something rendered after.
    const opts = await classSelect.locator('option').count();
    if (opts > 1) {
      const v = await classSelect.locator('option').nth(1).getAttribute('value');
      if (v) {
        await classSelect.selectOption(v);
        await page.waitForLoadState('networkidle');
      }
    }
    const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
    expect(errored).toBe(false);
  });

  test('3.5 homework feed shows the day-2 post', async () => {
    await page.goto(config.webBase + '/supervisor/homework');
    await page.waitForLoadState('networkidle');

    // Substring match — QA_MARKER has literal parens that would be
    // regex metacharacters in a /.../ matcher.
    const marker = page.getByText(`${QA_MARKER} homework`, { exact: false }).first();
    const visible = await marker.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!visible) {
      recordFinding({
        day: 'supervisor',
        severity: 'High',
        feature: 'Homework feed — missing teacher post',
        issue: `Day-2 teacher posted homework titled "${QA_MARKER} homework" — supervisor feed does not show it.`,
        repro: 'Login as supervisor → /supervisor/homework; look for the marker.',
      });
    }
  });

  test('3.6 assignments feed shows the day-2 post', async () => {
    await page.goto(config.webBase + '/supervisor/assignments');
    await page.waitForLoadState('networkidle');

    const marker = page.getByText(`${QA_MARKER} assignment`, { exact: false }).first();
    const visible = await marker.isVisible({ timeout: 10_000 }).catch(() => false);
    if (!visible) {
      recordFinding({
        day: 'supervisor',
        severity: 'High',
        feature: 'Assignments feed — missing teacher post',
        issue: `Day-2 teacher posted assignment titled "${QA_MARKER} assignment" — supervisor feed does not show it.`,
        repro: 'Login as supervisor → /supervisor/assignments; look for the marker.',
      });
    }
  });

  test('3.7 student reports list — day-2 report should be visible', async () => {
    await page.goto(config.webBase + '/supervisor/student-reports');
    await page.waitForLoadState('networkidle');

    // Either the report body inlines "QA day-2 (grade5) — section …" or a
    // student name will be visible — accept any sign of populated content.
    const markerHit = await page.getByText(QA_MARKER, { exact: false }).first().isVisible({ timeout: 3_000 }).catch(() => false);
    const nigaHit = await page.locator('text=/niga|shilan|rauf|karwan|rewan/i').first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (!markerHit && !nigaHit) {
      recordFinding({
        day: 'supervisor',
        severity: 'Medium',
        feature: 'Student reports list — empty after teacher submission',
        issue: 'Day-2 teacher submitted a report; supervisor list does not show it.',
        repro: 'Login as supervisor → /supervisor/student-reports.',
      });
    }
  });

  test('3.8 weekly summary page renders for supervisor', async () => {
    await page.goto(config.webBase + '/supervisor/weekly-summary');
    await page.waitForLoadState('networkidle');
    const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
    expect(errored).toBe(false);
  });
});
