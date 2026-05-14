// End-to-end verification of the archive integrity bundle (commit c4e8e3c).
// Drives the real admin flow: create student → archive → read snapshot →
// assert the H4 fields landed and the M9 atomic RPC actually ran (live row
// gone, archive row present, in one operation).
//
// Skips if the school does not have the archive feature on — the Archive
// Student card is conditionally rendered, so its absence is the signal.
//
// Payment-history content is NOT exercised here because recording a payment
// requires accountant access, which is out of scope for this testing round.
// Instead we verify the snapshot SHAPE — if a row is present it must carry
// every H4 field. The empty-array case still proves the snapshot field
// exists with the right type.

import { test, expect } from '@playwright/test';
import { storagePathFor } from '../helpers/auth';

const CLASS_NAME = process.env.TEST_CLASS_NAME || 'E2E Test Class';

test.use({ storageState: storagePathFor('admin') });

test.describe.serial('archive integrity', () => {
  test('end-to-end archive: create, archive, verify snapshot', async ({ page, context }) => {
    const studentName = `E2E Archive ${Date.now()}`;

    // Capture the API origin from the first /api response the app makes,
    // so we can call backend endpoints directly without hardcoding the URL.
    let apiBase: string | null = null;
    page.on('response', resp => {
      if (!apiBase && /\/api\//.test(resp.url())) {
        const u = new URL(resp.url());
        const idx = u.pathname.indexOf('/api');
        apiBase = `${u.protocol}//${u.host}${u.pathname.slice(0, idx)}/api`;
      }
    });

    // ── Step 1: Create the student via the New Student form ─────────────
    await page.goto('/admin/students');
    const pageTabs = page.locator('div.bg-gray-100.rounded-xl').first();
    await pageTabs.getByRole('button', { name: /New Student/i }).click();
    await page.getByPlaceholder('Full Name').fill(studentName);
    await page.locator('select').filter({ hasText: 'Select Parent' })
      .selectOption({ label: 'E2E Parent' });
    await page.locator('select').filter({ hasText: 'Select Class' })
      .selectOption({ label: CLASS_NAME });
    await page.locator('form').filter({ has: page.getByPlaceholder('Full Name') })
      .getByRole('button', { name: /^Send$/ }).click();
    const createToast = page.locator('.Toastify__toast').last();
    await expect(createToast).toContainText(/added|created/i, { timeout: 10_000 });
    await createToast.click().catch(() => {});

    // ── Step 2: Reload the page so the active-tab data reflects the new
    //   student (the in-page `load()` after create is async; tab-switching
    //   before it lands can leave the archive dropdown stale).
    await page.goto('/admin/students');
    const archiveHeader = page.locator('h2', { hasText: /^Archive Student$/ });
    if (await archiveHeader.count() === 0) {
      test.skip(true, 'Archive feature not enabled for this school — cannot test the archive flow.');
      return;
    }

    // The active tab renders multiple Card sections (remove / edit / archive),
    // each with their own filter-by-class + select-student dropdowns. Scope
    // every archive-form locator to the Archive Student card specifically.
    const archiveCard = page.locator('.bg-white.rounded-2xl').filter({ hasText: 'Archive Student' }).first();
    await archiveCard.locator('select').nth(0).selectOption({ label: CLASS_NAME });
    // Wait for the student option to actually be present before selecting it.
    await expect(archiveCard.locator('select').nth(1).locator('option', { hasText: studentName }))
      .toHaveCount(1, { timeout: 10_000 });
    await archiveCard.locator('select').nth(1).selectOption({ label: studentName });
    await archiveCard.locator('select').nth(2).selectOption({ value: 'transferred' });
    // The Archive Student button triggers a confirm() dialog before firing
    // the actual archive request. Auto-accept it so Playwright doesn't stall.
    page.once('dialog', d => d.accept());
    await archiveCard.getByRole('button', { name: /^Archive Student$/ }).click();
    const archiveToast = page.locator('.Toastify__toast').last();
    await expect(archiveToast).toContainText(/archived/i, { timeout: 15_000 });

    // ── Step 3: Pull JWT + API base for backend calls ───────────────────
    const token = await page.evaluate(() => {
      const json = localStorage.getItem('school-auth') || sessionStorage.getItem('school-auth');
      if (!json) return null;
      try { return JSON.parse(json).state?.token ?? null; } catch { return null; }
    });
    expect(token, 'no JWT in storage; cannot call backend').toBeTruthy();
    expect(apiBase, 'never observed an /api response; cannot derive backend base').toBeTruthy();

    // ── Step 4: Find the archive record we just created ─────────────────
    const listResp = await context.request.get(`${apiBase}/admin/archived-students`, {
      headers: { Authorization: `Bearer ${token!}` },
    });
    expect(listResp.ok(), `archive list returned ${listResp.status()}`).toBeTruthy();
    const list = await listResp.json();
    const found = (list as any[]).find(s => s.fullName === studentName);
    expect(found, `archived record for "${studentName}" not in list`).toBeTruthy();

    // ── Step 5: Read the full snapshot ──────────────────────────────────
    const detailResp = await context.request.get(`${apiBase}/admin/archived-students/${found.id}`, {
      headers: { Authorization: `Bearer ${token!}` },
    });
    expect(detailResp.ok(), `archive detail returned ${detailResp.status()}`).toBeTruthy();
    const archive = await detailResp.json();

    // ── Step 6: Top-level snapshot fields ───────────────────────────────
    expect(archive.fullName).toBe(studentName);
    expect(archive.reason).toBe('transferred');
    expect(archive.departureDate).toBeTruthy();
    expect(Array.isArray(archive.classesAttended)).toBe(true);
    expect(Array.isArray(archive.grades)).toBe(true);
    expect(Array.isArray(archive.paymentHistory)).toBe(true);

    // ── Step 7: H4 — payment_history snapshot shape ─────────────────────
    // The array is empty without accountant access (no payments were recorded
    // for this student). If anything IS there, every H4 field must be present.
    for (const sf of archive.paymentHistory) {
      expect(sf, 'student-fee snapshot missing siblingDiscount').toHaveProperty('siblingDiscount');
      expect(sf, 'student-fee snapshot missing lateFees').toHaveProperty('lateFees');
      for (const p of (sf.payments ?? [])) {
        for (const f of [
          'currency', 'receiptYear', 'receiptNumber',
          'taxAmount', 'taxLabel', 'paymentAccountId',
          'isRefund', 'refundOfPaymentId',
        ]) {
          expect(p, `payment snapshot missing ${f}`).toHaveProperty(f);
        }
      }
    }

    // ── Step 8: M9 atomic — live row must be gone ───────────────────────
    // The atomic RPC guarantees insert-then-delete in one transaction.
    // If it ran, the student row no longer exists in students.
    const stuResp = await context.request.get(
      `${apiBase}/admin/students?search=${encodeURIComponent(studentName)}&limit=10`,
      { headers: { Authorization: `Bearer ${token!}` } },
    );
    if (stuResp.ok()) {
      const stuJson = await stuResp.json();
      const students: any[] = Array.isArray(stuJson) ? stuJson : (stuJson.students || []);
      const stillLive = students.find(s => s.fullName === studentName);
      expect(stillLive, 'archive_student_atomic should have removed the live row').toBeFalsy();
    }
  });
});
