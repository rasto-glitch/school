// Day 6 — Accountant (deep). The accountant owns money. This spec walks
// every accounting surface, creates a payment account (the prerequisite
// for recording tuition or expenses), and verifies all four reports
// render. Tuition plan creation and payment recording are intentionally
// out of scope — they require multi-step orchestration that's better
// driven once we have a paying parent flow set up end-to-end.

import { test, expect, Page } from '@playwright/test';
import { config, credentials } from '../helpers/env';
import { login } from '../helpers/login';
import { recordFinding, appendRunLog } from '../helpers/findings';

test.describe.configure({ mode: 'serial' });

test.describe('day 6 — accountant (deep)', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const acc = credentials.accountant();
    if (!acc.username || !acc.password) {
      throw new Error('ACCOUNTANT_USERNAME / ACCOUNTANT_PASSWORD missing from .env.test — run day 1 first.');
    }
    const ctx = await browser.newContext();
    page = await ctx.newPage();
    page.on('pageerror', err => console.log(`[pageerror] ${err.message}`));
  });

  test.afterAll(async () => {
    await appendRunLog('day 6 (accountant, deep)', 'see findings', 'live portal.scholify.krd');
    await page.close();
  });

  test('6.1 accountant logs in and lands on /accounting', async () => {
    await login(page, credentials.accountant(), { passwordEnvVar: 'ACCOUNTANT_PASSWORD' });
    await expect(page).toHaveURL(/\/accounting/, { timeout: 15_000 });
  });

  test('6.2 walk every accounting surface', async () => {
    const surfaces = [
      '/accounting',
      '/accounting/dashboard',
      '/accounting/staff',
      '/accounting/expenses',
      '/accounting/ledger',
      '/accounting/general-ledger',
      '/accounting/reports/ar-aging',
      '/accounting/reports/profit-loss',
      '/accounting/reports/cash-flow',
      '/accounting/reports/tax',
      '/accounting/periods',
      '/accounting/payment-accounts',
      '/accounting/fx-rates',
      '/accounting/profile',
    ];
    for (const p of surfaces) {
      const res = await page.goto(config.webBase + p);
      if ((res?.status() ?? 0) >= 400) {
        recordFinding({ day: 'accountant', severity: 'High', feature: p, issue: `GET ${p} → ${res?.status()}`, repro: `Login as accountant → ${p}` });
        continue;
      }
      await page.waitForLoadState('networkidle').catch(() => {});
      const errored = await page.locator('text=/something went wrong|application error/i').first().isVisible().catch(() => false);
      if (errored) recordFinding({ day: 'accountant', severity: 'High', feature: p, issue: 'Error boundary', repro: `Login as accountant → ${p}` });
    }
  });

  test('6.3 create a payment account (idempotent)', async () => {
    await page.goto(config.webBase + '/accounting/payment-accounts');
    await page.waitForLoadState('networkidle');

    const QA_ACCOUNT_NAME = 'QA Cash USD';
    const exists = await page.locator(`text=/${QA_ACCOUNT_NAME}/i`).first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (exists) {
      console.log('[payment-account] already exists');
      return;
    }

    // Click "New Account" — opens Modal.
    await page.getByRole('button', { name: /new account/i }).first().click();

    // Modal renders. Name input is the first input.
    const modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await modal.locator('input').first().fill(QA_ACCOUNT_NAME);

    // Kind defaults to "cash"; currency defaults to "USD". Opening balance
    // already "0". Just click Save.
    await modal.getByRole('button', { name: /^save$/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail') || text.includes('error')) {
      recordFinding({
        day: 'accountant',
        severity: 'High',
        feature: 'Payment account create failed',
        issue: `Toast: "${text}"`,
        repro: 'Login as accountant → /accounting/payment-accounts → New Account → Save.',
      });
    } else {
      console.log('[payment-account] created');
    }
  });

  test('6.4 all four reports render data (or empty state) cleanly', async () => {
    const reports = [
      { path: '/accounting/reports/ar-aging',    label: 'AR Aging' },
      { path: '/accounting/reports/profit-loss', label: 'Profit & Loss' },
      { path: '/accounting/reports/cash-flow',   label: 'Cash Flow Forecast' },
      { path: '/accounting/reports/tax',         label: 'Tax Report' },
    ];
    for (const r of reports) {
      await page.goto(config.webBase + r.path);
      await page.waitForLoadState('networkidle');
      const errored = await page.locator('text=/something went wrong|application error/i').first().isVisible().catch(() => false);
      if (errored) {
        recordFinding({
          day: 'accountant',
          severity: 'High',
          feature: `${r.label} report — error boundary`,
          issue: `Error boundary surfaced on ${r.path}.`,
          repro: `Login as accountant → ${r.path}`,
        });
      }
    }
  });

  test('6.5 expenses page — tabs render and Add Expense flow opens', async () => {
    await page.goto(config.webBase + '/accounting/expenses');
    await page.waitForLoadState('networkidle');

    // Verify tabs present (recurring/one-time/categories/voided).
    const recurringTab = page.getByRole('button', { name: /recurring/i }).first();
    await expect(recurringTab).toBeVisible({ timeout: 10_000 });

    // Open the One-time tab to access the "Add Expense" UI.
    await page.getByRole('button', { name: /one[ -]?time/i }).first().click();
    await page.waitForLoadState('networkidle');

    // OneTimeTab shows a <LoadingSpinner /> until the list resolves. The
    // "New expense" button only renders after that. Wait explicitly.
    const newBtn = page.getByRole('button', { name: /^new expense$/i }).first();
    try {
      await expect(newBtn).toBeVisible({ timeout: 10_000 });
      console.log('[expenses] New Expense button visible');
    } catch {
      recordFinding({
        day: 'accountant',
        severity: 'Low',
        feature: 'Expenses — Add button missing',
        issue: 'On /accounting/expenses → One-time tab, "New expense" button not visible within 10s after tab activated.',
        repro: 'Login as accountant → /accounting/expenses → One-time.',
      });
    }
  });

  test('6.6 tuition settings tab — currency and config render', async () => {
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');

    // The AdminTuitionPage shows several sub-tabs (Students/Families/
    // Settings/Plans/Voided/Archive depending on flags). Click Settings.
    const settingsBtn = page.getByRole('button', { name: /^settings$/i }).first();
    if (await settingsBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await settingsBtn.click();
      await page.waitForLoadState('networkidle');
      const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
      expect(errored).toBe(false);
    } else {
      console.log('[tuition] Settings tab not visible — page may default to it');
    }
  });

  test('6.7 periods page — verify management chrome', async () => {
    await page.goto(config.webBase + '/accounting/periods');
    await page.waitForLoadState('networkidle');
    const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
    expect(errored).toBe(false);
  });

  test('6.8 FX rates page — verify chrome', async () => {
    await page.goto(config.webBase + '/accounting/fx-rates');
    await page.waitForLoadState('networkidle');
    const errored = await page.locator('text=/something went wrong/i').first().isVisible().catch(() => false);
    expect(errored).toBe(false);
  });

  test('6.9 tuition settings — ensure currency=USD is saved', async () => {
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');

    // Click the Settings tab on AdminTuitionPage.
    await page.getByRole('button', { name: /^settings$/i }).first().click();
    await page.waitForLoadState('networkidle');

    // Wait for the currency input to render (first <input> on the tab,
    // immediately under "Currency" heading; capped at 8 chars).
    const currencyInput = page.locator('input').first();
    await expect(currencyInput).toBeVisible({ timeout: 10_000 });
    const current = (await currencyInput.inputValue()).trim();
    if (current.toUpperCase() !== 'USD') {
      await currencyInput.fill('USD');
    }

    // Click "Save Settings" — Save button under the sibling-discount card,
    // i18n: accounting.settings.save_settings → "Save Settings".
    await page.getByRole('button', { name: /save settings/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
  });

  test('6.10 create a tuition plan + assign to all students (idempotent)', async () => {
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');

    // Click Plans tab.
    await page.getByRole('button', { name: /^plans$/i }).first().click();
    await page.waitForLoadState('networkidle');

    const PLAN_NAME = 'QA Tuition USD 100';
    // Idempotency — if the plan already exists, skip creation and only
    // click Assign to ensure invoice rows for new students.
    const existingPlan = await page.getByText(PLAN_NAME, { exact: false }).first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (!existingPlan) {
      // Open the New Plan modal.
      await page.getByRole('button', { name: /new plan/i }).first().click();
      const modal = page.locator('div.fixed.inset-0.z-50').last();
      await expect(modal).toBeVisible({ timeout: 5_000 });

      // Modal inputs in order: name, total amount, currency, academic year,
      // installment amount, installment date. Fill name + total + first
      // installment amount = 100 to satisfy validation (sum must equal total).
      const inputs = modal.locator('input');
      await inputs.nth(0).fill(PLAN_NAME);                     // name
      await inputs.nth(1).fill('100');                         // total amount
      // input nth(2) is currency, default 'USD' is fine — leave.
      // input nth(3) is academic year (auto-filled or empty), leave.
      // input nth(4) is first-installment amount; default 0 → fill 100.
      await inputs.nth(4).fill('100');
      // input nth(5) is the due date — leave today's default.

      await modal.getByRole('button', { name: /create plan/i }).first().click();
      const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
      await expect(toast).toBeVisible({ timeout: 15_000 });
      const text = (await toast.textContent())?.toLowerCase() ?? '';
      if (text.includes('fail') || text.includes('error')) {
        recordFinding({
          day: 'accountant',
          severity: 'High',
          feature: 'Tuition plan create failed',
          issue: `Toast: "${text}"`,
          repro: 'Login as accountant → /accounting → Plans → New plan → fill name + 100 → Create.',
        });
        return;
      }
      console.log('[tuition-plan] created');
      // The save() handler in TuitionPlansTab calls setEditing(null) on
      // success but the toast fires before the React rerender flushes.
      // Wait for the modal overlay to actually disappear before clicking
      // Assign — otherwise the backdrop intercepts the click.
      await expect(modal).toBeHidden({ timeout: 10_000 });
      await page.waitForLoadState('networkidle');
    } else {
      console.log('[tuition-plan] already exists');
    }

    // Find the Assign button — plan list renders one Assign per plan.
    const assignBtn = page.getByRole('button', { name: /^assign$/i }).first();
    if (await assignBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await assignBtn.click();
      const assignToast = page.locator('.Toastify__toast--success, .Toastify__toast--error').last();
      await expect(assignToast).toBeVisible({ timeout: 15_000 });
      const assignText = (await assignToast.textContent())?.toLowerCase() ?? '';
      console.log(`[tuition-assign] ${assignText}`);
      if (assignText.includes('fail')) {
        recordFinding({
          day: 'accountant',
          severity: 'Medium',
          feature: 'Tuition plan assign failed',
          issue: `Toast: "${assignText}"`,
          repro: 'Click Assign on the QA Tuition USD 100 plan row.',
        });
      }
    } else {
      recordFinding({
        day: 'accountant',
        severity: 'Medium',
        feature: 'Tuition plan — Assign button missing',
        issue: 'Plan row rendered but no Assign button visible.',
        repro: 'Login as accountant → /accounting → Plans → find QA Tuition USD 100 → look for Assign.',
      });
    }
  });

  test('6.11 tuition students rollup shows Niga in the list', async () => {
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');

    // AdminTuitionPage defaults to the Students sub-tab. After day-6.10's
    // Assign, Niga should appear with $100 due. Each row is a <button>
    // containing the student name — clicking navigates to the detail page.
    const nigaRow = page.getByRole('button').filter({ hasText: /niga/i }).first();
    await expect(nigaRow).toBeVisible({ timeout: 10_000 });
  });

  test('6.12 record a $100 payment for Niga (closes the financial loop)', async () => {
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');

    // Open Niga's tuition detail page.
    const nigaRow = page.getByRole('button').filter({ hasText: /niga/i }).first();
    await expect(nigaRow).toBeVisible({ timeout: 10_000 });
    await nigaRow.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/accounting\/student\//, { timeout: 10_000 });

    // Idempotency — if the plan already shows "Paid in full" / 0 remaining,
    // a prior run already recorded the payment. Skip.
    const alreadyPaid = await page.locator('text=/paid in full|paid up|0\\.00 left/i').first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (alreadyPaid) {
      console.log('[payment] already recorded (plan shows paid in full)');
      return;
    }

    // Click "Record payment" — opens modal.
    const recordBtn = page.getByRole('button', { name: /^record payment$/i }).first();
    await expect(recordBtn).toBeVisible({ timeout: 5_000 });
    await recordBtn.click();
    const modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // The modal shows one installment row (we created a plan with a single
    // $100 installment in 6.10). The first per-installment <input> takes
    // the allocation amount.
    const installmentInput = modal.locator('input[type="number"]').first();
    await installmentInput.fill('100');

    // "Deposit into" select — first <select> in the modal (method is also a
    // select, but Deposit into is the one with the QA Cash USD account).
    // Find by walking selects until one has a non-empty option list matching
    // our payment account.
    const selects = modal.locator('select');
    const selectCount = await selects.count();
    for (let i = 0; i < selectCount; i++) {
      const opts = await selects.nth(i).locator('option').all();
      for (const opt of opts) {
        const txt = (await opt.textContent()) ?? '';
        if (/qa cash usd/i.test(txt)) {
          const v = await opt.getAttribute('value');
          if (v) await selects.nth(i).selectOption(v);
          break;
        }
      }
    }

    // Click "Record".
    await modal.getByRole('button', { name: /^record$/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail') || text.includes('error')) {
      recordFinding({
        day: 'accountant',
        severity: 'High',
        feature: 'Record payment failed',
        issue: `Toast: "${text}"`,
        repro: 'Login as accountant → /accounting → click Niga → Record payment → allocate $100 → pick QA Cash USD → Record.',
      });
    } else {
      console.log('[payment] $100 recorded for Niga');
    }
  });

  test('6.13 set staff salary $500 for QA Teacher One (idempotent)', async () => {
    await page.goto(config.webBase + '/accounting/staff');
    await page.waitForLoadState('networkidle');

    // Active tab is default. If QA Teacher One already has a salary row,
    // skip — re-adding the same userId throws "already linked".
    const existingRow = await page.getByText(/qa teacher one/i).first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (existingRow) {
      console.log('[staff-salary] QA Teacher One already on payroll');
      return;
    }

    // Click "Add to payroll" → opens modal.
    const addBtn = page.getByRole('button', { name: /add to payroll/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();
    const modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // First select inside modal is the employee picker. Pick QA Teacher One.
    const employeeSelect = modal.locator('select').first();
    const opts = await employeeSelect.locator('option').all();
    let teacherValue: string | null = null;
    for (const opt of opts) {
      const txt = (await opt.textContent()) ?? '';
      if (/qa teacher one/i.test(txt)) {
        teacherValue = await opt.getAttribute('value');
        break;
      }
    }
    if (!teacherValue) {
      recordFinding({
        day: 'accountant',
        severity: 'Medium',
        feature: 'Staff salary — teacher not in setup dropdown',
        issue: 'QA Teacher One not in /accounting/staff Add modal employee dropdown.',
        repro: 'Login as accountant → /accounting/staff → Add to payroll → check Employee select.',
      });
      // Close modal.
      await modal.locator('div.absolute.inset-0').first().click({ force: true, position: { x: 5, y: 5 } });
      return;
    }
    await employeeSelect.selectOption(teacherValue);

    // Find salary amount input. The modal has inputs in order: salary,
    // currency, next payment date, insurance %. The first input with
    // type="number" is salaryAmount.
    const salaryInput = modal.locator('input[type="number"]').first();
    await salaryInput.fill('500');

    // Click Save (or "Add" depending on whether it's create).
    await modal.getByRole('button', { name: /^save$|add to payroll/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail') || text.includes('error')) {
      recordFinding({
        day: 'accountant',
        severity: 'High',
        feature: 'Staff salary create failed',
        issue: `Toast: "${text}"`,
        repro: 'Login as accountant → /accounting/staff → Add to payroll → pick QA Teacher One → 500 → Save.',
      });
    } else {
      console.log('[staff-salary] $500 set for QA Teacher One');
    }
  });

  test('6.14 create expense category "QA Office Supplies" (idempotent)', async () => {
    await page.goto(config.webBase + '/accounting/expenses');
    await page.waitForLoadState('networkidle');

    // Click Categories tab.
    await page.getByRole('button', { name: /^categories$/i }).first().click();
    await page.waitForLoadState('networkidle');

    const CATEGORY = 'QA Office Supplies';
    const exists = await page.getByText(CATEGORY, { exact: false }).first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (exists) {
      console.log('[expense-cat] already exists');
      return;
    }

    // The categories tab has an "Add category" heading and a form below.
    // First input on the tab is the category name field.
    const nameInput = page.locator('input').first();
    await expect(nameInput).toBeVisible({ timeout: 10_000 });
    await nameInput.fill(CATEGORY);
    await page.getByRole('button', { name: /^add category$|^add$/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    console.log('[expense-cat] created');
  });

  test('6.15 add a one-time expense $25 for paper (idempotent)', async () => {
    await page.goto(config.webBase + '/accounting/expenses');
    await page.waitForLoadState('networkidle');

    // Click One-time tab.
    await page.getByRole('button', { name: /one[ -]?time/i }).first().click();
    await page.waitForLoadState('networkidle');

    const MEMO = 'QA paper';
    const exists = await page.getByText(MEMO, { exact: false }).first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (exists) {
      console.log('[expense-one-time] already exists');
      return;
    }

    // Wait for New expense to render (OneTimeTab shows LoadingSpinner first).
    const newBtn = page.getByRole('button', { name: /^new expense$/i }).first();
    await expect(newBtn).toBeVisible({ timeout: 10_000 });
    await newBtn.click();

    // Form mounts inline as a Card with "New expense" heading. Inputs in
    // source order (ExpensesPage.tsx:650+):
    //   0 text  "What"            ← name
    //   1 number "Amount"          ← 25
    //   2 text  "Currency"         (default USD — skip)
    //   3 date  "Date"             (skip — defaults to today)
    //   4 text  "Vendor"           (skip)
    //   5 text  "Payment method"   (skip)
    //   6 number "Tax"             (skip)
    //   7 text  "Tax label"        (skip)
    //   8 text  "Notes"            (skip)
    // Selects in order: [0] Category, [1] Paid from.
    // Scope to the form card so we don't grab the filter inputs above.
    const formCard = page.locator('div').filter({ has: page.getByRole('heading', { name: /^new expense$/i }) }).last();
    await formCard.locator('input:not([type="date"]):not([type="number"])').first().fill(MEMO);
    await formCard.locator('input[type="number"]').first().fill('25');

    // Pick category in the form's first select.
    const formCatSelect = formCard.locator('select').first();
    const catOpts = await formCatSelect.locator('option').all();
    for (const opt of catOpts) {
      const txt = (await opt.textContent()) ?? '';
      if (/qa office supplies/i.test(txt)) {
        const v = await opt.getAttribute('value');
        if (v) await formCatSelect.selectOption(v);
        break;
      }
    }

    // Pick payment account in the form's second select.
    const formAccSelect = formCard.locator('select').nth(1);
    const accOpts = await formAccSelect.locator('option').all();
    for (const opt of accOpts) {
      const txt = (await opt.textContent()) ?? '';
      if (/qa cash usd/i.test(txt)) {
        const v = await opt.getAttribute('value');
        if (v) await formAccSelect.selectOption(v);
        break;
      }
    }

    // Submit — button reads "Record expense" (i18n: accounting.exp.record_expense).
    await formCard.getByRole('button', { name: /^record expense$/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail') || text.includes('error')) {
      recordFinding({
        day: 'accountant',
        severity: 'Medium',
        feature: 'Expense create failed',
        issue: `Toast: "${text}"`,
        repro: 'Login as accountant → /accounting/expenses → One-time → New expense → fill form → Record expense.',
      });
    } else {
      console.log('[expense-one-time] created');
    }
  });

  test('6.16 add FX rate USD→IQD 1500 (idempotent — overwrites if exists)', async () => {
    await page.goto(config.webBase + '/accounting/fx-rates');
    await page.waitForLoadState('networkidle');

    // The form has 5 columns: from currency, to currency, rate, effective
    // date, Save button. Defaults are already USD→IQD with today's date.
    // Just fill the rate and click Save.
    const rateInput = page.locator('input[type="number"]').first();
    await expect(rateInput).toBeVisible({ timeout: 10_000 });
    await rateInput.fill('1500');

    await page.getByRole('button', { name: /^save$/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail') || text.includes('error')) {
      recordFinding({
        day: 'accountant',
        severity: 'Low',
        feature: 'FX rate save failed',
        issue: `Toast: "${text}"`,
        repro: 'Login as accountant → /accounting/fx-rates → fill rate=1500 → Save.',
      });
    } else {
      console.log('[fx-rate] USD→IQD 1500 saved');
    }
  });

  test('6.17 ledger page renders entries after payment + expense', async () => {
    await page.goto(config.webBase + '/accounting/ledger');
    await page.waitForLoadState('networkidle');

    // After 6.12 ($100 income) + 6.15 ($25 expense) we should see at least
    // two rows. Look for any USD amount on the page as a proxy.
    const hasAmount = await page.locator('text=/\\$\\s*\\d|usd\\s*\\d|100|25/i').first().isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasAmount) {
      recordFinding({
        day: 'accountant',
        severity: 'Medium',
        feature: 'Ledger empty after payment + expense',
        issue: 'After recording a $100 tuition payment and a $25 expense, /accounting/ledger shows no rows.',
        repro: 'Login as accountant → /accounting/ledger after day-5 6.12 and 6.15 have run.',
      });
    }
  });

  test('6.18 create recurring expense template + record one instance', async () => {
    await page.goto(config.webBase + '/accounting/expenses');
    await page.waitForLoadState('networkidle');

    // Recurring tab is the default; explicitly click it for safety.
    await page.getByRole('button', { name: /recurring/i }).first().click();
    await page.waitForLoadState('networkidle');

    const TEMPLATE_NAME = 'QA Monthly Internet';
    const exists = await page.getByText(TEMPLATE_NAME, { exact: false }).first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (!exists) {
      // Click "New template" → form mounts inline.
      const newTplBtn = page.getByRole('button', { name: /new template/i }).first();
      await expect(newTplBtn).toBeVisible({ timeout: 10_000 });
      await newTplBtn.click();

      // Scope to the actual <form> element rendered by TemplateForm —
      // it's the inline form just below the heading. Fill the name
      // input via its placeholder which is stable ("e.g. Office rent").
      const form = page.locator('form').filter({ has: page.getByPlaceholder(/office rent/i) }).first();
      await expect(form).toBeVisible({ timeout: 5_000 });
      await form.getByPlaceholder(/office rent/i).fill(TEMPLATE_NAME);
      await form.locator('input[type="number"]').first().fill('50');

      // Pick category — first select on the form.
      const catSelect = form.locator('select').first();
      const opts = await catSelect.locator('option').all();
      for (const opt of opts) {
        const txt = (await opt.textContent()) ?? '';
        if (/qa office supplies/i.test(txt)) {
          const v = await opt.getAttribute('value');
          if (v) await catSelect.selectOption(v);
          break;
        }
      }
      // Next due date — leave empty (optional).

      await form.getByRole('button', { name: /create template/i }).first().click();
      // Wait for the new template to appear in the list — that's the
      // canonical signal that create succeeded (toast can be stale from
      // an earlier test). Generous timeout because the form save + list
      // reload involves a round trip.
      try {
        await expect(page.getByText(TEMPLATE_NAME, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
        console.log('[recurring-template] created');
      } catch {
        recordFinding({ day: 'accountant', severity: 'Medium', feature: 'Recurring template create failed', issue: 'Template name not visible in list 15s after clicking Create template.', repro: 'Login as accountant → /accounting/expenses → Recurring → New template → fill → Create.' });
        return;
      }
    } else {
      console.log('[recurring-template] already exists');
    }

    // Scope the Record button to the Card containing our template's name.
    const templateCard = page.locator('div').filter({ hasText: TEMPLATE_NAME }).filter({ has: page.getByRole('button', { name: /^record$/i }) }).first();
    const recordBtn = templateCard.getByRole('button', { name: /^record$/i }).first();
    if (await recordBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await recordBtn.click();
      // RecordTemplateForm: Date, Amount (prefilled), Payment method, Paid
      // from select, Tax, Tax label, Notes. The "Paid from" select needs
      // QA Cash USD.
      const recordCard = page.locator('div').filter({ has: page.getByRole('heading', { name: /record.*qa monthly internet|record this/i }) }).last();
      const allSelects = recordCard.locator('select');
      const sCount = await allSelects.count();
      for (let i = 0; i < sCount; i++) {
        const opts = await allSelects.nth(i).locator('option').all();
        for (const opt of opts) {
          const txt = (await opt.textContent()) ?? '';
          if (/qa cash usd/i.test(txt)) {
            const v = await opt.getAttribute('value');
            if (v) await allSelects.nth(i).selectOption(v);
            break;
          }
        }
      }
      await recordCard.getByRole('button', { name: /record expense/i }).first().click();
      const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
      await expect(toast).toBeVisible({ timeout: 10_000 });
      console.log('[recurring-template] one instance recorded');
    } else {
      console.log('[recurring-template] Record button not visible — likely already recorded this cycle');
    }
  });

  test('6.19 close a past period (Jan 1–31, 2020) then reopen it', async () => {
    await page.goto(config.webBase + '/accounting/periods');
    await page.waitForLoadState('networkidle');

    const PERIOD_NOTES = 'QA test close-reopen';
    // Idempotency check — look for a row covering Jan 2020.
    const existingRow = page.locator('tr', { hasText: /2020-01-01/i }).first();
    const exists = await existingRow.isVisible({ timeout: 2_000 }).catch(() => false);
    let needToClose = !exists;

    if (exists) {
      const isClosed = await existingRow.locator('text=/closed/i').first().isVisible({ timeout: 1_000 }).catch(() => false);
      if (isClosed) {
        console.log('[period] Jan 2020 already closed — will reopen');
      } else {
        // Already open after a previous reopen — done.
        console.log('[period] Jan 2020 row exists and is open — flow already exercised');
        return;
      }
    } else {
      // Click "Close period" header button → modal.
      await page.getByRole('button', { name: /close.*period/i }).first().click();
      const modal = page.locator('div.fixed.inset-0.z-50').last();
      await expect(modal).toBeVisible({ timeout: 5_000 });

      // Modal inputs: periodStart date, periodEnd date, notes textarea.
      const dateInputs = modal.locator('input[type="date"]');
      await dateInputs.nth(0).fill('2020-01-01');
      await dateInputs.nth(1).fill('2020-01-31');
      await modal.locator('textarea').first().fill(PERIOD_NOTES);

      // The Close button inside the modal also reads "Close period". Use
      // .last() to target the modal one (the header button is also matched).
      await modal.getByRole('button', { name: /close.*period/i }).last().click();
      const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
      await expect(toast).toBeVisible({ timeout: 10_000 });
      console.log('[period] Jan 2020 closed');
      await expect(modal).toBeHidden({ timeout: 5_000 });
    }

    // Re-locate the row (may have just been added).
    const row = page.locator('tr', { hasText: /2020-01-01/i }).first();
    await expect(row).toBeVisible({ timeout: 5_000 });

    // Click Reopen.
    await row.getByRole('button', { name: /^reopen$/i }).first().click();
    const reopenModal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(reopenModal).toBeVisible({ timeout: 5_000 });
    await reopenModal.locator('input').first().fill('QA test reopen');
    await reopenModal.getByRole('button', { name: /^reopen$/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    console.log('[period] Jan 2020 reopened');
  });

  test('6.20 refund $50 of Niga\'s $100 payment + verify balance', async () => {
    // Navigate to Niga's tuition detail.
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');
    const nigaRow = page.getByRole('button').filter({ hasText: /niga/i }).first();
    await expect(nigaRow).toBeVisible({ timeout: 10_000 });
    await nigaRow.click();
    await expect(page).toHaveURL(/\/accounting\/student\//, { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Wait for the payment row to actually render. The page shows a
    // "$100.00" amount inside the payments list. Without this, we may
    // race the API resolve.
    await expect(page.locator('text=/payments/i').first()).toBeVisible({ timeout: 10_000 });

    // Idempotency check — look for the Refund BADGE specifically (only
    // appears on refund rows), not anywhere on the page. The badge is
    // a span with bg-rose-100/text-rose-700 and text "Refund".
    const refundBadge = await page.locator('span', { hasText: /^refund$/i }).first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (refundBadge) {
      console.log('[refund] already applied (refund badge visible)');
      return;
    }

    // Click the Refund button (Undo2 icon, title="Refund").
    const refundBtn = page.locator('button[title="Refund"]').first();
    if (!(await refundBtn.isVisible({ timeout: 5_000 }).catch(() => false))) {
      recordFinding({
        day: 'accountant',
        severity: 'Medium',
        feature: 'Refund button missing on payment row',
        issue: 'Niga has a recorded $100 payment; the per-payment Refund button (Undo2 icon, title="Refund") is not visible.',
        repro: 'Login as accountant → /accounting → Niga → look at payments list.',
      });
      return;
    }
    await refundBtn.click();

    // Refund modal: amount input (prefilled to full payment), date, method,
    // account select, notes. Set amount=50.
    const modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    const amountInput = modal.locator('input[type="number"]').first();
    await amountInput.fill('50');

    // Pick payment account = QA Cash USD.
    const selects = modal.locator('select');
    const sCount = await selects.count();
    for (let i = 0; i < sCount; i++) {
      const opts = await selects.nth(i).locator('option').all();
      for (const opt of opts) {
        const txt = (await opt.textContent()) ?? '';
        if (/qa cash usd/i.test(txt)) {
          const v = await opt.getAttribute('value');
          if (v) await selects.nth(i).selectOption(v);
          break;
        }
      }
    }

    // Click "Refund" button inside the modal.
    await modal.getByRole('button', { name: /^refund$/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail')) {
      recordFinding({ day: 'accountant', severity: 'High', feature: 'Refund failed', issue: `Toast: "${text}"`, repro: 'Login as accountant → /accounting → Niga → click Refund on payment → set $50 → Refund.' });
    } else {
      console.log('[refund] $50 refunded');
    }
  });

  test('6.21 enable sibling discount + add a 10% tier for 2+ siblings', async () => {
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^settings$/i }).first().click();
    await page.waitForLoadState('networkidle');

    // Find the sibling discount enable checkbox. The label text is
    // accounting.settings.sibling_enable.
    const siblingLabel = page.locator('label', { hasText: /sibling/i }).first();
    const siblingCheckbox = siblingLabel.locator('input[type="checkbox"]');
    if (!(await siblingCheckbox.isChecked().catch(() => true))) {
      await siblingCheckbox.click();
      console.log('[sibling-discount] enabled');
    }

    // After enable, tier inputs appear. Add a tier via "Add tier" button.
    // If a tier already exists (idempotency), skip.
    const tierRowCount = await page.locator('input[type="number"]').count();
    // (At least 2 number inputs per tier — minSiblings + value.)
    // The cleanest signal: existence of an "Add tier" button is unconditional.
    const addTierBtn = page.locator('button', { hasText: /add tier/i }).first();
    if (await addTierBtn.isVisible({ timeout: 2_000 }).catch(() => false) && tierRowCount === 0) {
      await addTierBtn.click();
      console.log('[sibling-discount] tier row added');
    }

    // Save settings.
    await page.getByRole('button', { name: /save settings/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail')) {
      recordFinding({ day: 'accountant', severity: 'Medium', feature: 'Sibling discount save failed', issue: `Toast: "${text}"`, repro: 'Login as accountant → /accounting → Settings → toggle sibling discount → Save Settings.' });
    } else {
      console.log('[sibling-discount] settings saved');
    }
  });

  test('6.22 broadcast a tuition reminder via the Settings card', async () => {
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: /^settings$/i }).first().click();

    // TuitionSettingsTab returns <LoadingSpinner /> until feesApi.getConfig()
    // resolves. Wait for the "Save settings" button (rendered by the
    // sibling-discount card which only mounts after cfg loads) before
    // attempting to find the reminder card.
    await expect(page.getByRole('button', { name: /save settings/i }).first()).toBeVisible({ timeout: 15_000 });

    // Now the reminder card is mounted. Scroll to it and find the Send
    // reminder button.
    const sendBtn = page.getByRole('button', { name: /send reminder/i }).first();
    if (!(await sendBtn.isVisible({ timeout: 10_000 }).catch(() => false))) {
      console.log('[reminder] Send reminder button not found');
      return;
    }
    await sendBtn.click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 15_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    console.log(`[reminder] broadcast result: ${text}`);
    // Don't record finding here — broadcast may legitimately say "0 sent"
    // when no families match the status filter; that's not a bug.
  });

  test('6.23 P&L report shows income from payment and expense from purchases', async () => {
    await page.goto(config.webBase + '/accounting/reports/profit-loss');
    await page.waitForLoadState('networkidle');

    // The report auto-runs on mount with date range firstOfMonth → today.
    // Wait for the income/expense headings to render before asserting.
    // Look for any USD-formatted amount inside the report card — fmtMoney
    // renders amounts like "$100.00" or "USD 100.00" depending on locale.
    const reportArea = page.locator('main, [role="main"]').first();
    await expect(reportArea).toBeVisible({ timeout: 10_000 });

    // Wait briefly for the report payload to load.
    await page.waitForTimeout(2_000);

    // Scope text searches to the report content. After 6.12 + 6.20 net
    // income is $50 ($100 paid − $50 refunded). Expenses ≥ $25 from 6.15.
    // We assert: SOME income > 0 visible AND SOME expense > 0 visible.
    // Loose match — the report's fmtMoney() may render "$50.00" or "USD 50".
    const incomeLikely = await reportArea.locator('text=/income|revenue/i').first().isVisible({ timeout: 5_000 }).catch(() => false);
    const hasFifty = await reportArea.locator('text=/\\$?\\s*50(\\.\\d+)?\\b/').first().isVisible({ timeout: 3_000 }).catch(() => false);
    const hasHundred = await reportArea.locator('text=/\\$?\\s*100(\\.\\d+)?\\b/').first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (incomeLikely && !hasFifty && !hasHundred) {
      recordFinding({
        day: 'accountant',
        severity: 'Medium',
        feature: 'P&L income line missing',
        issue: 'Day-5 recorded a $100 tuition payment (refunded $50 → net $50). P&L for this month shows no $50 nor $100 amount.',
        repro: 'Login as accountant → /accounting/reports/profit-loss after 6.12 + 6.20 ran.',
      });
    }
    const hasTwentyFive = await reportArea.locator('text=/\\$?\\s*25(\\.\\d+)?\\b/').first().isVisible({ timeout: 3_000 }).catch(() => false);
    if (!hasTwentyFive) {
      recordFinding({
        day: 'accountant',
        severity: 'Medium',
        feature: 'P&L missing $25 expense',
        issue: 'Day-5 recorded a $25 expense; P&L report for this month does not show a $25 expense line.',
        repro: 'Login as accountant → /accounting/reports/profit-loss after 6.15 ran.',
      });
    }
  });

  test('6.24 AR aging shows Niga after refund creates a balance', async () => {
    await page.goto(config.webBase + '/accounting/reports/ar-aging');
    await page.waitForLoadState('networkidle');

    // After 6.20 refunded $50, Niga owes $50. She should appear in AR aging.
    const nigaInReport = await page.getByText(/niga/i).first().isVisible({ timeout: 10_000 }).catch(() => false);
    if (!nigaInReport) {
      // It's possible the refund was skipped (idempotent) and Niga is paid
      // in full — only flag if she shows in /accounting students rollup
      // with a non-zero balance.
      console.log('[ar-aging] Niga not in report (either paid in full or report not loaded)');
    } else {
      console.log('[ar-aging] Niga visible in AR aging report');
    }
  });

  test('6.25 download receipt PDF for Niga\'s payment', async () => {
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');
    const nigaRow = page.getByRole('button').filter({ hasText: /niga/i }).first();
    await expect(nigaRow).toBeVisible({ timeout: 10_000 });
    await nigaRow.click();
    await expect(page).toHaveURL(/\/accounting\/student\//, { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Receipt buttons (FileDown icon, title="Download receipt") sit on each
    // payment row. Click the first one and capture the download event.
    const receiptBtn = page.locator('button[title="Download receipt"]').first();
    await expect(receiptBtn).toBeVisible({ timeout: 10_000 });

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      receiptBtn.click(),
    ]);
    const filename = download.suggestedFilename();
    console.log(`[receipt] downloaded ${filename}`);
    // Verify the downloaded file isn't empty.
    const path = await download.path();
    if (!path) {
      recordFinding({
        day: 'accountant',
        severity: 'High',
        feature: 'Receipt download — no file path',
        issue: 'Download event fired but path() returned null — file did not land on disk.',
        repro: 'Login as accountant → /accounting → Niga → click Download receipt on a payment row.',
      });
      return;
    }
    const fs = await import('fs');
    const stats = fs.statSync(path);
    if (stats.size < 100) {
      recordFinding({
        day: 'accountant',
        severity: 'High',
        feature: 'Receipt PDF empty',
        issue: `Downloaded receipt is ${stats.size} bytes — likely an empty/error PDF rather than a valid receipt.`,
        repro: 'Login as accountant → /accounting → Niga → Download receipt; check file size.',
      });
    } else {
      console.log(`[receipt] PDF size: ${stats.size} bytes (looks healthy)`);
    }
  });

  test('6.26 apply -$10 adjustment (scholarship) to Niga\'s plan (idempotent)', async () => {
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');
    const nigaRow = page.getByRole('button').filter({ hasText: /niga/i }).first();
    await nigaRow.click();
    await expect(page).toHaveURL(/\/accounting\/student\//, { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Wait for the page payload to settle. Side panel renders only after
    // data + activePlan are populated. Look for the "Record payment" button
    // (canWrite + activePlan signal) before going for the Adjustment heading.
    await expect(page.getByRole('button', { name: /record payment/i }).first()).toBeVisible({ timeout: 15_000 });

    // The Adjustment card heading is `Adjustment · Tuition` (or similar).
    const adjHeading = page.locator('h3', { hasText: /adjustment/i }).first();
    if (!(await adjHeading.isVisible({ timeout: 10_000 }).catch(() => false))) {
      console.log('[adjustment] Adjustment card not visible');
      return;
    }

    // The h3 sits inside a card that renders the current adjustment value
    // (large text). The Pencil button is in the same row as the heading.
    // Climb to a parent that contains both the heading and the big-text value.
    const adjCard = adjHeading.locator('xpath=ancestor::div[contains(@class, "rounded") or contains(@class, "card")][1]');

    // Idempotency — read the large-text value; non-zero means already applied.
    const currentValue = (await adjCard.locator('div.text-2xl').first().textContent({ timeout: 3_000 }).catch(() => '0')) ?? '';
    if (!/^[\$\s]*[-]?0(\.00)?$/.test(currentValue.trim())) {
      console.log(`[adjustment] already applied (currently ${currentValue.trim()})`);
      return;
    }

    // Open adjustment modal — click the Pencil button (a small icon-only
    // <button> in the heading row).
    await adjCard.locator('button').first().click();
    const modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });
    // Modal has one number input (adjustment value) + one textarea (reason).
    await modal.locator('input[type="number"]').first().fill('-10');
    await modal.locator('textarea').first().fill('QA scholarship');
    await modal.getByRole('button', { name: /^save$/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail')) {
      recordFinding({ day: 'accountant', severity: 'High', feature: 'Adjustment save failed', issue: `Toast: "${text}"`, repro: 'Login as accountant → Niga → Adjustment → Pencil → set -10 → Save.' });
    } else {
      console.log('[adjustment] -10 saved');
    }
  });

  test('6.27 void the refund row + verify it disappears', async () => {
    await page.goto(config.webBase + '/accounting');
    await page.waitForLoadState('networkidle');
    const nigaRow = page.getByRole('button').filter({ hasText: /niga/i }).first();
    await nigaRow.click();
    await expect(page).toHaveURL(/\/accounting\/student\//, { timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Look for a refund row (has the Refund badge). If none, refund was
    // already voided / never made → skip.
    const refundBadge = page.locator('span', { hasText: /^refund$/i }).first();
    if (!(await refundBadge.isVisible({ timeout: 3_000 }).catch(() => false))) {
      console.log('[void] no refund row visible — nothing to void');
      return;
    }

    // The Void Trash2 button is on the same row. Find the row's container
    // and the Void button within. Strategy: walk all Void buttons; the
    // first one in DOM order on a refund row is what we want.
    const voidButtons = page.locator('button[title="Void"]');
    const voidCount = await voidButtons.count();
    if (voidCount === 0) {
      recordFinding({
        day: 'accountant',
        severity: 'Medium',
        feature: 'Void button missing on payment row',
        issue: 'A refund row is visible but no button[title="Void"] is present.',
        repro: 'Login as accountant → Niga → look at refund payment row.',
      });
      return;
    }

    // The delete handler triggers a window.confirm() — set up the dialog
    // handler BEFORE the click.
    page.once('dialog', d => d.accept().catch(() => {}));

    // Click the LAST void button — refund rows are typically rendered
    // below originals, so the last Void button corresponds to the refund.
    await voidButtons.last().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail')) {
      recordFinding({ day: 'accountant', severity: 'High', feature: 'Void payment failed', issue: `Toast: "${text}"`, repro: 'Login as accountant → Niga → click Void on a payment row → accept confirm.' });
    } else {
      console.log('[void] payment voided');
    }
  });

  test('6.28 recurring template — capture form-submit toast + console for diagnostics', async () => {
    const consoleErrors: string[] = [];
    const tempHandler = (msg: any) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    };
    page.on('console', tempHandler);

    try {
      await page.goto(config.webBase + '/accounting/expenses');
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: /recurring/i }).first().click();
      await page.waitForLoadState('networkidle');

      const TEMPLATE_NAME = 'QA diag template ' + Math.floor(Date.parse('2026-06-11') / 1000); // stable seed
      const exists = await page.getByText(TEMPLATE_NAME, { exact: false }).first().isVisible({ timeout: 2_000 }).catch(() => false);
      if (exists) {
        console.log('[diag-template] already exists from earlier run with same date — skipping');
        return;
      }

      await page.getByRole('button', { name: /new template/i }).first().click();
      const form = page.locator('form').filter({ has: page.getByPlaceholder(/office rent/i) }).first();
      await expect(form).toBeVisible({ timeout: 5_000 });
      await form.getByPlaceholder(/office rent/i).fill(TEMPLATE_NAME);
      await form.locator('input[type="number"]').first().fill('25');

      // Pick category.
      const catSelect = form.locator('select').first();
      const opts = await catSelect.locator('option').all();
      for (const opt of opts) {
        const txt = (await opt.textContent()) ?? '';
        if (/qa office supplies/i.test(txt)) {
          const v = await opt.getAttribute('value');
          if (v) await catSelect.selectOption(v);
          break;
        }
      }

      // Click Create template AND wait for the next toast (success or error).
      // Use a slightly older toast snapshot to ignore stale toasts.
      const toastCountBefore = await page.locator('.Toastify__toast').count();
      await form.getByRole('button', { name: /create template/i }).first().click();

      // Wait for either a new toast to appear OR 8 seconds.
      let toastText = '';
      let toastClass = '';
      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(500);
        const cnt = await page.locator('.Toastify__toast').count();
        if (cnt > toastCountBefore) {
          const newToast = page.locator('.Toastify__toast').last();
          toastText = ((await newToast.textContent()) ?? '').trim();
          const cls = (await newToast.getAttribute('class')) ?? '';
          toastClass = cls.includes('success') ? 'success' : cls.includes('error') ? 'error' : 'unknown';
          break;
        }
      }

      const nameNowVisible = await page.getByText(TEMPLATE_NAME, { exact: false }).first().isVisible({ timeout: 3_000 }).catch(() => false);
      console.log(`[diag-template] toast=${toastClass} text="${toastText}" nameInList=${nameNowVisible} consoleErrors=${consoleErrors.length}`);
      consoleErrors.forEach(e => console.log(`  [console.error] ${e}`));

      if (!nameNowVisible) {
        recordFinding({
          day: 'accountant',
          severity: 'Medium',
          feature: 'Recurring template — diagnostic capture',
          issue: `After click on Create template: toast=${toastClass}, message="${toastText}", console errors=${consoleErrors.length} [${consoleErrors.join(' | ')}], name not in list.`,
          repro: 'See test 6.28 log for diagnostic capture.',
        });
      }
    } finally {
      page.off('console', tempHandler);
    }
  });

  test('6.29 cash flow forecast — verify horizon select, Run button, and a non-empty table', async () => {
    await page.goto(config.webBase + '/accounting/reports/cash-flow');
    await page.waitForLoadState('networkidle');

    // The page has a horizon Select and a Run button + a table per currency.
    const horizonSelect = page.locator('select').first();
    await expect(horizonSelect).toBeVisible({ timeout: 10_000 });

    // Change horizon to 4 weeks to force a re-fetch with a smaller window.
    const opts = await horizonSelect.locator('option').all();
    let fourWeekValue: string | null = null;
    for (const opt of opts) {
      const txt = (await opt.textContent()) ?? '';
      if (/\b4\b/.test(txt) && /week/i.test(txt)) {
        fourWeekValue = await opt.getAttribute('value');
        break;
      }
    }
    if (fourWeekValue) await horizonSelect.selectOption(fourWeekValue);

    // Click Run.
    await page.getByRole('button', { name: /^run$/i }).first().click();
    await page.waitForLoadState('networkidle');

    // Verify some content rendered — either a table (any <th>) or any
    // status text. The page renders a Card-per-currency with a table.
    // After Run, await the loading spinner to disappear and content to settle.
    await page.waitForTimeout(2_000);
    const hasAnyTh = (await page.locator('th').count()) > 0;
    const hasUsdCard = await page.locator('h3', { hasText: /USD|IQD|EUR|GBP/i }).first().isVisible({ timeout: 2_000 }).catch(() => false);
    const hasEmpty = await page.locator('text=/no.*data|nothing.*forecast|empty/i').first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (!hasAnyTh && !hasUsdCard && !hasEmpty) {
      recordFinding({
        day: 'accountant',
        severity: 'Medium',
        feature: 'Cash flow forecast — neither table nor empty state visible',
        issue: 'Clicked Run on cash-flow forecast with 4-week horizon; no <th> table headers, no currency cards, no empty-state text.',
        repro: 'Login as accountant → /accounting/reports/cash-flow → pick 4 weeks → Run.',
      });
    } else {
      console.log(`[cash-flow] th=${hasAnyTh}, currency-card=${hasUsdCard}, empty=${hasEmpty}`);
    }
  });

  test('6.30 tax report — date range form + content verification', async () => {
    await page.goto(config.webBase + '/accounting/reports/tax');
    await page.waitForLoadState('networkidle');

    // Verify date inputs + Run button.
    const startInput = page.locator('input[type="date"]').first();
    const endInput = page.locator('input[type="date"]').nth(1);
    await expect(startInput).toBeVisible({ timeout: 10_000 });
    await expect(endInput).toBeVisible({ timeout: 5_000 });

    // Set range to this year — defaults already do this, but force-set
    // for determinism. Today is 2026-06-11.
    await startInput.fill('2026-01-01');
    await endInput.fill('2026-06-11');
    await page.getByRole('button', { name: /^run$/i }).first().click();
    await page.waitForLoadState('networkidle');

    // Tax was $0 on our payment + $0 on our expense — so the report
    // likely shows the empty state. Either an empty state or a table
    // is acceptable.
    await page.waitForTimeout(2_000);
    const tableCount = await page.locator('table').count();
    const thCount = await page.locator('th').count();
    const hasEmptyText = await page.locator('text=/no.*tax|empty|nothing|no records|no data/i').first().isVisible({ timeout: 2_000 }).catch(() => false);
    const hasTableOrEmpty = tableCount > 0 || thCount > 0 || hasEmptyText;
    if (!hasTableOrEmpty) {
      recordFinding({
        day: 'accountant',
        severity: 'Low',
        feature: 'Tax report — neither table nor empty state visible',
        issue: 'After running tax report for 2026 YTD, neither a table nor an empty-state message rendered.',
        repro: 'Login as accountant → /accounting/reports/tax → set 2026-01-01 to today → Run.',
      });
    } else {
      console.log('[tax] table or empty state rendered');
    }
  });

  test('6.31 record salary payment $500 for QA Teacher One (idempotent)', async () => {
    await page.goto(config.webBase + '/accounting/staff');
    await page.waitForLoadState('networkidle');

    // 6.13 placed QA Teacher One on payroll. If not visible on the
    // Active tab, the prerequisite failed — skip rather than re-add.
    const row = page.locator('div.bg-white.rounded-2xl.border').filter({ hasText: 'QA Teacher One' }).first();
    if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) {
      console.log('[staff-payment] QA Teacher One not on Active payroll — skip');
      return;
    }

    // Idempotency: the row prints "Last paid: $… on YYYY-MM-DD" once a
    // salary payment exists. If the marker is there we've already paid.
    const alreadyPaid = await row.getByText(/last paid/i).first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (alreadyPaid) {
      console.log('[staff-payment] QA Teacher One already has a recorded payment');
      return;
    }

    // Click the row-level "Record payment" button (Receipt icon).
    await row.getByRole('button', { name: /^record payment$/i }).first().click();
    const modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Defaults: amount=$500 (salary), currency=USD, paidOn=today,
    // paymentAccountId = first active account (QA Cash USD from 6.3).
    // Add a marker period label so the entry is traceable in history.
    // Input order inside the modal: amount, currency, date, period, …
    await modal.locator('input').nth(3).fill('QA day-6 6.31 salary payment');

    // Submit (the modal's own "Record payment" button, scoped to modal).
    await modal.getByRole('button', { name: /^record payment$/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail') || text.includes('error')) {
      recordFinding({
        day: 'accountant',
        severity: 'High',
        feature: 'Staff salary payment recording failed',
        issue: `Toast: "${text}"`,
        repro: 'Login as accountant → /accounting/staff → Record payment on QA Teacher One → submit.',
      });
    } else {
      console.log('[staff-payment] $500 salary payment recorded for QA Teacher One');
    }
    await expect(modal).toBeHidden({ timeout: 10_000 }).catch(() => {});
  });

  test('6.32 insurance payout for QA Teacher One (orchestrated, idempotent)', async () => {
    // To exercise the InsurancePayoutForm modal we need:
    //   1. insurance percentage > 0 on the staff record,
    //   2. at least one salary payment that withheld insurance (held > 0),
    //   3. the staff member archived (Pay insurance only renders there).
    // The orchestration below sets up each prereq idempotently, then
    // clicks Pay insurance and Mark insurance paid, then reactivates the
    // staff member so test 6.13's idempotency check on future runs still
    // finds them on the Active tab.

    await page.goto(config.webBase + '/accounting/staff');
    await page.waitForLoadState('networkidle');

    let row = page.locator('div.bg-white.rounded-2xl.border').filter({ hasText: 'QA Teacher One' }).first();
    if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) {
      console.log('[insurance-payout] QA Teacher One not on Active tab — skip');
      return;
    }

    // Idempotency: insurancePaidOut sticks across reactivate. The
    // "Insurance paid <date>" badge renders on both Active and Archive.
    const paidOut = await row.getByText(/insurance paid/i).first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (paidOut) {
      console.log('[insurance-payout] already paid out — skip');
      return;
    }

    // Step 1: ensure insurance percentage = 10. The badge text is
    // "Insurance NN%" (i18n: insurance_pct_badge).
    const hasPct = await row.getByText(/insurance \d+%/i).first().isVisible({ timeout: 1_500 }).catch(() => false);
    if (!hasPct) {
      await row.locator('button[title="Edit"]').first().click();
      const editModal = page.locator('div.fixed.inset-0.z-50').last();
      await expect(editModal).toBeVisible({ timeout: 5_000 });
      // Inputs in Edit modal: salary, currency, next payment date, insurance %.
      await editModal.locator('input').nth(3).fill('10');
      await editModal.getByRole('button', { name: /save changes|add to payroll/i }).first().click();
      await expect(page.locator('.Toastify__toast--success').first()).toBeVisible({ timeout: 10_000 });
      await expect(editModal).toBeHidden({ timeout: 10_000 });
      row = page.locator('div.bg-white.rounded-2xl.border').filter({ hasText: 'QA Teacher One' }).first();
    }

    // Step 2: ensure at least one payment has accrued insurance. The
    // "Held: $X" badge renders only while insuranceHeldTotal > 0 AND
    // insurancePaidOut is false. If absent, record a new payment — the
    // form auto-fills insuranceAmount from the percentage we just set.
    const hasHeld = await row.getByText(/held:/i).first().isVisible({ timeout: 1_500 }).catch(() => false);
    if (!hasHeld) {
      await row.getByRole('button', { name: /^record payment$/i }).first().click();
      const payModal = page.locator('div.fixed.inset-0.z-50').last();
      await expect(payModal).toBeVisible({ timeout: 5_000 });
      // Period label so the second payment is distinguishable in history.
      await payModal.locator('input').nth(3).fill('QA day-6 6.32 insurance accrual');
      await payModal.getByRole('button', { name: /^record payment$/i }).first().click();
      await expect(page.locator('.Toastify__toast--success').first()).toBeVisible({ timeout: 10_000 });
      await expect(payModal).toBeHidden({ timeout: 10_000 });
      row = page.locator('div.bg-white.rounded-2xl.border').filter({ hasText: 'QA Teacher One' }).first();
    }

    // Step 3: archive (deactivate). The icon button title is
    // "Archive (deactivate)". A window.confirm() blocks the click until
    // the dialog handler accepts.
    page.once('dialog', d => d.accept().catch(() => {}));
    await row.locator('button[title="Archive (deactivate)"]').first().click();
    await expect(page.locator('.Toastify__toast--success').first()).toBeVisible({ timeout: 10_000 });
    await page.waitForLoadState('networkidle');

    // Step 4: switch to the Archive sub-tab. Two buttons match
    // /archive/i (the tab and the row icon) — scope by the tab bar
    // container to disambiguate.
    const tabBar = page.locator('div.bg-gray-100.rounded-xl.p-1').first();
    await tabBar.locator('button').filter({ hasText: /^archive/i }).first().click();
    await page.waitForLoadState('networkidle');

    const archRow = page.locator('div.bg-white.rounded-2xl.border').filter({ hasText: 'QA Teacher One' }).first();
    await expect(archRow).toBeVisible({ timeout: 10_000 });

    // Step 5: click Pay insurance → modal opens with amount prefilled.
    const payInsBtn = archRow.getByRole('button', { name: /^pay insurance$/i }).first();
    if (!(await payInsBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      recordFinding({
        day: 'accountant',
        severity: 'Medium',
        feature: 'Pay insurance button missing on archived row',
        issue: 'QA Teacher One was archived with insuranceHeldTotal > 0 (a payment with insurance had been recorded), but the "Pay insurance" button does not render on the archive tab row.',
        repro: 'Login as accountant → /accounting/staff → Archive tab → QA Teacher One row.',
      });
      // Cleanup so 6.13 doesn't error "already linked" on the next run.
      const reactBtn = archRow.getByRole('button', { name: /^reactivate$/i }).first();
      if (await reactBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await reactBtn.click();
        await expect(page.locator('.Toastify__toast--success').first()).toBeVisible({ timeout: 10_000 });
      }
      return;
    }
    await payInsBtn.click();
    const insModal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(insModal).toBeVisible({ timeout: 5_000 });
    await insModal.getByRole('button', { name: /^mark insurance paid$/i }).first().click();
    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail') || text.includes('error')) {
      recordFinding({
        day: 'accountant',
        severity: 'High',
        feature: 'Insurance payout failed',
        issue: `Toast: "${text}"`,
        repro: 'Login as accountant → /accounting/staff → Archive → Pay insurance → Mark insurance paid.',
      });
    } else {
      console.log('[insurance-payout] insurance marked paid for QA Teacher One');
    }
    await expect(insModal).toBeHidden({ timeout: 10_000 }).catch(() => {});

    // Cleanup: reactivate. Test 6.13 keys off "QA Teacher One" being on
    // the Active tab — leaving them in archive would break the next run.
    await page.waitForLoadState('networkidle');
    const finalRow = page.locator('div.bg-white.rounded-2xl.border').filter({ hasText: 'QA Teacher One' }).first();
    const reactBtn = finalRow.getByRole('button', { name: /^reactivate$/i }).first();
    if (await reactBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await reactBtn.click();
      await expect(page.locator('.Toastify__toast--success').first()).toBeVisible({ timeout: 10_000 });
      console.log('[insurance-payout] QA Teacher One reactivated for next run');
    }
  });

  test('6.33 bulk set next-payment date for all active staff (idempotent)', async () => {
    await page.goto(config.webBase + '/accounting/staff');
    await page.waitForLoadState('networkidle');

    // Pick a date that's stable across runs and unlikely to collide with
    // a real "next payment" any human would set — a far-future Jan 1.
    const TARGET_DATE = '2027-01-01';

    const row = page.locator('div.bg-white.rounded-2xl.border').filter({ hasText: 'QA Teacher One' }).first();
    if (!(await row.isVisible({ timeout: 5_000 }).catch(() => false))) {
      console.log('[bulk-next-payment] QA Teacher One not on Active tab — skip');
      return;
    }

    // Idempotency: the row prints "Next payment: YYYY-MM-DD" inline.
    const alreadySet = await row.getByText(new RegExp(`next payment:\\s*${TARGET_DATE}`, 'i')).first().isVisible({ timeout: 2_000 }).catch(() => false);
    if (alreadySet) {
      console.log(`[bulk-next-payment] already set to ${TARGET_DATE}`);
      return;
    }

    // Open the header "Set next payment" button (CalendarClock icon).
    await page.getByRole('button', { name: /^set next payment$/i }).first().click();
    const modal = page.locator('div.fixed.inset-0.z-50').last();
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Modal has one date input and one checkbox per staff member.
    // Default: all active staff are selected. We keep that selection
    // (bulk means bulk) and just set the date.
    await modal.locator('input[type="date"]').first().fill(TARGET_DATE);

    // Submit button reads "Apply to {{count}}" when a date is filled.
    const submit = modal.getByRole('button', { name: /^apply to \d+/i }).first();
    await expect(submit).toBeVisible({ timeout: 5_000 });
    await submit.click();

    const toast = page.locator('.Toastify__toast--success, .Toastify__toast--error').first();
    await expect(toast).toBeVisible({ timeout: 10_000 });
    const text = (await toast.textContent())?.toLowerCase() ?? '';
    if (text.includes('fail') || text.includes('error')) {
      recordFinding({
        day: 'accountant',
        severity: 'High',
        feature: 'Bulk set next-payment date failed',
        issue: `Toast: "${text}"`,
        repro: `Login as accountant → /accounting/staff → Set next payment → ${TARGET_DATE} → Apply.`,
      });
    } else {
      console.log(`[bulk-next-payment] applied ${TARGET_DATE}: ${text}`);
    }
    await expect(modal).toBeHidden({ timeout: 10_000 }).catch(() => {});
  });
});
