// Remaining accountant features that the "day in the office" journey
// didn't cover: refunds, voiding, period close + edit-block, FX rate add,
// and AR aging surfacing an unpaid student. Each describe is independent
// of the others — only the steps inside a single describe are serial.

import { test, expect, Page } from '@playwright/test';
import { storagePathFor } from '../helpers/auth';

test.use({ storageState: storagePathFor('accountant') });

const STUDENT_NAME = process.env.TEST_STUDENT_NAME || 'E2E Test Student';

const stamp = Date.now();

async function expectToast(page: Page, pattern: RegExp): Promise<string> {
  const toast = page.locator('.Toastify__toast').last();
  await expect(toast).toContainText(pattern, { timeout: 15_000 });
  const body = (await toast.textContent()) ?? '';
  await toast.click().catch(() => {});
  return body;
}

const modal = (page: Page) => page.locator('.fixed.inset-0.z-50');

// ─────────────────────────────────────────────────────────────────────
// REFUND
// ─────────────────────────────────────────────────────────────────────
test.describe.serial('refund', () => {
  const planName = `E2E Refund Plan ${stamp}`;
  const refundNote = `E2E refund @ ${stamp}`;

  test('record a fresh tuition payment for a fresh plan', async ({ page }) => {
    // Create a plan
    await page.goto('/accounting');
    await page.getByRole('button', { name: /^Plans$/ }).click();
    await page.getByRole('button', { name: /^New plan$/ }).click();
    await page.getByPlaceholder(/2026-2027 Tuition/i).fill(planName);
    const numbers = page.locator('input[type="number"]');
    await numbers.nth(0).fill('500');
    await numbers.nth(1).fill('500');
    await page.locator('input[type="date"]').first().fill('2026-09-01');
    await page.getByRole('button', { name: /^Create plan$/ }).click();
    await expectToast(page, /created/i);

    // Assign + record full payment
    const planRow = page.locator('div.rounded-2xl.border-gray-200').filter({ hasText: planName }).first();
    await planRow.scrollIntoViewIfNeeded();
    await planRow.getByRole('button', { name: /^Assign$/ }).click();
    await expectToast(page, /Assigned to/i);

    // Open student detail
    await page.goto('/accounting');
    const search = page.getByPlaceholder(/Search/i).first();
    if (await search.count() > 0) await search.fill(STUDENT_NAME);
    // After multiple plans the student now shows in the list with tuition data.
    const studentLink = page.getByText(STUDENT_NAME).first();
    await expect(studentLink).toBeVisible({ timeout: 10_000 });
    await studentLink.click();
    await expect(page).toHaveURL(/\/accounting\/student\//);

    // Switch to the refund plan tab.
    await page.getByRole('button', { name: new RegExp(`^${planName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click().catch(() => {});

    // Record a $500 payment.
    await page.getByRole('button', { name: /Record payment/i }).first().click();
    await page.getByPlaceholder('0.00').first().fill('500');
    const noteArea = page.locator('textarea').first();
    if (await noteArea.count() > 0) await noteArea.fill(`E2E payment for ${planName}`);
    await page.getByRole('button', { name: /^Record$/ }).click();
    await expectToast(page, /recorded|saved/i);
  });

  test('refund $200 of that payment', async ({ page }) => {
    // Stay on the same student page from the previous step — re-open it.
    await page.goto('/accounting');
    const search = page.getByPlaceholder(/Search/i).first();
    if (await search.count() > 0) await search.fill(STUDENT_NAME);
    await page.getByText(STUDENT_NAME).first().click();
    await page.getByRole('button', { name: new RegExp(`^${planName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click().catch(() => {});

    // The payments list has a refund button per row — usually a money-back
    // icon with title "Refund". The exact title varies; find the row that
    // contains "$500.00" (our most recent non-refund) and click any button
    // with title containing "Refund".
    const refundBtn = page.locator('button[title*="Refund" i]').first();
    await expect(refundBtn).toBeVisible({ timeout: 10_000 });
    await refundBtn.click();

    // Refund modal: first number input is the amount. Input common
    // component doesn't bind labels via htmlFor, so getByLabel doesn't work.
    await expect(modal(page)).toBeVisible();
    await modal(page).locator('input[type="number"]').first().fill('200');
    await modal(page).getByPlaceholder(/Why is this being refunded/i).fill(refundNote);
    await modal(page).getByRole('button', { name: /^Refund$/ }).click();
    await expectToast(page, /refund/i);

    // After refund, the original payment row should still be there + a new
    // negative refund row. Confirm we now see two payment-ish rows for $500
    // or one with a minus sign.
    const negativeRow = page.getByText(/−\$200|-\$200/);
    await expect(negativeRow.first()).toBeVisible({ timeout: 10_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// VOID a tuition payment
// ─────────────────────────────────────────────────────────────────────
test.describe.serial('void tuition payment', () => {
  const planName = `E2E VoidPay Plan ${stamp}`;

  test('create plan + record payment + void it via the Trash icon', async ({ page }) => {
    // Spin up a fresh plan so this doesn't entangle with the refund test.
    await page.goto('/accounting');
    await page.getByRole('button', { name: /^Plans$/ }).click();
    await page.getByRole('button', { name: /^New plan$/ }).click();
    await page.getByPlaceholder(/2026-2027 Tuition/i).fill(planName);
    const numbers = page.locator('input[type="number"]');
    await numbers.nth(0).fill('250');
    await numbers.nth(1).fill('250');
    await page.locator('input[type="date"]').first().fill('2026-09-01');
    await page.getByRole('button', { name: /^Create plan$/ }).click();
    await expectToast(page, /created/i);

    const planRow = page.locator('div.rounded-2xl.border-gray-200').filter({ hasText: planName }).first();
    await planRow.scrollIntoViewIfNeeded();
    await planRow.getByRole('button', { name: /^Assign$/ }).click();
    await expectToast(page, /Assigned to/i);

    // Open student detail + switch to this plan tab.
    await page.goto('/accounting');
    const search = page.getByPlaceholder(/Search/i).first();
    if (await search.count() > 0) await search.fill(STUDENT_NAME);
    await page.getByText(STUDENT_NAME).first().click();
    await page.getByRole('button', { name: new RegExp(`^${planName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click().catch(() => {});

    // Record a $250 payment.
    await page.getByRole('button', { name: /Record payment/i }).first().click();
    await page.getByPlaceholder('0.00').first().fill('250');
    const noteArea = page.locator('textarea').first();
    if (await noteArea.count() > 0) await noteArea.fill(`E2E void-target payment`);
    await page.getByRole('button', { name: /^Record$/ }).click();
    await expectToast(page, /recorded|saved/i);

    // Find the payment row and click the Void button (Trash icon with
    // title="Void"). The confirm() dialog needs auto-accept.
    const voidBtn = page.locator('button[title="Void"]').first();
    await expect(voidBtn).toBeVisible({ timeout: 10_000 });
    page.once('dialog', d => d.accept());
    await voidBtn.click();
    await expectToast(page, /voided/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// VOID one-time expense
// ─────────────────────────────────────────────────────────────────────
test.describe.serial('void expense', () => {
  const expenseName = `E2E Void Expense ${stamp}`;

  test('create + void a one-time expense', async ({ page }) => {
    await page.goto('/accounting/expenses');
    // One-time tab.
    await page.getByRole('button', { name: /One.?time/i }).first().click().catch(() => {});
    await page.getByRole('button', { name: /^New expense$/ }).click();
    await page.getByPlaceholder('e.g. Whiteboard markers').fill(expenseName);
    await page.locator('input[type="number"]').first().fill('99');
    await page.getByRole('button', { name: /Record expense|^Save$/ }).first().click();
    await expectToast(page, /recorded|saved/i);

    // Void. The expense row has a Void/Trash button.
    const row = page.locator('div.rounded-2xl, tr').filter({ hasText: expenseName }).first();
    await row.scrollIntoViewIfNeeded();
    // Auto-accept the prompt() that asks for the void reason.
    page.once('dialog', d => d.accept('E2E void reason'));
    await row.getByRole('button', { name: /Void|Delete/i }).first().click();
    await expectToast(page, /voided|deleted/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// VOID salary payment
// ─────────────────────────────────────────────────────────────────────
test.describe.serial('void salary payment', () => {
  const staffName = `E2E Void Janitor ${stamp}`;

  test('create staff, record payment, then void the payment via history', async ({ page }) => {
    await page.goto('/accounting/staff');
    await page.getByRole('button', { name: /Add staff/i }).first().click();
    await expect(modal(page)).toBeVisible();
    await modal(page).getByPlaceholder(/Sarah Ahmed/i).fill(staffName);
    await modal(page).getByPlaceholder(/Janitor, Bus Driver/i).fill('E2E Test Janitor');
    await modal(page).locator('input[type="number"]').first().fill('400');
    await modal(page).getByRole('button', { name: /^Add staff$/ }).click();
    await expectToast(page, /added|saved/i);

    // Record one salary payment.
    const row = page.locator('div.rounded-2xl, div.rounded-xl').filter({ hasText: staffName }).first();
    await row.scrollIntoViewIfNeeded();
    await row.getByRole('button', { name: /Pay|Record payment|Salary/i }).first().click();
    await expect(modal(page)).toBeVisible();
    await modal(page).getByRole('button', { name: /^Record(?: payment)?$/i }).first().click();
    await expectToast(page, /paid|recorded|saved/i);

    // Open this staff member's payment history.
    await row.scrollIntoViewIfNeeded();
    await row.getByRole('button', { name: /History|Payments/i }).first().click();
    await expect(modal(page)).toBeVisible();

    // Void the most recent payment. Each history row has a trash button
    // (no title attr — just a Trash2 icon). Find the first payment row
    // inside the modal and click its only button.
    page.once('dialog', d => d.accept('E2E test void'));
    const paymentRow = modal(page).locator('div.bg-gray-50.rounded-xl').first();
    await paymentRow.locator('button').first().click();
    await expectToast(page, /voided|deleted|removed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// PERIOD CLOSE + 423 ON EDIT
// ─────────────────────────────────────────────────────────────────────
test.describe.serial('period close blocks writes inside the range', () => {
  test('close a period covering a backdated day, attempt to record an expense in it, expect 423, reopen', async ({ page }) => {
    // accounting_periods has a UNIQUE(school_id, period_start, period_end)
    // constraint, so re-closing the same date range across reruns errors.
    // Spread runs over ~90 historical days using the test stamp.
    const offsetDays = 2 + (stamp % 90);
    const yesterday = new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);

    // 1. Close a 1-day period covering yesterday. The form is in a modal
    //    opened by a header "Close a period" button.
    await page.goto('/accounting/periods');
    await page.getByRole('button', { name: /^Close a period$/ }).click();
    await expect(modal(page)).toBeVisible();
    const dateInputs = modal(page).locator('input[type="date"]');
    await dateInputs.nth(0).fill(yesterday);
    await dateInputs.nth(1).fill(yesterday);
    await modal(page).getByPlaceholder(/Why is this period being closed/i).fill('E2E test period close');
    await modal(page).getByRole('button', { name: /^Close period$/ }).click();
    await expectToast(page, /closed/i);

    // 2. Attempt to record an expense dated yesterday — should 423.
    //    The one-time tab also has filter "From"/"To" date inputs at the top,
    //    so scope every form locator to the form itself (identified by its
    //    unique "What" placeholder) — otherwise `.first()` picks the filter.
    await page.goto('/accounting/expenses');
    await page.getByRole('button', { name: /One.?time/i }).first().click().catch(() => {});
    await page.getByRole('button', { name: /^New expense$/ }).click();
    const expenseForm = page.locator('form').filter({ has: page.getByPlaceholder('e.g. Whiteboard markers') });
    await expenseForm.getByPlaceholder('e.g. Whiteboard markers').fill(`E2E period-blocked ${stamp}`);
    await expenseForm.locator('input[type="number"]').first().fill('10');
    // Date input is INSIDE the form — backdate to yesterday (closed range).
    await expenseForm.locator('input[type="date"]').first().fill(yesterday);
    await expenseForm.getByRole('button', { name: /Record expense|^Save$/ }).click();
    // Period guard should fire with a 423 + a "closed period" message.
    await expectToast(page, /closed|locked|423|period/i);

    // 3. Reopen the period so the demo school isn't left with a closed range.
    await page.goto('/accounting/periods');
    // The closed period appears as a row with a Reopen button.
    const closedRow = page.locator('div, tr').filter({ hasText: yesterday }).filter({ has: page.getByRole('button', { name: /Reopen/i }) }).first();
    await closedRow.scrollIntoViewIfNeeded();
    await closedRow.getByRole('button', { name: /Reopen/i }).click();

    // Reopen modal: scope the submit click to the modal (both the row
    // trigger and the modal action are labelled "Reopen").
    await expect(modal(page)).toBeVisible();
    await modal(page).getByPlaceholder(/Required.*what needs fixing/i).fill('E2E reopen — test complete');
    await modal(page).getByRole('button', { name: /^Reopen$/ }).click();
    await expectToast(page, /reopen/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// FX RATE
// ─────────────────────────────────────────────────────────────────────
test('add an FX rate (USD -> IQD) and see it in the list', async ({ page }) => {
  await page.goto('/accounting/fx-rates');
  // From defaults to USD, To defaults to IQD. Just fill the rate.
  await page.getByPlaceholder(/e.g. 1310/i).fill('1310');
  await page.getByRole('button', { name: /^Save$/ }).first().click();
  await expectToast(page, /saved|added/i);

  // The new rate should appear in the table with our value.
  await expect(page.locator('table').getByText('1,310').first()).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────
// AR AGING WITH AN UNPAID STUDENT
// ─────────────────────────────────────────────────────────────────────
test.describe.serial('AR aging surfaces unpaid students', () => {
  const planName = `E2E Unpaid Plan ${stamp}`;

  test('create plan with a past due date, assign to E2E student, leave unpaid', async ({ page }) => {
    await page.goto('/accounting');
    await page.getByRole('button', { name: /^Plans$/ }).click();
    await page.getByRole('button', { name: /^New plan$/ }).click();
    await page.getByPlaceholder(/2026-2027 Tuition/i).fill(planName);
    const numbers = page.locator('input[type="number"]');
    await numbers.nth(0).fill('300');
    await numbers.nth(1).fill('300');
    // Backdate the due date so the student lands in an overdue aging bucket.
    const longAgo = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    await page.locator('input[type="date"]').first().fill(longAgo);
    await page.getByRole('button', { name: /^Create plan$/ }).click();
    await expectToast(page, /created/i);

    // Assign to all students; that hits the E2E student.
    const planRow = page.locator('div.rounded-2xl.border-gray-200').filter({ hasText: planName }).first();
    await planRow.scrollIntoViewIfNeeded();
    await planRow.getByRole('button', { name: /^Assign$/ }).click();
    await expectToast(page, /Assigned to/i);
  });

  test('AR aging page lists the E2E student with an overdue balance', async ({ page }) => {
    await page.goto('/accounting/reports/ar-aging');
    // Wait for the report data to render.
    await page.locator('.animate-spin').first().waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});

    // The student should now appear since they have an unpaid installment.
    const studentRow = page.getByText(STUDENT_NAME).first();
    await expect(studentRow).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'screenshots/extras-ar-aging.png', fullPage: true });
  });
});
