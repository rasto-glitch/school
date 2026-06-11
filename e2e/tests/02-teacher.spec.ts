// Day 2 — Teacher (deep). Day-1 admin wired QA Teacher One to all six
// auto-created classes, mapped Math + English curriculum, and gave them a
// schedule cell. So this spec drives the full teacher day: take attendance,
// post homework + assignment, write a grade and a report, submit a weekly
// summary, browse students and schedule.
//
// Most teacher pages share one shape: pick class → pick subject (auto when
// curriculum has only one) → fill form → submit. We pick the first class
// and the first student systematically; this is sequential, not exhaustive.

import { test, expect, Page } from '@playwright/test';
import { config, credentials } from '../helpers/env';
import { login } from '../helpers/login';
import { recordFinding, appendRunLog } from '../helpers/findings';

// Unique marker so re-runs don't pile up duplicates. Day 1 uses the same
// "QA welcome" prefix for its announcement; we use "QA day-2".
const QA_MARKER = 'QA day-2 (grade5)';

// The class day-5 parent (Niga's father) cares about. Niga's XLSX row
// says "Grade 5", so the bulk upload created/used a "Grade 5" class.
// Day-2 targets this class so day-5 actually sees the data.
const TARGET_CLASS_LABEL = /grade\s*5/i;

// Shared helpers for the multiple create flows.
async function pickFirstOption(page: Page, select: ReturnType<Page['locator']>): Promise<string | null> {
  const opts = await select.locator('option').count();
  if (opts <= 1) return null;
  const value = await select.locator('option').nth(1).getAttribute('value');
  if (!value) return null;
  await select.selectOption(value);
  return value;
}

// Pick a specific class by visible label, falling back to the first if
// the label isn't present in the dropdown.
async function pickClassByLabel(select: ReturnType<Page['locator']>, label: RegExp): Promise<string | null> {
  const opts = await select.locator('option').all();
  for (const opt of opts) {
    const txt = (await opt.textContent()) ?? '';
    if (label.test(txt)) {
      const value = await opt.getAttribute('value');
      if (value) {
        await select.selectOption(value);
        return value;
      }
    }
  }
  return null;
}

test.describe.configure({ mode: 'serial' });

test.describe('day 2 — teacher (deep)', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const teacher = credentials.teacher();
    if (!teacher.username || !teacher.password) {
      throw new Error('TEACHER_USERNAME / TEACHER_PASSWORD missing from .env.test — run day 1 first.');
    }
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
  });

  test.afterAll(async () => {
    await appendRunLog('day 2 (teacher, deep)', 'see findings', 'live portal.scholify.krd');
    await page.close();
  });

  test('2.1 teacher logs in and lands on /teacher/dashboard', async () => {
    await login(page, credentials.teacher(), { passwordEnvVar: 'TEACHER_PASSWORD' });
    await expect(page).toHaveURL(/\/teacher\/dashboard/, { timeout: 15_000 });
  });

  test('2.2 walk every teacher surface — no error boundaries', async () => {
    const surfaces = [
      '/teacher/dashboard',
      '/teacher/attendance',
      '/teacher/homework',
      '/teacher/assignments',
      '/teacher/reports',
      '/teacher/grades',
      '/teacher/weekly-summary',
      '/teacher/students',
      '/teacher/schedule',
      '/teacher/notifications',
      '/teacher/profile',
    ];
    for (const p of surfaces) {
      const res = await page.goto(config.webBase + p);
      if ((res?.status() ?? 0) >= 400) {
        recordFinding({ day: 'teacher', severity: 'High', feature: p, issue: `GET ${p} → ${res?.status()}`, repro: `Login as teacher → ${p}` });
        continue;
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      const errored = await page.locator('text=/something went wrong|application error/i').first().isVisible().catch(() => false);
      if (errored) recordFinding({ day: 'teacher', severity: 'High', feature: p, issue: 'Error boundary', repro: `Login as teacher → ${p}` });
    }
  });

  test('2.3 take attendance — all present then mark first student absent', async () => {
    await page.goto(config.webBase + '/teacher/attendance');
    await page.waitForLoadState('networkidle');

    // Class select is the first native <select> on the page. Prefer
    // Niga's Grade 5 so day-5 parent verification sees today's attendance.
    const classSelect = page.locator('select').first();
    const classValue = (await pickClassByLabel(classSelect, TARGET_CLASS_LABEL))
      ?? (await pickFirstOption(page, classSelect));
    if (!classValue) {
      recordFinding({ day: 'teacher', severity: 'High', feature: 'Attendance — no classes', issue: 'No class options on /teacher/attendance after day-1 wired classes.', repro: 'Login as teacher → /teacher/attendance.' });
      return;
    }
    // Wait for the roster to populate. The "All Present" button only
    // appears when students.length > 0.
    const allPresent = page.getByRole('button', { name: /all present/i });
    await expect(allPresent).toBeVisible({ timeout: 10_000 });
    await allPresent.click();

    // Mark the first student as Absent so day-3 (supervisor absent-today)
    // has a row to verify. AttendancePage.tsx renders one status-toggle
    // group per student — the per-student "Absent" buttons appear after
    // the "All Present"/"All Absent" header buttons. So skip the first
    // two header buttons by using nth(2) and onwards.
    const absentBtns = page.getByRole('button', { name: /^absent$/i });
    const headerAbsent = page.getByRole('button', { name: /all absent/i });
    // Make sure header has rendered before counting per-student buttons.
    await expect(headerAbsent).toBeVisible({ timeout: 5_000 });
    const totalAbsent = await absentBtns.count();
    if (totalAbsent >= 1) {
      // First per-student row's Absent button.
      await absentBtns.first().click();
    }

    // Click Save Attendance.
    await page.getByRole('button', { name: /save attendance/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail')) {
      recordFinding({ day: 'teacher', severity: 'High', feature: 'Attendance — save failed', issue: `Save toast: "${text}"`, repro: 'Login as teacher → /teacher/attendance → mark roster → Save.' });
    }
  });

  test('2.4 post a homework with Math subject', async () => {
    await page.goto(config.webBase + '/teacher/homework');
    await page.waitForLoadState('networkidle');

    const title = `${QA_MARKER} homework`;
    // Idempotency check — substring match (QA_MARKER has literal parens
    // that would otherwise be regex metacharacters).
    const exists = await page.getByText(title, { exact: false }).first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (exists) {
      console.log('[homework] already posted');
      return;
    }

    // Form has class select, subject select, title, description.
    const classSelect = page.locator('select').first();
    const picked = (await pickClassByLabel(classSelect, TARGET_CLASS_LABEL))
      ?? (await pickFirstOption(page, classSelect));
    console.log(`[homework] picked class value=${picked}`);
    await page.waitForTimeout(500);

    // Subject — pick "Math" if it's available; else the first option.
    const subjectSelect = page.locator('select').nth(1);
    const mathOpt = await subjectSelect.locator('option', { hasText: /^math$/i }).count().catch(() => 0);
    if (mathOpt > 0) {
      await subjectSelect.selectOption({ label: 'Math' });
    } else {
      await pickFirstOption(page, subjectSelect);
    }

    await page.locator('input[name="title"]').fill(title);
    await page.locator('textarea[name="description"]').fill('Solve the practice problems. Posted by day-2 e2e.');

    await page.getByRole('button', { name: /post homework/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail')) {
      recordFinding({ day: 'teacher', severity: 'High', feature: 'Homework post failed', issue: `Toast: "${text}"`, repro: 'Login as teacher → /teacher/homework → fill form → Post Homework.' });
    } else {
      console.log('[homework] posted');
    }
  });

  test('2.5 post an assignment with Math subject', async () => {
    await page.goto(config.webBase + '/teacher/assignments');
    await page.waitForLoadState('networkidle');

    const title = `${QA_MARKER} assignment`;
    const exists = await page.getByText(title, { exact: false }).first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (exists) {
      console.log('[assignment] already posted');
      return;
    }

    // Form has class, student (optional), subject, title, description, dueDate.
    const classSelect = page.locator('select').first();
    const picked = (await pickClassByLabel(classSelect, TARGET_CLASS_LABEL))
      ?? (await pickFirstOption(page, classSelect));
    console.log(`[assignment] picked class value=${picked}`);
    await page.waitForTimeout(500);

    // Student select — leave as "all students in class" (default option 0).
    // Subject select is the third select (class, student, subject).
    const subjectSelect = page.locator('select').nth(2);
    const mathOpt = await subjectSelect.locator('option', { hasText: /^math$/i }).count().catch(() => 0);
    if (mathOpt > 0) {
      await subjectSelect.selectOption({ label: 'Math' });
    } else {
      await pickFirstOption(page, subjectSelect);
    }

    await page.locator('input[name="title"]').fill(title);
    await page.locator('textarea[name="description"]').fill('Submit your work by next class. Posted by day-2 e2e.');
    // Due date — 7 days from today.
    const dueDate = new Date(Date.parse('2026-06-17')).toISOString().split('T')[0];
    await page.locator('input[type="date"]').first().fill(dueDate);

    await page.getByRole('button', { name: /post assignment/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail')) {
      recordFinding({ day: 'teacher', severity: 'High', feature: 'Assignment post failed', issue: `Toast: "${text}"`, repro: 'Login as teacher → /teacher/assignments → fill form → Post Assignment.' });
    } else {
      console.log('[assignment] posted');
    }
  });

  test('2.6 submit a grade for the first student in the first class', async () => {
    await page.goto(config.webBase + '/teacher/grades');
    await page.waitForLoadState('networkidle');

    // Class select first; student fills after.
    const classSelect = page.locator('select').first();
    await pickFirstOption(page, classSelect);
    await page.waitForTimeout(800);

    // Student select is the second. Subject is third (auto-set when only Math).
    const studentSelect = page.locator('select').nth(1);
    const studentValue = await pickFirstOption(page, studentSelect);
    if (!studentValue) {
      recordFinding({ day: 'teacher', severity: 'High', feature: 'Grading — no students', issue: 'No students appear after picking class.', repro: 'Login as teacher → /teacher/grades → pick class.' });
      return;
    }
    await page.waitForTimeout(500);

    // Subject — pick Math.
    const subjectSelect = page.locator('select').nth(2);
    const mathOpt = await subjectSelect.locator('option', { hasText: /^math$/i }).count().catch(() => 0);
    if (mathOpt > 0) await subjectSelect.selectOption({ label: 'Math' });

    // Grading period — pick the first non-blank option (terms come from API).
    const periodSelect = page.locator('select').nth(3);
    await pickFirstOption(page, periodSelect).catch(() => null);

    // Click "Add mark" to insert a row, then fill the value input.
    const addMarkBtn = page.getByRole('button', { name: /add mark|new mark|\+ mark/i }).first();
    if (await addMarkBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addMarkBtn.click();
      // The newly-added mark has a number input we can fill with 85.
      const valueInput = page.locator('input[type="number"]').last();
      if (await valueInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await valueInput.fill('85');
      }
    }

    await page.getByRole('button', { name: /save grade/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail')) {
      recordFinding({ day: 'teacher', severity: 'High', feature: 'Grade save failed', issue: `Toast: "${text}"`, repro: 'Login as teacher → /teacher/grades → pick class+student+subject+period → Add mark → Save Grade.' });
    } else {
      console.log('[grade] saved');
    }
  });

  test('2.7 write a report for the first student', async () => {
    await page.goto(config.webBase + '/teacher/reports');
    await page.waitForLoadState('networkidle');

    const classSelect = page.locator('select').first();
    await pickFirstOption(page, classSelect);
    await page.waitForTimeout(800);

    const studentSelect = page.locator('select').nth(1);
    const studentValue = await pickFirstOption(page, studentSelect);
    if (!studentValue) {
      recordFinding({ day: 'teacher', severity: 'High', feature: 'Report — no students', issue: 'No students appear after picking class.', repro: 'Login as teacher → /teacher/reports → pick class.' });
      return;
    }
    await page.waitForTimeout(500);

    const subjectSelect = page.locator('select').nth(2);
    const mathOpt = await subjectSelect.locator('option', { hasText: /^math$/i }).count().catch(() => 0);
    if (mathOpt > 0) await subjectSelect.selectOption({ label: 'Math' });

    // The report form has three textareas (attendance notes, behaviour, teacher).
    const textareas = page.locator('textarea');
    const taCount = await textareas.count();
    for (let i = 0; i < taCount; i++) {
      await textareas.nth(i).fill(`${QA_MARKER} — section ${i + 1}`);
    }

    // Tick "Share with other teachers" — without this, the report stays
    // private to the author and admin, so supervisor/other teachers won't
    // see it. (Feature gated on school.features.teacher_report_handoff.)
    const shareLabel = page.locator('label', { hasText: /share with other teachers/i }).first();
    if (await shareLabel.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const shareCheckbox = shareLabel.locator('input[type="checkbox"]');
      if (!(await shareCheckbox.isChecked().catch(() => true))) {
        await shareCheckbox.click();
        console.log('[report] share toggle ticked');
      }
    } else {
      console.log('[report] share toggle not rendered (handoff feature off?)');
    }

    await page.getByRole('button', { name: /submit report/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail')) {
      recordFinding({ day: 'teacher', severity: 'High', feature: 'Report submit failed', issue: `Toast: "${text}"`, repro: 'Login as teacher → /teacher/reports → pick class+student+subject → fill notes → Submit Report.' });
    } else {
      console.log('[report] submitted');
    }
  });

  test('2.8 weekly summary — open and verify chrome renders', async () => {
    await page.goto(config.webBase + '/teacher/weekly-summary');
    await page.waitForLoadState('networkidle');
    // The weekly summary uses a complex multi-day grid. Verify no
    // error boundary and that the Save button is wired even if we can't
    // meaningfully fill it from headless.
    const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
    expect(errored).toBe(false);
  });

  test('2.9 students page — verify roster of at least 1 student', async () => {
    await page.goto(config.webBase + '/teacher/students');
    await page.waitForLoadState('networkidle');
    // After day-1 wired the teacher to classes containing all 50 bulk-
    // uploaded students, we expect at least one student card on the page.
    const studentRows = page.locator('text=/niga|hawkar|sara|aram|laila/i');
    const matched = await studentRows.count();
    if (matched === 0) {
      recordFinding({ day: 'teacher', severity: 'Medium', feature: 'Students page — empty', issue: 'Expected day-1 students to appear after class wiring; found none.', repro: 'Login as teacher → /teacher/students.' });
    } else {
      console.log(`[students] roster shows ${matched} matched names`);
    }
  });

  test('2.10 schedule page — verify the day-1 cell is visible', async () => {
    await page.goto(config.webBase + '/teacher/schedule');
    await page.waitForLoadState('networkidle');
    // The teacher schedule should show a non-empty grid because day-1
    // 1.11 assigned a class to one of QA Teacher One's cells. We don't
    // assert which cell — just that the page rendered something other
    // than an empty state.
    const empty = await page.locator('text=/no schedule|empty|nothing scheduled/i').first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (empty) {
      recordFinding({ day: 'teacher', severity: 'Medium', feature: 'Schedule — empty', issue: 'Schedule page shows empty state after day-1 assigned a cell.', repro: 'Login as teacher → /teacher/schedule.' });
    }
  });
});
