# Accountant portal — historical-data audit (2026-06-07)

Companion to the parent/student historical-data audit closed by PR 1 + PR 2 +
PR 3. This file is the persisted output of the accountant-portal audit and is
the working brief for the follow-up PRs.

## Storage map (what lives where)

| Table | Lifecycle | Append-only? |
|---|---|---|
| `fee_plans` + `fee_installments` + `fee_plan_classes` | Voidable (soft) | No |
| `student_fees` | Cascade-deleted with `students` | No |
| `fee_payments` + `fee_payment_allocations` | Voidable (soft); allocations cascade with parent | No |
| `student_fee_late_fees` | Voidable (soft); auto-applied by `apply_late_fees()` pg_cron | No |
| `staff_members` | Voidable (soft) + employee archive snapshot to `archived_employees` | No |
| `staff_salary_payments` | Voidable (soft); cascade-deleted with `staff_members` | No |
| `expenses` + `expense_categories` + `expense_recurring_templates` | `expenses` voidable; templates have `is_active` flag | No |
| `accounting_periods` | Close/reopen; `assertPeriodOpen` blocks writes in closed ranges | No (overwritten on re-close) |
| `payment_accounts` | Voidable (no `voided_at`; uses `is_active`) | No |
| `fx_rates` | Mutable | No |
| `chart_of_accounts` | System accounts protected; non-system soft-deactivatable | No |
| `journal_entries` + `journal_lines` | **Immutable, hash-chained, append-only via `prevent_archive_mutation` trigger** | ✅ Yes |
| `archived_students.payment_history` JSONB | Frozen at archive time, append-only | ✅ Yes |
| `archived_employees.payment_history` JSONB | Frozen at archive time, append-only | ✅ Yes |

The GL is the only first-class "book of record" — everything else is
operational source-document data that can be voided and eventually erased.

## Findings

### 🟥 AC-1 — 30-day void retention silently erases source documents

[`cleanup_voided_records()`](database/schema.sql) is a pg_cron job
(scheduled at `15 3 * * *` UTC) that **HARD DELETES** voided rows older
than 30 days:

```sql
DELETE FROM fee_payments         WHERE voided_at < NOW() - INTERVAL '30 days';
DELETE FROM fee_plans            WHERE voided_at < NOW() - INTERVAL '30 days';
DELETE FROM staff_salary_payments WHERE voided_at < NOW() - INTERVAL '30 days';
DELETE FROM staff_members        WHERE voided_at < NOW() - INTERVAL '30 days';
DELETE FROM expenses             WHERE voided_at < NOW() - INTERVAL '30 days';
```

When `fee_plans` gets cleaned up, the FK cascade nukes `fee_installments`,
`fee_plan_classes`, `student_fees`, `fee_payments`,
`fee_payment_allocations`, `student_fee_late_fees` — **for every student
on that plan, voided or not**. The void retention applies to the plan
only, but the cascade reaches every connected row.

The GL survives intact (immutable hash chain, FK-less `source_id`), but
the source-document trail is permanently gone. An auditor or parent who
comes back later cannot retrieve the original receipt PDF — only the GL
summary.

**Recommend:** extend the UI confirm dialog to explicitly warn before
voiding a `fee_plan` ("This will permanently delete N student fees and M
payments in 30 days"); OR change `cleanup_voided_records` to only
hard-delete rows whose dependents are also void / detached.

### 🟥 AC-2 — Receipt regeneration breaks for archived students

[`paymentReceiptPdf`](backend/src/controllers/fees.controller.ts) and
[`studentFeeSummaryPdf`](backend/src/controllers/fees.controller.ts)
read only from live `fee_payments` rows. When a student is archived
(`archiveStudent` deletes the live student row → cascade kills
`student_fees` + `fee_payments`), the receipt URL returns 404 forever —
even though `archived_students.payment_history` JSONB has every receipt
number, amount, payment account, currency, and tax field.

Parents who downloaded a receipt mid-year keep their local copy; anyone
needing a re-issued receipt is stuck. The accountant can only export the
whole archive via
[`archivePaymentPdf`](backend/src/controllers/fees.controller.ts) —
there's no per-receipt regeneration endpoint that reads from the
snapshot.

**Recommend:** have `paymentReceiptPdf` fall back to a lookup against
`archived_students.payment_history` (matched on
`receiptYear+receiptNumber` or original payment id) when the live row is
gone. Same pattern for `studentFeeSummaryPdf`.

### 🟥 AC-3 — AR aging silently writes off archived students' debts

[`getArAging`](backend/src/controllers/accountingReports.controller.ts)
joins `student_fees` → `students!inner`. Archived students
(transferred/withdrew, archive-on) have no live `students` row → no live
`student_fees` → invisible in AR.

This means a student with $500 outstanding who transferred mid-year
vanishes from AR aging the moment they're archived. The $500 was never
collected and was never posted as a writeoff in the GL — it just stops
being visible. The original tuition_billing AR posting stays in the GL
forever as an open balance.

Result: **GL Accounts Receivable balance > sum of AR-aging rows**.
Trial balance won't reconcile.

**Recommend:** either (a) post an AR-writeoff GL entry on archive when the
snapshot has an outstanding balance (and a counter-entry on
returnStudentFromLeave / restoreArchivedStudent), OR (b) leave the AR
posting "live" with a marker — but this needs an accounting policy
decision (write-off vs collections).

### 🟧 AC-4 — Late-fee + recurring-expense crons silently desync from GL on unseeded charts

Both
[`apply_late_fees()`](database/migrations/023_gl_phase2_cron_posting.sql)
and
[`auto_record_recurring_expenses()`](database/migrations/023_gl_phase2_cron_posting.sql)
materialise the operational row first, then post to the GL — but skip
the GL post if the chart of accounts isn't seeded ("Posting is SKIPPED
when the school has no seeded chart of accounts"). The operational row
sticks around forever unposted.

Net effect: late_fee row exists in `student_fee_late_fees` and
contributes to AR aging — but the GL has no matching Dr AR / Cr Late
Fee Income. Permanent desync. A school that activates the GL later
won't have the historical late fees back-posted.

**Recommend:** an "unposted source rows" reconciliation report endpoint
+ a manual back-post action. Or seed the chart on premium-enable.

### 🟧 AC-5 — `apply_late_fees` uses UTC `CURRENT_DATE`

In the cron function:
```sql
WHERE (fi.due_date + (fp.late_fee_grace_days || ' days')::INTERVAL)::DATE < CURRENT_DATE
```

`CURRENT_DATE` in pg_cron is the Postgres server's date (UTC). Schools
east of UTC see late fees apply a day late from their perspective.
Compare with `backend/src/utils/attendance.ts` which carefully respects
`schools.timezone`.

**Recommend:** replace `CURRENT_DATE` with
`(NOW() AT TIME ZONE COALESCE((SELECT timezone FROM schools WHERE id = sf.school_id), 'Asia/Baghdad'))::date`
inside the predicate.

### 🟧 AC-6 — Staff salary archive snapshot drops tax + payment_account + recorded_by

[`snapshotStaffArchive`](backend/src/controllers/staff.controller.ts)
builds `paymentHistory` JSONB with only `amount, currency, paid_on,
period_label, notes, insurance_amount, insurance_percentage`. The
student-fee equivalent
([`buildStudentArchiveSnapshot`](backend/src/controllers/admin.controller.ts))
**includes** `tax_amount, tax_label, payment_account_id, receipt_year,
receipt_number, is_refund, refund_of_payment_id`.

A tax-authority audit covering staff payroll after a staff member is
archived loses tax-withholding figures from the snapshot. Also loses
recorder + payment account, so you can't trace which till / which clerk
processed the payment.

**Recommend:** copy the same field set as the student-fee snapshot —
`tax_amount`, `tax_label`, `payment_account_id`, `recorded_by` — into
staff archive payment_history.

### 🟧 AC-7 — Voided salary payments hidden from teacher self-service forever

[`getMyStaffInfo`](backend/src/controllers/staff.controller.ts) (used
by `/teacher/salary` and `/supervisor/salary`) filters `voided_at IS
NULL`. If a salary payment is recorded then voided 5 minutes later, the
teacher sees neither the payment nor the void — only what the
accountant left "valid." Combined with AC-1, after 30 days the row is
gone, so the teacher has no audit trail of "this transaction happened
to me and was reversed."

Not strictly a data-retention bug but a transparency one. Worth
surfacing voided entries to the recipient with a clear "Voided on X —
reason: Y" indicator.

### 🟧 AC-8 — (Folds into AC-6) Staff tax history lost on archive

When `staff_members` is voided + 30-day cleaned up, `staff_salary_payments`
cascade away. The GL salary entries survive (FK-less `source_id`), but
the operational salary detail is in the `archived_employees.payment_history`
snapshot — which (per AC-6) lacks tax. So for archived staff, the
`tax_amount` charged on each salary slip is **only** in the now-deleted
operational row.

Resolved by AC-6's snapshot field expansion.

### 🟦 AC-9 — No year-end accounting close workflow

The student-side year-transition wizard advances
`schools.current_academic_year` and reassigns classes but does nothing
on the accounting side. No "close fiscal year" wizard, no automatic
creation of next-year fee_plans from current ones, no auto-deactivation
of last year's plans. The accountant runs every step manually.

Compare with the student side, which got HD-3 (close enrollment before
snapshot) and HD-4 (authoritative current year). The accountant has
neither.

Not a data-loss bug but a UX gap. Year-end could:

- Recommend closing the final accounting period for the prior year
- Suggest deactivating last year's fee_plans
- Offer to clone fee_plans into the new year

**For FEATURE.md** as a planned future feature, not a fix.

### 🟦 AC-10 — No archive backup for the GL

[`exportFullArchiveBackup`](backend/src/controllers/admin.controller.ts)
(admin) and the master-portal `archive-export.pdf` / `archive-export.xlsx`
([master/server/src/routes/schools.ts](master/server/src/routes/schools.ts))
export `archived_students` + `archived_employees`. The GL is not in the
backup. A school that gets deleted (`delete_school_cascade`) loses
every journal entry — and there's no provider-side copy.

For accounting compliance, the GL is the most important thing to
retain.

**Recommend:** add `journal_entries.json` + `journal_lines.json` to the
master backup payload, both at pre-purge and admin self-serve. Same
SHA-256 verify pattern as the student/employee archives.

**For FEATURE.md** as a planned future feature.

### 🟦 AC-11 — Reception's RO scope is narrow but correct

Reception can read: plans list, students fee list, families list,
per-student detail, archive list + detail + PDF/XLSX export, payment
accounts list, config.

Reception cannot: see voided rows lists, AR aging, P&L, cash flow, tax
report, GL, rollups, payment accounts CRUD, periods CRUD, FX rates CRUD.
By design.

No findings here — the scope matches the locked decision in CLAUDE.md
(`accountingRO = ['accountant', 'reception']`,
`accountingRW = ['accountant']`).

### 🟦 AC-12 — No accountant mobile surface

Confirmed: only `parent/fees` + receipt PDF + summary PDF endpoints are
reachable from mobile. The accountant module is web-only.

Teacher/supervisor get read-only `getMyStaffInfo` on web; mobile
[`SalaryScreen.tsx`](mobile/src/screens/shared/SalaryScreen.tsx) uses
it too — see AC-7 for the same teacher visibility gap on mobile.

By design — accountant is a desktop-first workflow. Related to AC-7
transparency only.

## Findings summary

| # | Severity | Issue |
|---|---|---|
| AC-1 | 🟥 High | 30-day void cleanup cascades through `fee_plans` → wipes student_fees + payments for non-voided plan members |
| AC-2 | 🟥 High | Receipt regen 404s for archived students; snapshot has the data but no fallback path |
| AC-3 | 🟥 High | AR aging silently drops archived students with outstanding balances; GL AR ≠ aging report |
| AC-4 | 🟧 Med | apply_late_fees + auto_record_recurring_expenses silently skip GL on unseeded chart |
| AC-5 | 🟧 Med | apply_late_fees uses UTC `CURRENT_DATE`, ignores `schools.timezone` |
| AC-6 | 🟧 Med | Staff archive snapshot drops tax + payment_account + recorded_by (inconsistent with student snapshot) |
| AC-7 | 🟧 Med | Voided salary payments invisible to teacher self-service — no transparency |
| AC-8 | 🟧 Med | (Folds into AC-6) — staff tax history lost on archive |
| AC-9 | 🟦 Info | No year-end accounting close workflow — UX gap; planned for FEATURE.md |
| AC-10 | 🟦 Info | GL not included in archive backup / master pre-purge backup; planned for FEATURE.md |
| AC-11 | 🟦 Info | Reception RO scope matches locked design; no findings |
| AC-12 | 🟦 Info | No mobile accountant surface (by design); related to AC-7 transparency |

## Recommended PR plan

### PR A (defensive, ships first) — closes AC-1 + AC-3 + AC-4 + AC-5

- **Migration 043:** rewrite `cleanup_voided_records` to skip rows with
  non-voided dependents (the cascade is the dangerous part). Add a daily
  reconciliation log entry so we can see what got skipped vs cleaned.
- **Migration 043:** fix `apply_late_fees` timezone using `schools.timezone`.
- **New endpoint** (`GET /accounting/reports/unposted-source-rows`):
  report of late fees + recurring expenses + payments that have no
  corresponding GL entry, so accountants can spot the desync (AC-4).
- **Migration 043 / posting layer:** post an AR-writeoff GL entry on
  student archive when the snapshot has an outstanding balance (Dr Bad
  Debt Expense or Cr AR depending on policy — needs decision). Counter
  entry on returnStudentFromLeave / restoreArchivedStudent.
- Backend audit on the writeoff path.

### PR B (the feature) — closes AC-2 + AC-6 + AC-7

- **AC-2:** Receipt regen fallback to `archived_students.payment_history`
  for student receipts; same for staff via
  `archived_employees.payment_history`. Match by `(receipt_year,
  receipt_number)` first, fall back to original payment id.
- **AC-6 + AC-8:** Staff snapshot extended to match student snapshot
  fields (`tax_amount`, `tax_label`, `payment_account_id`,
  `recorded_by`). Update `snapshotStaffArchive` write path + tighten
  the staff archive read view to surface the new fields.
- **AC-7:** `getMyStaffInfo` exposes voided payments with a clear
  "Voided on X" marker so the teacher has a complete history. UI
  on web (`SalaryPage.tsx`?) + mobile (`SalaryScreen.tsx`).
- i18n surface for the void marker in 6 locale files (en/ar/ku web + en/ar/ku mobile).

### FEATURE.md (planned, no code yet)

- **AC-9** — Year-end accounting close wizard for accountant (parallel
  to the student year-transition wizard). Includes recommended-close
  for the prior fiscal year, clone-fee-plans-into-new-year action,
  auto-deactivate option for old plans.
- **AC-10** — GL included in archive backup payload (both admin
  self-serve `exportFullArchiveBackup` and master pre-purge
  `buildAndStoreBackup`). Reuses the same SHA-256 verify cadence.

## Out-of-scope confirmations (not findings)

These were checked and are correct as-is:

- **GL append-only behavior** is correct. `journal_entries` +
  `journal_lines` are protected by
  [`prevent_archive_mutation`](database/schema.sql) trigger; reversals
  are NEW entries with `is_reversal=true` + `reverses_entry_id`. Hash
  chain is per-school via [`hash_journal_entry()`](database/schema.sql).
- **Refund chain** is correct. `is_refund=true` rows reference the
  original via `refund_of_payment_id`; original stays valid. Caps refunds
  at `original_amount − sum(prior_non_voided_refunds)`.
- **Receipt numbers** are sequential per-school per-calendar-year via
  `allocateReceiptNumber` + `UNIQUE INDEX idx_fee_payments_receipt`.
  Format `RCP-YYYY-NNNNN`.
- **Accounting period close** correctly blocks writes via
  [`assertPeriodOpen`](backend/src/utils/period.ts) in
  `recordPayment`, `deletePayment`, `unvoidPayment`, `refundPayment`,
  `voidExpense`, `unvoidExpense`, staff salary equivalents. Both old +
  new dates checked on edit.
- **Chart of accounts** system accounts (cash, AR, etc.) protected
  from deletion via `is_system` check in
  [`glaccounting.controller.ts`](backend/src/controllers/glaccounting.controller.ts).
- **Premium gate** (`tuition_fees`) consistently applied across
  `fees.controller`, `expenses.controller`, `staff.controller`,
  `accounting.controller`, `accountingReports.controller`,
  `ledger.controller`, `glaccounting.controller`. Turning the feature
  off blocks every endpoint with a clean 403 and does NOT touch the
  data — schools can downgrade safely. (Compare with `archive`, which
  destructively purges on feature-off.)

## Context for the follow-up session

After /compact, pick up by reading this file. PR plan is at the top of
that recommendation section. Demo-data state still applies — see
[[scholify-demo-data-only]] memory. Start with **PR A** unless the user
directs otherwise; it's the defensive set that stops the bleeding from
AC-1 + AC-3 + AC-4 + AC-5.
