# Functional Audit — 2026-07-02

Scope: **Financial (fees/payments/GL)**, **Grades & academics**, **Records & attendance**.
Method: 6 targeted finder agents (located via graphify map), each finding verified against
the actual code/schema. Backend is `backend/src`; DB is `database/schema.sql` + `database/migrations/`.

> **Latency note:** Scholify DB currently holds demo data only, so these are *latent* — real
> code defects that bite once real money/grades/records flow, not active corruption today.
> Verification status per item: **[verified]** = traced by the reviewer; **[reported]** = from
> the finder, lighter confirmation.

---

## 🔴 HIGH — fix before real data

### H-1. `grades` upsert has no unique constraint to conflict on  ✅ FIXED — *two finders converged*
> **Fixed:** prod check confirmed the index exists live (drift). Migration `072_grades_identity_unique.sql`
> tracks it (dedupe + CREATE UNIQUE INDEX IF NOT EXISTS, same name as prod = no-op there); same index added
> to schema.sql; `gradingPeriod` made required in `upsertGradeSchema` (phase2.ts) to close the NULL-dup hole.
> Deploy: run migration 072 (no-op on prod) + ship backend.
- **Where:** `backend/src/controllers/teacher.controller.ts:345`, `backend/src/controllers/admin.controller.ts:4258`
- Both do `upsert(..., { onConflict: 'student_id,subject,grading_period,academic_year' })`, but the
  `grades` table (`database/schema.sql`, grades DDL) and **every** migration define no UNIQUE on those
  columns. Only a non-unique `idx_grades_student_subject(student_id, subject, grading_period)` exists
  (`002_supervisor_attendance_grades.sql:33`) — not unique and missing `academic_year`. Migration
  `049_metrics_foundation.sql:74` only adds a column.
- Postgres rejects the col-list ON CONFLICT form without a matching unique constraint (`42P10`).
- **Impact:** Either grade save/import breaks on any fresh provision from tracked schema, OR the
  constraint exists in prod only as **untracked drift** → schema can't reproduce a working DB (DR/staging landmine).
- **Fix:** Confirm against prod. Add `UNIQUE (student_id, subject, grading_period, academic_year)` (or a
  partial unique index) to `grades` in a new migration. Contrast: `reports` upsert has its UNIQUE
  documented in `049_metrics_foundation.sql:32` — grades is the omission.

### H-2. Refunds & voided payments inflate "paid" totals on archived/graduated students  ✅ FIXED
> **Fixed:** `ArchivePaymentEntry` gained `isRefund` + shared `netPaid()` helper (paymentArchiveExport.ts);
> plansFromSnapshot / plansFromGraduated / summarisePlans / graduated inline sum / receipt paidBefore all
> sign refunds; snapshot capture now excludes voided (admin.controller); PDF/XLSX label refund rows as
> negative "Refund" lines. Reader-side fix is retroactive for existing snapshots (they already store isRefund).
>
> **Bonus fix (user-reported, related to M-5):** drawer balance display subtracted GROSS salary while the GL
> correctly credits cash NET of withheld insurance — a 3%-insurance salary dropped the drawer 100% instead
> of 97%. listPaymentAccounts (accounting.controller.ts) now subtracts net (insurance × exchange_rate).
> The payout side (drawer picker + payout as drawer outflow) is deferred to M-5/M-6.
- **Correct reference path:** `backend/src/controllers/fees.controller.ts:535` — live path signs refunds
  (`sign = is_refund ? -1 : 1`).
- **Broken paths (all ignore `is_refund`):**
  - Graduated list: `fees.controller.ts:2247` (selects only `amount`, sums unsigned)
  - Graduated per-student export `plansFromGraduated`: `fees.controller.ts:2149`
  - Archived reader `plansFromSnapshot`: `fees.controller.ts:2129` (drops the `isRefund` the snapshot stores at `admin.controller.ts:1778`)
- **Compounded by:** snapshot capture omits a `voided_at` filter and never records `voided_at`
  (`admin.controller.ts:1731`, contrast late-fee query at `:1751` which filters voided), so voided
  payments are frozen in as paid forever.
- **Scenario:** paid $500, refunded $200 → official PDF/XLSX shows **$700 paid / balance $0** instead of $300 / $200.
- **Fix:** Factor a shared "net paid" helper (sign on `is_refund`, exclude `voided_at`) and reuse across
  all archive/snapshot consumers + capture `voided_at` in the snapshot.

### H-3. Transfer-out permanently loses attendance + payment history  ✅ FIXED
> **Fixed:** completeTransfer now reuses admin.controller's `buildStudentArchiveSnapshot` (exported) instead
> of its hand-rolled partial copy — transfer archives now carry the day-by-day attendance log, full payment
> history (with H-2's refund/void handling), grades, and reports, identical to the withdraw path.
>
> **Plus (user decision):** extended personal fields (home_address, emergency_contact, phone_number) now
> survive archiving on ALL paths (withdraw / transfer / graduated). Migration `073_archive_personal_details.sql`
> adds the columns, bumps the tamper-evidence canon to as.v4 (re-hashing existing rows — demo-data precedent
> from 045), and extends `archive_student_atomic` with the personal params. schema.sql mirrored. The transfer
> bundle + Scholify→Scholify import already carried these fields (verified, no change needed).
> **Deploy order matters: run migration 073 BEFORE deploying the backend** (new code passes params the old
> RPC doesn't accept; old code against the new RPC is fine via defaults).
> ~~Open question parked: student health records CASCADE-delete on archive.~~ **DECIDED (2026-07-02):
> destroy-on-departure in all conditions is the policy** (medical privacy). Recorded as comment-only
> migration `074_health_records_retention_policy.sql` + schema.sql + buildStudentArchiveSnapshot comment,
> with the retention extension path documented (encrypted capture → archived_students column → canon as.v5)
> if it's ever wanted.
- **Where:** `backend/src/controllers/studentTransfer.controller.ts:357` (enrollment select omits
  `attendance_totals`), `:431` (`p_classes_attended: []`), `:434` (`p_payment_history: []`).
- `archive_student_atomic` then deletes the live student, cascading the `attendance` table. Withdrawal
  path (`admin.controller.ts` ~1811-1825, 1927) preserves both via `attendanceByYear` / `snap.paymentHistory`.
- **Scenario:** a student with a full year of daily attendance is transferred out → per-day log + frozen
  totals gone forever from the archive; an identical *withdrawn* student keeps them.
- **Fix:** Mirror the withdrawal snapshot: load attendance + real payment_history and pass them into
  `archive_student_atomic`. (Confirm payment-history drop isn't intentional-by-bundle; still an
  undocumented asymmetry.)

---

## 🟠 MEDIUM

### M-1. Cross-class grade overwrite  ✅ FIXED
> **Fixed:** upsertGrade now requires the student to be a current member of the submitted class in the
> caller's school (piggybacked on the existing Promise.all — no extra latency; 403 "Student is not in this
> class."). The class-blind upsert key is intentionally kept: with the enrollment check, only the student's
> current class teacher can write, which makes the replace-on-class-move behavior legitimate.
>
> **Bonus fix (user-reported): term-less grade saves.** Web GradingPage let Save fire with no term selected
> — current backend rejects it (window gate + H-1's required validator), but older deployed backends stored
> an orphan grade under an empty term that no term-grouped view showed ("success" with an invisible grade).
> Web now guards in onSubmit + disables Save until class/student/subject/term are all chosen (mobile already
> did). Check for orphans: `SELECT count(*) FROM grades WHERE grading_period IS NULL OR grading_period='';`
- **Where:** `backend/src/controllers/teacher.controller.ts:333` (upsert), guard at `:311`.
- `upsertGrade` writes `studentId` from the body with no check the student is enrolled in `classId`
  (or the school). `subjectAllowedForClass` (`backend/src/utils/curriculum.ts:11-27`) only checks the
  teacher teaches `subject` for `classId` (and is lenient when no rows). Conflict key omits
  `class_id`/`teacher_id`.
- **Scenario:** Math teacher of 7A posts `{studentId:<7B student>, classId:<7A>, subject:"Math"}` → passes,
  overwrites the 7B student's Math grade, reassigns `teacher_id`, resets `is_released=false`.
- **Fix:** Validate the student is enrolled in `classId`; consider including class/teacher in the identity.

### M-2. Marks with no configured max silently dropped from subject %  ✅ FIXED
> **Fixed (regional model: each lesson out of a school-defined total; components sum to it):**
> 1. Grade-applicable mark types (applies_to grade/both) now REQUIRE a positive max_value at
>    create/update (resulting-state validated); report-only types stay freeform. Deliberately NO
>    sum-to-100 lock — schools keep their own scales (user decision).
> 2. Teacher grade saves reject unknown mark names when the school has grade mark types (server now
>    enforces what the web dropdown already did).
> 3. subjectPercent: if ANY mark lacks a max, the whole subject falls back to RAW SUM instead of
>    silently dropping the unmatched marks — fixed in all THREE lockstep copies (backend gradeCalc.ts,
>    web marks.ts, mobile gpa.ts).
> 4. SettingsPage: max required client-side for grade types; server errors surfaced.
>
> **GPA hardening (found while verifying "is GPA configured properly"):**
> - bandForPercent (3 copies): percent below every threshold now maps to the LOWEST band instead of
>   null — previously a failing subject was silently EXCLUDED from the GPA average, inflating it.
> - updateGradingConfig: mode whitelist, band field validation, no duplicate thresholds, floor band
>   (min 0) required, and ALL validation runs before the delete+insert swap (a bad payload previously
>   wiped the school's entire band set). SettingsPage mirrors the floor-band check.
> - GPA math/mode/bands mechanism itself verified correct (incl. default band set A90/B80/C70/D60/F0).
>
> Hygiene SQL (run in Supabase editor):
> ```sql
> -- grade-applicable mark types still missing a max (fix in Settings UI):
> SELECT s.name AS school, mt.name, mt.applies_to FROM mark_types mt
>   JOIN schools s ON s.id = mt.school_id
>  WHERE mt.applies_to IN ('grade','both') AND (mt.max_value IS NULL OR mt.max_value <= 0);
> -- grade-row mark names not matching any configured type (legacy/free-text era):
> SELECT DISTINCT g.school_id, m->>'name' AS mark_name FROM grades g,
>   jsonb_array_elements(g.marks) m
>  WHERE NOT EXISTS (SELECT 1 FROM mark_types mt WHERE mt.school_id = g.school_id AND mt.name = m->>'name');
> ```
- **Where:** `backend/src/utils/gradeCalc.ts:77` (`subjectPercent`).
- Only components with `markMaxes[name] > 0` add to *both* earned and max; a mark whose `mark_types` row
  has no `max_value` is excluded from numerator and denominator.
- **Scenario:** Daily(max20, scored18) + Homework(no max, scored10) → % = 90.0, the 10 vanishes from %,
  average, and GPA on the authoritative PDF.

### M-3. Report-card average diverges from live parent page  ✅ M-3a FIXED / M-3b → own plan
> **Split (2026-07-04):** M-3a = term-level alignment (below). M-3b = the official subject-first year
> average + the remedial/supplementary term (a full feature — nothing in the system modeled either) —
> **moved to `REMEDIAL_TERM_PLAN.md`**, tracked there, not here.
>
> **M-3a fixed:** all live pages now compute the SAME numbers the PDFs print — per-subject value =
> `subjectPercent` (normalized when maxes are configured), term average = `averagePercent` over subject
> percents (zeros counted, missing subjects skipped — the PDF's inclusion rule; the old `> 0` filter
> inflated averages by dropping all-zero subjects, which also closes the LOW "all-zero subject counted
> vs skipped" divergence at the display layer). Changed: `averagePercent` added to web `marks.ts` +
> mobile `gpa.ts` (backend `gradeCalc.ts` already had it — three lockstep copies again identical);
> parent web `GradesPage.tsx` (subject cell, `termAverage()`, year avg); mobile parent
> `GradesScreen.tsx` (same three); admin `StudentBriefPage.tsx` (per-row total, term averages, Full
> Year Mark — now loads `/grade-config`; this page was an unlisted 4th diverging surface). Year
> averages remain average-of-term-averages pending M-3b. "Total" column label kept (user decision).
> No behavior change for schools whose maxes sum to 100 or are unconfigured (`subjectPercent`
> falls back to raw totals). Frontend + mobile only (mobile is OTA-safe, no new deps); no backend
> change, no migration. Deploy: ship web + mobile OTA with the pending audit bundle.
- **Where:** `backend/src/controllers/reportCard.controller.ts:292` (report card), `:449`, `:468` (transcript).
- PDFs compute `averagePercent(subjectPercent[])` (normalized), while parent
  `frontend/src/pages/parent/GradesPage.tsx:345` `termAverage()` averages `gradeTotal()` (raw sums).
  `gradeCalc.ts:1-3` promises identical numbers. Divergence appears when mark maxes make totals ≠ percents.

### M-4. Transfer bundle integrity hash non-reproducible  [verified]
- **Where:** `backend/src/utils/transferBundle.ts:282` (`generatedAt: new Date()` inside payload),
  hashed at `:109` (`signBundle`). Persisted at `studentTransfer.controller.ts:253-259`, audited at `:457`.
- Every regenerated JSON/PDF download → different `generatedAt` → different sha256/signature than the
  stored/audited anchor. Comment at `:250-252` claiming stability is false.
- **Fix:** Exclude `generatedAt`/`signedAt` from the canonicalized-and-hashed payload (or freeze them).

> **M-4 fixed (2026-07-05):** chose the freeze approach (keeps the timestamp *inside* the signed
> payload, tamper-evident) over stripping it. `buildTransferBundle` now reuses the persisted
> `bundle_generated_at` (normalised via `toISOString()` — PostgREST renders timestamptz in a
> different ISO variant) and only stamps `new Date()` on the very first build, so a rebuild of
> unchanged data reproduces identical canonical bytes → identical sha256/signature. Anchoring moved
> to a shared `anchorBundleIntegrity()` used by BOTH download endpoints (previously the PDF endpoint
> never persisted, so a PDF-first download handed out an unanchored artifact; it now also flips
> consented → bundle_generated). If the underlying data changes while the bundle is still in the
> source's hands (`bundle_generated`), the rebuild's differing hash moves the anchor and writes a
> `bundle_regenerated` audit entry with `previous_sha256`/`sha256` — the anchor always describes the
> artifact actually handed out, and the change is visible instead of silently diverging. Also made
> the grades query fully ordered (`academic_year, grading_period, subject`) — array order is part of
> the canonical payload, and the previous year-only sort left tie order unspecified, which could
> shuffle rebuilds into spurious hash changes. The false "keeps the same signature" comment is gone.
> Backend only, no migration. Verified end-to-end against a locally-run backend + demo DB: PDF-first
> download anchors + flips status; two JSON downloads returned byte-identical bundles with sha equal
> to the anchor; a student-field edit produced a new sha, moved the anchor, and logged
> `bundle_regenerated` (old/new sha) in `audit_logs`; a further no-change download was stable at the
> new anchor. Note: pre-fix rows re-anchor once on their next download (old code persisted the
> envelope's `signedAt`, not the payload's `generatedAt`) — expected, audited, then stable.
> Related LOW noted during the fix, not addressed: `downloadBundlePdf` allows status `completed`,
> but the student row is gone by then, so that path always 404s (a snapshot-style fix would cover it).

### M-5. Insurance payout credits phantom system Cash (1000), not the real drawer  [reported]
- **Where:** `backend/src/utils/glPosting.ts:331` (`acc.byCode('1000')`); caller `staff.controller.ts:949`.
- Other posters route cash via `acc.cashFor(paymentAccountId)` (codes 1200+). Payout hardcodes 1000, which
  stays empty, so per-account balances drift (entry still balances; TB nets in aggregate).

### M-6. Cross-currency insurance liability never clears  [reported]
- **Where:** `backend/src/utils/glPosting.ts:311` (accrual) vs `:333-340` + `staff.controller.ts:921-950` (payout).
- Payable (2000) credited in drawer currency on salary, debited in salary-entered currency on payout. When
  they differ, account 2000 keeps a permanent uncleared per-currency balance. Same-currency case unaffected.

> **M-5 + M-6 fixed together (2026-07-05, "Part 2" of the insurance flow):** the payout now moves
> real money like every other cash flow. Locked product decisions: FX is **always the payout-date
> rate** (never the withholding-day rate — small residue on the payable accepted if rates moved,
> zero in the same-currency case), and the cash leaves **one drawer** chosen at payout time
> regardless of where the insurance accumulated. Changes: `insurancePayoutSchema` +
> `markStaffInsurancePaid` now require `paymentAccountId` (explicitly validated school-scoped +
> active, since `resolveDrawerAmount`'s unknown-id path silently falls back to rate 1), convert via
> `resolveDrawerAmount(asOf = paidOn)`, and persist the drawer view on the staff row
> (`insurance_paid_out_account_id/_paid_amount/_paid_currency/_exchange_rate`, **migration 076** —
> mirrors 056's paid_* columns; FK ALTERs live in schema.sql after `payment_accounts` because of
> creation order). `postInsurancePayout` takes `paymentAccountId` and credits
> `cashFor(paymentAccountId)` instead of the phantom `byCode('1000')`, posting in the drawer's
> currency (M-5 + M-6). The drawer display balance (`listPaymentAccounts`) gains a fourth source:
> subtracts `insurance_paid_out_paid_amount` per drawer — the withheld cash that "stayed in the
> till" finally leaves it on payout. `reverseStaffInsurancePayout` clears the four new fields (its
> GL reversal already worked). Web payout dialog gets the same "paid from" picker + cross-currency
> preview as the salary modal (reuses existing i18n keys — no new strings). **No backfill:**
> pre-076 payouts had no drawer, NULL account_id keeps them out of drawer balances; reverse +
> re-record upgrades them. Backend + web only, no mobile. **Deploy: run migration 076 (idempotent,
> additive) before this backend — DONE 2026-07-05.** tsc backend+frontend clean, tenant-scoping
> clean. **Verified end-to-end** against a locally-run backend + demo DB (accountant JWT — the
> accounting routes are accountant-only): $500 salary with $25 withheld from an IQD drawer @1410 →
> GL Dr 5000 705,000 / Cr drawer 669,750 / Cr 2000 35,250, drawer display −669,750 (net only);
> payout @ payout-date rate 1450 → GL Dr 2000 36,250 / Cr DRAWER cash 36,250 in IQD (account 1000
> untouched), staff row froze drawer/36,250 IQD/rate 1450, drawer display −706,000; payable 2000
> net = −1,000 IQD = exactly the documented rate-move residue; probes: missing paymentAccountId →
> 400, unknown account → 404, double payout → 409; reversal → all four fields cleared, reversal
> entry posted, drawer display back to −669,750. Test fixtures fully cleaned from the demo DB.

---

## 🟡 LOW  [reported]

- **AR-aging buckets ignore `adjustment`** → per-row buckets don't reconcile to balance.
  `backend/src/controllers/accountingReports.controller.ts:184` (vs `dueTotal` incl. adjustment at `:177`).
- **All-zero subject counted vs skipped** depending on marks-array (returns 0, counted) vs legacy columns
  (returns null, skipped). `backend/src/utils/gradeCalc.ts:80` vs `:83`.
- **Grade band from 1-dp-rounded percent** promotes 49.96 → 50.0 across a cutoff. `gradeCalc.ts:79 → :87-92`.
- **Import maps students by lowercased name** → same-name students in a class collide, one silently dropped.
  `backend/src/controllers/admin.controller.ts:4179-4184`, applied at `:4231-4232`.
- **Mark values range-unbounded** — negatives/over-max accepted. `backend/src/validators/phase2.ts:22-25`.
- **Double-scan seconds after check-in checks the employee back out** (no minimum-dwell; guard only covers
  simultaneous INSERT race). `backend/src/controllers/staffAttendance.controller.ts:224` (guard `:196-214`).
  Stuck "checked out for today" (multi-punch is Phase 2) until admin correction.
- **Health-brief decrypt unguarded** → one corrupt field 500s the whole teacher/admin student brief.
  `backend/src/utils/studentHealthBrief.ts:30-31` (controller guards the same decrypt at
  `studentHealth.controller.ts:47-54`).
- **`acceptIncomingTransfer` double-import race** — no status-guarded UPDATE.
  `backend/src/controllers/studentTransfer.controller.ts:680-744`.
- **Receipt "paid before" unsigned** — refunds inflate the running total on the printed receipt.
  `backend/src/controllers/fees.controller.ts:1847`.
- **`onLeave` double-count** with overlapping leave rows (`createLeave` has no overlap check).
  `backend/src/controllers/staffAttendance.controller.ts:509-523,543,745-787`.
- **`is_late` midnight quirk** — en-GB `hour12:false` may render "24:00" for 00:00 on some engines.
  `staffAttendance.controller.ts:73-77` (compared `:184`). Low confidence.
- **GL report aggregations have no explicit exhaustive-fetch/pagination guard**
  (`glaccounting.controller.ts:169-176`, journal export `:647` builds up to 100000-UUID `.in()`).
- **pg_cron posters skip period-close check** — `apply_late_fees` / `auto_record_recurring_expenses`
  (migrations 023/043) can post to a locked period; TS `assertPeriodOpen` only guards manual entries.
- **Payment currency mismatch** (low confidence, depends on client) — `recordPayment` persists a
  client-supplied `currency`/`amount`; `buildStudentFeeRows` sums `amount` against a plan-currency total
  with no reconciliation. `fees.controller.ts:1012-1047, 536`.

---

## ✅ Verified correct (no action)
- GL double-entry integrity: balance checked 3× (`createJournalEntry:472`, `postEntryResult:51`, RPC
  `gl_post_entry` in schema) + atomic RPC; TB/P&L/balance-sheet sign handling correct.
- Staff-attendance QR-token HMAC/rotation/expiry (current+previous 60s window, constant-time compare,
  tenant re-check) and geofence Haversine math (R=6371000 m, radians, arg order) — no bypass.
- Auto-closeout SQL (migration 065 vs 063): correct naive-timestamp local-tz comparison, no off-by-one/DST.
- PII encryption round-trips (IV/tag, base64url, per-school HKDF, version dispatch).
- Enrollment-timeline continuity (`academic_year` UNIQUE → safe ordering).
- Grade filing-window lock: no teacher-writable path bypasses `getOpenWindowForTerm`
  (`teacher.controller.ts:321`); admin paths bypass by design.
- Tenant `school_id` scoping intact across audited queries.
- FX rate direction / rounding (`backend/src/utils/fx.ts`, `currency.ts`).

---

## Suggested fix order
1. **H-1** — confirm prod constraint, add migration (unblocks understanding of M-1's overwrite too).
2. **H-2** — shared net-paid helper reused across the 3 archive sites + snapshot `voided_at`.
3. **H-3** — mirror withdrawal snapshot in the transfer path.
4. **M-1**, then the rest by severity.
