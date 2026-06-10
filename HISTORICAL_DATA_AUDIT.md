# Historical data — full-system audit (2026-06-10)

Follow-up to [`ACCOUNTANT_AUDIT.md`](ACCOUNTANT_AUDIT.md) (AC-1..AC-12, closed by
PRs A + B + AC-10 + commit `8dc00f3`). This file expands outward to the
student/staff lifecycle, file storage, audit logging, UI presentation of
history, and DB-level destructive ops. Findings are prefixed **HD-** to keep
them distinct from the accountant slice.

Methodology: eight parallel `Explore`-agent passes (student lifecycle, staff
lifecycle, financial records, destructive DB ops, UI presentation, audit
logging, file storage, accountant residual), synthesized + deduplicated +
false-positives dropped.

## Findings summary

| # | Severity | Status | Area | Issue |
|---|---|---|---|---|
| HD-1 | 🟥 Critical | DONE (PR E) | Student archive | Attendance days now snapshotted per year into `enrollment_history[].attendanceDays`. Bus rides / ebook progress / access locks left out: operational state, not historical record |
| HD-2 | 🟥 Critical | DONE (PR C) | Tamper evidence | Canonical hash for `archived_students` omits `enrollment_history`, `transfer_id`; v1↔v2 back-compat on `reports` unclear |
| HD-3 | 🟥 Critical | DONE (PR C) | Staff archive | `snapshotStaffArchive` filters `voided_at IS NULL` — voided salary payments lost at archive time |
| HD-4 | 🟥 Critical | DONE (PR D) | Audit logging | Chart-of-accounts CRUD + manual journal + opening balances unaudited. (Period close/reopen, payment-account, FX-rate were already audited — agent claim partially wrong.) |
| HD-5 | 🟧 High | DONE (PR C) | File tenancy | `uploadPostFile` + `uploadEbook` write to `posts/...` and `ebooks/...` — no `school_id` prefix (other upload sites are scoped) |
| HD-6 | 🟧 High | TODO | Accountant exports | `buildLedger` and ledger PDF/XLSX omit archived-student/staff payments (extends AC-13) |
| HD-7 | 🟧 High | DONE (PR F) | Parent UI | Parent fee screens (web + mobile) now render refund badge + voided strike-through; `getParentFees` includes void/refund metadata; i18n in 6 locales |
| HD-8 | 🟧 High | TODO | Archive restore | `restoreArchivedStudent` doesn't recreate enrollment rows, doesn't restore class/driver |
| HD-9 | 🟧 High | DONE (PR C) | Backup integrity | `archive_backups` table has no `prevent_archive_mutation` trigger |
| HD-10 | 🟧 High | DONE (PR G) | Web archive UX | `ArchivedStudentsTab` detail now renders the frozen `payment_history` JSONB per plan, with refund / voided markers matching the live admin view |
| HD-11 | 🟧 High | DONE (PR H) | Storage orphans | New `chat_attachments` table (migration 047) + `chat.controller#uploadAttachment` writes a row per upload; sweep can now distinguish tracked from leftover |
| HD-12 | 🟨 Medium | INFO | Salary history | Mid-tenure salary mutations have no `salary_history` table — relies on `audit_logs` |
| HD-13 | 🟨 Medium | DONE (PR E) | Snapshot gaps | Verified: no `staff_attendance` / `employee_attendance` / `performance_review` tables exist; insurance-payout history is covered by `audit_logs`. PR C HD-3 already covered voided payments. Nothing left to snapshot |
| HD-14 | 🟨 Medium | DONE (PR G) | Late-fee UX | `AdminTuitionStudentDetailPage` now lists each applied late fee with date + amount + voided marker, fetched via the existing `listLateFees` endpoint |
| HD-15 | 🟨 Medium | DONE (PR H) | Storage orphans | Weekly sweep workflow (`storage-orphan-sweep.yml`) + `backend/scripts/storage-orphan-sweep.cjs` reports + optionally deletes orphans in `chat-files` and `employee-documents` (clean-ownership buckets); `homework-attachments` + `operator-mail` deferred to phase 2 |
| HD-16 | 🟨 Medium | DONE (PR I) | Master portal UX | New `ArchiveBrowserModal` in `e:\master\apps\master-web` + four routes in `apps/api/src/routes/schools.ts` give operators a read-only browser onto `archived_students` / `archived_employees`. Every list and detail view is recorded in `operator_audit_log` (action: `archive.list` / `archive.view`) |
| HD-17 | 🟨 Medium | DONE (PR G) | Year navigation | `ProfitLossPage` got "This month / This academic year / Previous academic year" preset chips using a Sept-boundary helper. GL/AR-aging not retrofitted (AR is point-in-time so doesn't benefit; GL ledger is a candidate for a future pass) |
| HD-18 | 🟨 Medium | DONE (PR F) | Refund pairing | Admin UI now shows "Refunds RCP-YYYY-NNNNN · {amount}" under each refund row, pointing at the original payment in the same list |
| HD-19 | 🟦 Info | NOTE | Per-archive purge | No row-level purge; only school-wide via `purge_school_archive` / `delete_school_cascade` |
| HD-20 | 🟦 Info | NOTE | Tax rate history | No `tax_rates` table — fine today because `tax_amount`/`tax_label` are per-row |
| HD-21 | 🟦 Info | RESOLVED | Chart account code | `updateAccount` does not accept `code` in the request body — code is immutable post-creation. Not a bug |
| HD-22 | 🟦 Info | NOTE | Profile picture URL | `archived_employees.profile_picture` points at live bucket — snapshot not self-contained |
| HD-23 | 🟦 Info | NOTE | Mobile accountant | No mobile surface (AC-12, by design) |

Legend: **TODO** = pending PR · **VERIFY** = needs code check before deciding ·
**FEATURE** = documented in FEATURE.md, no code yet · **INFO** = accepted ·
**NOTE** = design call recorded, no action · **DONE** = shipped (with commit
sha).

## PR plan

### PR C — defensive (closes HD-2 + HD-3 + HD-5 + HD-9)

- Migration 045: extend `_canon_archived_student` to include `enrollment_history`
  and `transfer_id` in the canonical form; bump version tag; handle legacy v1
  rows in `verify_school_integrity` so existing archives don't false-flag.
- `snapshotStaffArchive` in `staff.controller.ts`: drop the
  `.is('voided_at', null)` filter, extend the JSONB shape to carry `voidedAt`
  / `voidedBy` / `voidReason`.
- `uploadPostFile` + `uploadEbook`: prefix the storage key with `${schoolId}/`
  so cross-tenant URL guessing is impossible.
- Migration 045: `prevent_archive_mutation` trigger on `archive_backups` (same
  GUC bypass pattern as `archived_students`).

### PR D — audit-coverage (closes HD-4)

Wire `logAudit()` into:

- `glaccounting.controller.ts`: createAccount, updateAccount, deleteAccount,
  createJournalEntry.
- `accounting.controller.ts`: closePeriod, reopenPeriod,
  createPaymentAccount, updatePaymentAccount, deletePaymentAccount, setFxRate,
  deleteFxRate.

Mechanical. Use the existing `logAudit(...)` signature with before/after
JSONB diffs.

### PR E — snapshot completeness (closes HD-1 + HD-13)

Policy call needed first: snapshot the high-volume relations inline (large
JSONB) vs. move them to a per-school cold table that survives student/staff
delete via FK-less columns. Recommend cold-table approach for `attendance`
because per-student daily rows can run into thousands per year.

For HD-13 (staff): snapshot attendance + insurance-payout-reversal history
into `archived_employees.employment` JSONB — small, bounded.

### PR F — parent UX (closes HD-7 + HD-18)

- Parent fee screens (web `TuitionPage.tsx` + mobile `TuitionScreen.tsx`):
  render refund and voided rows with a clear marker. Mirror the mobile salary
  screen's voided-card pattern.
- Admin tuition detail: when rendering a refund row, link to the original
  payment id (anchor / scroll-into-view).
- i18n in 6 locale files for refund + void markers.

### PR G — web/mobile parity (closes HD-10 + HD-14 + HD-17)

- Web archived-student detail: surface `payment_history` JSONB from the
  snapshot. Mirror the mobile parent screen's table.
- Itemize late fees in tuition detail (web + mobile): list each applied late
  fee row with `applied_on`, amount, void marker.
- GL/P&L/AR reports: add an academic-year preset that maps to the school's
  `tuition_config.academic_year_start/end` (or `schools.timezone` + a sane
  default range).

### Verification before action

- **HD-5**: Read every `homework-attachments` upload path. Confirm path is
  `<schoolId>/<...>` or just `posts/...`. If the latter, file as a tenancy bug
  and fix the upload-key construction.
- **HD-21**: Read `glaccounting.controller.ts:updateAccount` and confirm
  `code` is rejected for `is_system=true` rows.

### Out of scope / planned (FEATURE.md)

- **HD-11**: chat-file ownership tracking — needs a DB row per uploaded
  attachment so orphans can be cleaned up + linked to the message.
- **HD-15**: storage-orphan sweep cron.
- **HD-16**: master portal snapshot viewer (related to FEATURE.md
  "browser-side restore", but simpler: viewer reads + renders, doesn't write).

## False positives dropped from agent output

- **"GL is unhashed"**: agent missed `hash_journal_entry()` per-school; chain
  is in fact present.
- **"Staff salary export PDF has no archive fallback (residual AC-14)"**: PR
  B already shipped `buildExportData ?? buildExportDataFromArchive`.
- **"GL not in archive backup (AC-10)"**: shipped on `main` (commit
  `8dc00f3`).

## Verified OK (no action)

- Append-only triggers on `archived_students`, `archived_employees`,
  `audit_logs`, `journal_entries`, `journal_lines`. GUC
  `app.allow_archive_purge` set only by `purge_school_archive` and
  `delete_school_cascade`.
- Refund modelled as a separate row with `refund_of_payment_id`; original
  never mutated.
- `assertPeriodOpen` blocks writes in closed periods.
- Premium-gate (`tuition_fees` off) does not delete data; archive-gate off
  destructively purges archives — by design.
- Reception RO scope correct (AC-11).
- Receipt numbers sequential per school per calendar year.
- Service-role client used server-side only.

## Resume notes

After /compact, pick up by reading this file. The PR plan above is the work
queue. Demo-data state still applies (see `[[scholify-demo-data-only]]`
memory). Start with HD-5 + HD-21 verifications (cheap, gate the criticality
of HD-5), then PR C.
