// Bulk student upload via the admin UI. The xlsx fixture lives at
// tests/e2e/student_records.xlsx — drop your own file in to retest.
//
// Idempotent: the backend's dedup uses (full_name, school_id), so re-running
// the spec moves every student into "skipped" but never duplicates them.

import { test, expect } from '@playwright/test';
import * as path from 'path';
import { storagePathFor } from '../helpers/auth';

test.use({ storageState: storagePathFor('admin') });

const FIXTURE_PATH = path.resolve(__dirname, '..', 'student_records.xlsx');

test.describe('bulk upload', () => {
  test('admin uploads student_records.xlsx and sees a result summary', async ({ page }) => {
    await page.goto('/admin/students');

    // The upload card lives on the New Student tab.
    const pageTabs = page.locator('div.bg-gray-100.rounded-xl').first();
    await pageTabs.getByRole('button', { name: /New Student/i }).click();

    // The file input is hidden but attached — set the file directly.
    await page.locator('input[type="file"]').setInputFiles(FIXTURE_PATH);
    await page.getByRole('button', { name: /^Upload$/ }).click();

    // Result summary: "X added · Y skipped (already exist) · Z total in file".
    // Allow a long timeout — bulk upload can run for several seconds with many rows.
    const summary = page.getByText(/added · .* skipped/i);
    await expect(summary).toBeVisible({ timeout: 30_000 });
    const text = (await summary.textContent()) ?? '';
    console.log(`[bulk-upload] ${text.trim()}`);

    // Extract numbers so we can assert "everything is accounted for".
    const m = text.match(/(\d+)\s+added.*?(\d+)\s+skipped.*?(\d+)\s+total/i);
    expect(m, `Could not parse result summary: "${text}"`).not.toBeNull();
    const [_, addedStr, skippedStr, totalStr] = m!;
    const added = Number(addedStr);
    const skipped = Number(skippedStr);
    const total = Number(totalStr);

    // Every row must end up either added or skipped — none silently lost.
    expect(added + skipped).toBe(total);
    expect(total).toBeGreaterThan(0);

    await page.screenshot({ path: 'screenshots/admin-bulk-upload.png', fullPage: true });
  });
});
