# Shelved features

Things that are built (or partially built) in this repo but intentionally
hidden from the UI until a follow-up phase ships, plus features that are
planned but not yet started. The code (where it exists) is left in place
so we can pick up where we left off without rebuilding from scratch.

---

## Cross-school student transfer

**Status:** Phase A (non-Scholify) + Phase B prep (Scholify↔Scholify) shipped
and working end-to-end. **Phase C (platform-wide student identity) deferred
until master.elkurdi.co adds the student-identity layer.** UI entry points
are hidden as of 2026-05-31. Backend endpoints + routes remain live.

### What the feature does (today)

A school admin can transfer a student to another school. Two paths exist:

| Path | Audience | Flow |
|---|---|---|
| **Non-Scholify** | Any school not on Scholify | Source generates a signed JSON + PDF pack (`scholify.transfer.v1.signed`). Parent walks the pack to the destination. Source archives the student with reason `transferred`. |
| **Scholify↔Scholify** | Another school on the same Supabase tenant | Source picks the destination from an in-platform directory. Bundle goes into destination's Incoming inbox. Destination admin accepts, picks a class, and the student materialises in their school. Source then archives. |

Both paths:
- Capture parental consent at source (canonical text + parent name + witness, anchored with `consent_hash`).
- Produce a signed bundle (HMAC-SHA256 with `TRANSFER_SIGNING_KEY` env).
- Run the source-side archive through `archive_student_atomic` with `p_transfer_id` set so the archive row links back to the transfer.
- Use the same `scholify.transfer.v1` JSON format and `scholify.transfer.v1.signed` envelope.

### Where the code lives

**Database**
- [database/migrations/032_student_transfers.sql](database/migrations/032_student_transfers.sql) — `student_transfers` table + `transfer_id` on `archived_students`.
- [database/migrations/033_archive_student_with_transfer_id.sql](database/migrations/033_archive_student_with_transfer_id.sql) — extends `archive_student_atomic` with `p_transfer_id`.
- [database/migrations/034_student_transfers_scholify.sql](database/migrations/034_student_transfers_scholify.sql) — adds destination columns + new statuses for the Scholify path.

**Backend**
- [backend/src/utils/transferBundle.ts](backend/src/utils/transferBundle.ts) — canonical JSON serialiser, HMAC signer, consent hasher, bundle assembler.
- [backend/src/utils/transferBundlePdf.ts](backend/src/utils/transferBundlePdf.ts) — companion human-readable PDF.
- [backend/src/controllers/studentTransfer.controller.ts](backend/src/controllers/studentTransfer.controller.ts) — 14 endpoints (state machine, source-side + destination-side).
- [backend/src/routes/index.ts](backend/src/routes/index.ts) — `/admin/transfers/*` mount points (still wired).

**Frontend**
- [frontend/src/components/admin/TransferWizard.tsx](frontend/src/components/admin/TransferWizard.tsx) — 5-step wizard (Destination → Consent → Download → Send → Complete; "Send" only for Scholify).
- [frontend/src/pages/admin/TransfersPage.tsx](frontend/src/pages/admin/TransfersPage.tsx) — Outgoing + Incoming tabs with detail / accept / reject modal.
- Route `/admin/transfers` still registered in `App.tsx`.

**i18n** — `admin.transfer.*` namespace in en/ar/ku.

**State machine**
```
pending_consent → consented → bundle_generated → completed                (non_scholify)
                                              ↘
                                          awaiting_destination
                                          ↙                  ↘
                              destination_rejected      destination_imported
                                    ↓ Re-send / Cancel       ↓ Archive
                              bundle_generated         completed
cancelled (terminal, from any prior non-terminal state)
```

### Why hidden

The phases shipped so far work end-to-end for the schools currently on the
platform, but they lack the parts that need a real student-identity service:

- **No platform-wide `STU_*` identifier** that follows the student across transfers. The destination always gets a fresh internal UUID — there's no way for the system to say "this is the same kid we saw at School Y last year."
- **No cross-school dedup.** When a destination admin accepts a transfer, the system can't tell them "wait — this kid (by DOB + national ID) is already enrolled at your school under another name." Manual due diligence only.
- **No cross-school parent portal.** Parents can't carry their login from source to destination; we ship a placeholder parent row with no account.

These gaps are acceptable for two specific schools that know each other, but
not for opening the feature to the wider platform. Better to keep it hidden
than to ship a half-feature people will misunderstand.

### What's hidden

- Sidebar entry "Transfers" (`Sidebar.tsx` — commented out).
- "Transfer student" button on the live student profile (`StudentBriefPage.tsx` — commented out).

### What's NOT hidden

- The page itself at `/admin/transfers` is still reachable via direct URL (no link to it though). Useful for testing without un-hiding the UI.
- Every backend endpoint (`POST /admin/transfers`, `GET /admin/transfers/directory`, `/admin/transfers/incoming/*`, etc.) is still mounted and works.
- Migrations 032 / 033 / 034 are applied and the columns exist on production tables.

### How to bring it back

1. **Lock the design for Phase C** (student identity at `master.elkurdi.co`):
   - New tables (likely in master's identity DB alongside `operator_accounts`): `students_global`, `guardians_global`, `student_memberships`.
   - Per the locked plan ([memory/student-transfer-plan.md](C:\Users\rasts\.claude\projects\e--master\memory\student-transfer-plan.md)): national-ID-hash + DOB as the primary dedup signal, name + DOB as secondary, always human-confirmed.
2. **Master API** — new routes under `/identity/students/*` and `/identity/guardians/*`. Service-token auth for school portals to call.
3. **Scholify backend** — integration client calling master at: student create, bulk upload, transfer accept. Surfaces match candidates back to the UI.
4. **Scholify frontend**:
   - Student-create form: "this might be an existing student — attach?" pre-step.
   - Transfer accept (`acceptIncomingTransfer`): pre-step asks "is this a returning student already in your school?" with suggested matches.
5. **Backfill** — one-shot script that mints `STU_*` for every existing student in every school + populates `student_memberships`.
6. **Un-hide UI**:
   - Restore the `Transfers` entry in [frontend/src/components/layout/Sidebar.tsx](frontend/src/components/layout/Sidebar.tsx).
   - Restore the "Transfer student" button + `transferOpen` state in [frontend/src/pages/admin/StudentBriefPage.tsx](frontend/src/pages/admin/StudentBriefPage.tsx).
7. **Memory** — update [student-transfer-plan.md](C:\Users\rasts\.claude\projects\e--master\memory\student-transfer-plan.md) build status to "Phase C shipped."

### Locked design (do not re-litigate)

See [`memory/student-transfer-plan.md`](C:\Users\rasts\.claude\projects\e--master\memory\student-transfer-plan.md) for the 11 locked decisions from the original design conversation. The shipped code follows that plan; Phase C must continue to.

### Environment variables

- `TRANSFER_SIGNING_KEY` — HMAC-SHA256 key for signing bundles. ≥32 chars of entropy. Set on Railway. Without it, the backend derives a key from `JWT_SECRET` (dev-only fallback). Phase C will keep using the same key + format — do not fork.

### Phase C scope reminder (the gap)

| What still needs the real identity DB | Notes |
|---|---|
| `STU_*` following the student | Currently fresh UUID at destination |
| Cross-school dedup | Destination admin confirms manually today |
| Cross-school parent portal | Placeholder parent row only, no login |
| Retrofit existing students with `STU_*` | One-shot backfill needed |

When master.elkurdi.co's identity DB grows the student-identity tables and exposes the matching API, Phase C is a couple of days of integration on the Scholify side — the wizard, state machine, bundle format, and UI all stay.

### ⚠️ Scalability flag — added 2026-06-16

Phase C is **dependency-gated, not load-gated** — it waits on
master.elkurdi.co's identity DB, not on throughput. When it resumes,
size two things: (1) the one-shot `STU_*` backfill scales linearly with
total students across every school — batch it, run off-peak; (2) the
cross-school dedup match (national-ID-hash + DOB) fires on every
student-create and transfer-accept — the identity DB needs hash + DOB
indexes before this opens platform-wide. Both are cheap at today's scale;
neither is a redesign.

---

## Lifetime transcript view (HD-9 from the 2026-06 historical-data audit)

**Status:** Not built yet — planned. No code exists. Tracked here so the
shape of the feature isn't lost between the audit conversation and the
follow-up PR.

### What the feature does

A single admin page (and PDF export) showing a student's complete academic
record across every year they've been on the platform, joining live data
and archive snapshots into one chronological narrative. Use cases:
issuing a transcript at parent request, sending a transfer pack, internal
review when a returning student re-enrols.

The pieces already exist — they're just scattered across screens. Today
admins have to open three different views to assemble what one page
should show:

| Source today | Fields |
|---|---|
| Live student profile | basics, current class, current-year grades |
| [getStudentEnrollmentHistory](backend/src/controllers/admin.controller.ts) | per-year enrollment timeline |
| `archived_students` (when departed) | frozen `grades` + `reports` + `payment_history` JSONB |
| `students.previous_archive_id` chain | prior enrolment from a returning student |

### What it needs

**Backend** — new endpoint, archive-feature-gated:
- `GET /admin/students/:id/transcript` — returns a single bundled payload joining the live record + every linked archive snapshot via the `previous_archive_id` chain. Same JSONB shapes the archive viewer already renders (`grades`, `reports` from migration 041, `enrollment_history`, `payment_history`).
- `GET /admin/students/:id/transcript.pdf` — PDF generator that walks the same payload. Probably reuses the styling from [archiveExport.ts](backend/src/utils/archiveExport.ts) so the transcript and the archive PDF feel like the same product.
- Audited on every PDF export (`entityType: 'student'`, `action: 'export'`).

**Frontend** — new admin page:
- `/admin/students/:id/transcript` — read-only page rendering the bundled payload with year-grouped sections (mirrors the year-filter pattern from PR 2's [StudentsPage.tsx](frontend/src/pages/teacher/StudentsPage.tsx)).
- Download-PDF button on the page.
- Entry points: a "View transcript" link on the live student profile + a "View transcript" CTA on each `archived_students` detail modal (when the live student exists at this school).

**Parent surface (optional follow-up)** — a "request transcript" button on the parent's grades page that fires off an internal notification to admins. The admin then runs the existing PDF endpoint and shares the file out-of-band. Keeps parents from generating arbitrary PDFs on their own children, which the school may want to gate on policy.

**i18n** — new `admin.transcript.*` namespace, en/ar/ku.

### Why hidden / why now

Practically every piece of data is already captured — PR 1 made reports
durable and added them to the archive snapshot, PR 2 added the year
filter pattern that the transcript page would reuse. The remaining work
is presentation: one backend endpoint + one page + one PDF generator.

Not blocking any other feature; not security-sensitive. Pure UX gap.
Sized at ~2 days of focused work.

### Notes for whoever picks this up

- The "previous_archive_id" chain on `students` is already established for both students ([restoreArchivedStudent](backend/src/controllers/admin.controller.ts)) and employees ([restoreArchivedEmployee](backend/src/controllers/admin.controller.ts)). Walk it backwards from the live row to find every prior archive.
- Reports in the snapshot already carry `teacher_name_snapshot` + `class_name_snapshot` (PR 1) so the transcript renders correct names even if the writing teacher has been archived since.
- A graduated student has `is_graduated=true` + an `archived_students` row (`reason='graduated'`) referenced via `original_student_id`. The transcript should pull that snapshot too, not just rely on the live row.
- Archive-gated like the rest of the historical-data surfaces. Schools without the archive feature get a transcript spanning only their currently-enrolled year and any current `student_enrollments` rows.

### ⚠️ Scalability flag — added 2026-06-16

No scale concern. Read-only, on-demand, one student at a time; the
`previous_archive_id` walk is bounded by years enrolled (single digits).
The only heavy step is PDF generation — render server-side and stream the
response, don't buffer many at once. Safe to ship as designed.

---

## Year-end accounting close wizard (AC-9 from the 2026-06 accountant-portal audit)

**Status:** Not built yet — planned. No code exists. Recorded here so the
shape carries over between the accountant audit and the follow-up PR.

### What the feature does

A wizard for the accountant that runs at fiscal year-end, parallel to
[YearTransitionModal.tsx](frontend/src/pages/admin/YearTransitionModal.tsx)
(the student-side wizard the admin already has). It bundles the
operational steps a school has to perform at the boundary and offers
sensible defaults instead of leaving them as silent manual chores.

| Step | What the wizard does |
|---|---|
| Close prior year | Recommend closing the last open `accounting_periods` row whose `period_end` is in the prior fiscal year. Uses `assertPeriodOpen` for safety. |
| Deactivate old plans | List `fee_plans` with `academic_year` matching the prior year, propose flipping `is_active=false`. Voiding is NOT the right answer here — voiding deletes data; deactivation just hides plans from new student enrolments. |
| Clone plans into new year | For each tuition-kind plan, mint a copy with the new `academic_year`, same currency / total / fee_kind / late-fee config; shift each `fee_installments.due_date` forward by 12 months (or by months matching the new year boundary). New plans default `is_active=true`. |
| Carry FX rates | Optional — duplicate the most recent `fx_rates` entries with `effective_from` set to the first day of the new fiscal year so cross-currency math doesn't go dark. |
| Recurring expenses | Surface every `expense_recurring_templates.next_due_date` that's still pointing into the prior year. The cron will keep firing on the old schedule — this is informational so the accountant decides whether to bump them forward. |

### Why now

Right now there's zero coordination between the student-side wizard and
the accounting side. The student wizard advances `schools.current_academic_year`
and reassigns classes; the accountant has to remember to:

1. Close the prior year's final accounting period
2. Deactivate prior fee_plans by hand
3. Recreate each plan for the new year (manually)
4. Update FX rates

Forget any one of these and you get silent inconsistencies: a parent
gets billed against last year's plan, late fees apply against an
old installment, the trial balance straddles two years.

### What it needs

**Backend** — premium-gated (`tuition_fees`):
- `GET /accounting/year-end/preview` — returns the proposed plan: list of periods to close, plans to deactivate, plans to clone (with proposed new dates), FX rates to carry, recurring expenses still on the old next_due_date. Pure read; no side effects.
- `POST /accounting/year-end/commit` — executes the chosen subset of actions. Per-step `skip`/`include` flags so the accountant can opt in/out. Wraps the writes in an `accounting_audit` log entry (entity_type='year_end_close', action='create') so the operation is traceable.
- Both endpoints in [accounting.controller.ts](backend/src/controllers/accounting.controller.ts) or a new `yearEndClose.controller.ts`. Uses the existing [glPosting.ts](backend/src/utils/glPosting.ts) helpers for nothing — this is a config + plan-management operation, not a GL post.
- Audit on commit (new `audit_logs.entity_type` value would need a CHECK update, similar to PR 1's `'report'` addition).

**Frontend** — new accountant wizard:
- `frontend/src/pages/admin/YearEndCloseModal.tsx` — multi-step component mirroring `YearTransitionModal.tsx`'s shape (Preview → Pick actions → Confirm → Done).
- Entry point: a "Year-end close" button on the accountant dashboard. Optional — and ideal — the student-side wizard's "Done" step also surfaces a "Now run the accountant year-end close" CTA if `tuition_fees` is on.

**i18n** — new `accountant.year_end.*` namespace, en/ar/ku web (no mobile surface — accountant is desktop-only by AC-12).

### Why "informational" in the audit and not a defensive fix

No data corruption happens if this never ships — books just stay tedious
to keep clean. The student-side wizard already runs without it. Saving
this for a deliberate UX pass keeps the defensive PRs (PR A + PR B) tight.

### Notes for whoever picks this up

- Don't void old plans — voiding triggers the cleanup cron (now safer per migration 043 but still meant for "this plan was a mistake"). Deactivate via `is_active=false`.
- The new fee_installments dates need explicit re-billing — cloning a plan creates the schedule but no `student_fees` rows. The wizard should call the existing batch-assign endpoint (or surface a CTA pointing the accountant to it) so the new plan actually reaches students.
- Authoritative current academic year lives on `schools.current_academic_year` since migration 042. Read it via `resolveCurrentAcademicYear`.
- The accountant could legitimately run the wizard MID-year as a "close FY 2025 retroactively" action — don't gate strictly on a date window. Gate on "any open prior-year period exists" or similar state-based check.

### ⚠️ Scalability flag — added 2026-06-16

No scale concern. Runs at most once per school per fiscal year against a
single school's `fee_plans` / `fee_installments`. The watch-item is
correctness, not load: cloning a plan builds the schedule but no
`student_fees` rows — the actual volume lives in the re-billing batch
(noted above), which already exists and is sized.

---

## Browser-side backup restore in the master portal

**Status:** Not built yet — planned. The CLI script
[`scripts/restore-storage.ps1`](scripts/restore-storage.ps1) covers the
restore-drill UX today; this is the friendlier follow-up for actual
recoveries.

### What the feature does

The operator opens the master portal, navigates to a "Restore from
backup" page, picks a `.tar.age` (storage bucket) or `.pg.age`
(postgres dump) file from disk, picks their `key.txt` private key from
disk, and the browser:

1. Decrypts the file entirely in-tab using a WASM `age` implementation.
   The private key never travels over the network. Master portal sees
   nothing.
2. For storage tarballs: parses `tar` in JS, displays the entry list,
   lets the operator confirm.
3. For drill mode: stops here. No upload, no destructive action. Just
   "decryption succeeded, here are the contents."
4. For real restore: POSTs the decrypted bytes to a master-portal
   endpoint that writes them to Supabase Storage (or a target bucket
   the operator picks). The decrypted data only crosses the wire over
   TLS, and only when the operator clicks "Restore."

### Why "browser-side" is non-negotiable

The whole reason the current backup setup is "bullet proof" is that the
age private key never touches any server — it lives only on the
operator's laptop, plus an offline backup. Backblaze can't read your
backups. Supabase can't read your backups. GitHub Actions can't read
your backups. Only the laptop with the key can.

If the master portal could decrypt server-side, the private key would
have to live on the master server. A master-portal compromise would
then expose every backup ever. The cross-provider isolation that makes
the promise "we cannot leak your data even if our cloud provider is
breached" disappears.

Browser-side decryption preserves the model: the key file is selected
via a file input, lives in the browser tab's memory for the duration
of the decrypt, and is discarded when the tab closes. Nothing ever
sends it.

### What it needs

**Master portal (web client) — new restore page:**
- `apps/master-web/src/pages/restore/RestoreBackupPage.tsx` — drag-drop
  for the `.tar.age` / `.pg.age` file, file input for `key.txt`. Two
  modes: drill (decrypt + list) and restore (decrypt + upload).
- WASM age library: `age-encryption.js` from FiloSottile (the official
  port) or `@vlcn.io/age`. Single dependency, ~200KB.
- `tar` parsing in JS: `js-untar` or `tar-stream` (works in browser
  with a polyfill). Or a minimal hand-rolled USTAR parser if those
  pull in too much.
- For real restore: POST the decrypted blob to a new endpoint on
  `apps/api`, which streams it into Supabase Storage. Uploads chunked
  by entry rather than as one giant blob.

**Master portal (api) — new endpoints:**
- `POST /api/restore/storage/:bucket` — accepts a multipart upload of
  files extracted client-side. Writes each into the target Supabase
  Storage bucket via the existing `scholifyDb` client. Audited.
- `POST /api/restore/postgres` — out of scope for v1. Postgres
  restores still go through the CLI, since they involve `pg_restore`
  against a target connection string. Browser can't execute that.

**Auth gate:**
- Operator-scoped, MFA required at the start of the session.
- Audit every restore action to `operator_audit_log` with the source
  B2 key (when the operator pastes one in) and the destination bucket.

### Open questions to settle before building

- **Large files.** Browser memory holds the decrypted blob during
  parsing. Storage tarballs in the typical small-school range (50MB–
  500MB) are fine. Worth measuring against a real production tarball
  before committing to one giant blob vs streamed parse.
- **`tar` parsing for empty entries.** `aws s3 sync` puts trailing
  slash markers on empty directories on some configs. The parser
  should skip them, not treat them as files to restore.
- **What gets surfaced for drill vs restore?** Suggestion: drill
  always shows entry count + tree preview + a "looks right?" prompt.
  Restore requires typing the bucket name (matching the
  existing-account-deletion confirmation pattern) before the upload
  fires.

### Notes for whoever picks this up

- This is the "make the bullet-proof promise easier to keep" feature.
  Without it, drills are doable but tedious; operators skip them and
  the backup quietly rots.
- The CLI script [`scripts/restore-storage.ps1`](scripts/restore-storage.ps1)
  already does everything the API endpoint will do, in PowerShell.
  The browser implementation is essentially a port of that script's
  flow with the decryption shifted from `age` CLI to `age-encryption.js`
  and the `aws s3 sync` replaced by per-file PUTs.
- Do not add a "remember my private key" toggle. The point of the
  feature is that the key is short-lived in browser memory; persisting
  it would re-introduce the problem we're avoiding.

### ⚠️ Scalability flag — added 2026-06-16 — the one real ceiling

**This is the only shelved feature with a hard architectural scale
limit.** The browser holds the *entire* decrypted blob in tab memory
during parse — the "key never leaves the laptop" guarantee forbids
server-side decrypt, so there's no offloading it. Fine for 50–500MB
tarballs; a large production `.tar.age` will OOM the tab if handled as
one blob. Before building the real-restore path: measure against the
largest live tarball, and if it's anywhere near the ceiling, build a
**streamed parse + per-file chunked upload from day one** rather than the
single-blob shortcut. Drill mode (decrypt + list, no upload) is lower
risk — ship it first. Don't let "works on my 80MB test file" stand in for
production size.

---

## Student & teacher performance metrics

**Status:** Foundation shipped in **migration 049** (2026-06-12).
Writers, dashboards, and the nightly rollup job are paused until the
WhatsApp-OTP work ships. No UI changes landed — pure DB scaffolding
designed to be invisible until the feature build resumes.

### What the feature does (when finished)

Role-specific dashboards that combine engagement, outcome, and presence
signals into one student-performance picture, plus a teacher-performance
view for HR.

| Audience | Question they're trying to answer |
|---|---|
| Parent | Is my child keeping up? |
| Teacher | Which of my students aren't doing homework? Where is the class trending? |
| Supervisor | Which classes have low engagement or falling outcomes? |
| Admin (+ HR when added) | School-level engagement/outcome trends + teacher performance |

The interesting metric that combining these unlocks is the **engagement
× outcome correlation**: "students with >80% completion average X
grade; students with <60% average Y". That signal is invisible from any
single source today.

### Why shelved

WhatsApp-OTP work is the active priority. The metrics feature needs a
month of UI build + dashboards across web and mobile across four roles,
which is too much to interleave. Better to land the foundation now (so
nothing decays) and pick the feature up cleanly later.

### What migration 049 ships (the foundation)

The pieces that would be expensive to add later against populated tables:

| Change | Why now (instead of with the feature) |
|---|---|
| `schools.grade_scale_max NUMERIC DEFAULT 100` | School-wide raw-to-percentage normalisation factor. Most KRG schools use /100; schools using /20 should set this via the future admin UI before historical grades accumulate. |
| `grades.grade_scale_snapshot NUMERIC` + BEFORE INSERT trigger | Per-row snapshot of the school's scale at write time. Mid-year scale changes can't corrupt historical interpretation. App code is unaware — trigger populates automatically. |
| `reports.year_month` generated STORED column + lookup indexes | Bucket column for the future UPSERT pattern. UNIQUE constraint is **NOT** yet enforced — it would break current multi-report teacher workflow without the UPSERT UX. |
| `report_behavior_tags` per-school dictionary (empty) + `reports.behavior_tag_codes TEXT[]` | School-managed behaviour vocabulary with polarity (positive/neutral/negative). Drives metrics without sentiment analysis. |
| `homework_submissions` table (empty) | Per-student per-homework completion. v1 actor: teacher only. v2 columns (`verified_at`, `verified_by_user_id`, `attachment_url`) included so parent-uploads-proof needs zero schema work later. CHECK constraint allows all v1+v2 status values. |
| `assignment_completions` table (empty) | Mirrors `homework_submissions`. The existing `assignments.submission_status` column is **kept** — live readers still resolve it. Becomes ignorable when the feature switches readers to this table. |
| `idx_weekly_summaries_teacher_week`, `idx_homework_teacher_created`, `idx_assignments_teacher_created`, `idx_grades_teacher_created` | Supporting indexes for the future teacher-performance rollup queries. Cheap to build now on small tables. |

What 049 deliberately does NOT do:

- No `UNIQUE(school_id, student_id, subject, year_month)` on reports
  (ships with the UPSERT UI).
- No drop of `assignments.submission_status` (live readers still
  resolve it).
- No `student_monthly_metrics` / `teacher_monthly_metrics` materialised
  tables (empty tables serve no purpose until writers exist).
- No `audit_logs.entity_type` CHECK extension (ships with the
  controllers that actually emit the new types).
- No application code changes.

### Locked design decisions (do not re-litigate)

**Actor for completion (v1):** teacher only marks completion. Parents
do not. v2 expands to "parent uploads proof → teacher verifies" without
further schema work — `homework_submissions.status` CHECK already
allows `submitted_by_parent` and `verified_by_teacher`.

**Model:** unified completion tables (`homework_submissions` +
`assignment_completions`), not polymorphic. `assignments.submission_status`
becomes a dead column once the feature ships — kept for backward
compatibility with live readers, not dropped.

**Grade scale:** school-wide single max per school, snapshotted per
grade row at write time. No cross-school benchmarking planned, so per
school suffices. The snapshot column protects against mid-year scale
changes.

**Reports cadence:** enforce one report per (student, subject, month)
via UPSERT when the feature ships. Foundation prepares the bucket
column + index; the UNIQUE constraint ships with the UPSERT UI so
teachers don't hit cryptic errors before the new UX exists.

**Behaviour tags:** hybrid model. Free-text `behavior_notes` stays as
the qualitative record; structured `behavior_tag_codes` (from per-school
dictionary) drives the metrics. Polarity field on tags supplies the
positive/neutral/negative bucketing. Tags are **optional**, not
required — forcing them produces low-quality data.

**Monthly summary strategy:** materialised tables
`student_monthly_metrics` and `teacher_monthly_metrics`, written by a
nightly job. Dashboard reads are single-row or simple aggregations.

**Teacher performance metric split:**

- **Bucket A — documentation** (controlled by teacher): weekly summary
  posting rate, report posting rate, grade entry timeliness,
  behaviour-note fill rate. Valid for performance review.
- **Bucket B — outcomes** (depend on student population): show as
  **trends** over time, never absolute side-by-side comparisons.
  Class-level completion / grades / attendance averages live here.

**Access control:**

| Role | Sees student metrics | Sees teacher performance metrics |
|---|---|---|
| Parent | their own child only | ❌ never |
| Teacher | students they teach | their **own** metrics only |
| Supervisor | classes they supervise | ❌ **explicitly excluded** |
| Admin | all | ✅ all |
| HR (when added) | all | ✅ all |

When the future endpoint lands, the role gate is `role === 'admin'`.
If an explicit `hr` role is added to `users.role`, extend the gate to
`['admin', 'hr']`.

> **⚠️ Migration-number note (added 2026-06-16).** This plan originally
> reused migration numbers **050 / 051 / 052**, which were later consumed
> by the phone-OTP / login-MFA work and run against Supabase
> (`050_phone_otp`, `051_contact_change_stepup`, `052_mfa_login_factors`,
> `053_step_up_login_mfa_action`). The list below has been **renumbered to
> 054+** to match — do NOT recreate 050/051/052.

### What's left to build (in suggested order)

1. **Migration 054** — `student_monthly_metrics` + `teacher_monthly_metrics`. *(was 050 — renumbered, see note above)*
2. **Migration 055** — `audit_logs.entity_type` CHECK extension
   (`homework_submission`, `assignment_completion`, `report_behavior_tag`,
   `student_monthly_metrics`, `teacher_monthly_metrics`).
3. **Backend writers** — `PATCH /teacher/homework/:id/students/:studentId/complete`
   + assignment equivalent + admin CRUD for `report_behavior_tags`.
4. **Frontend writer UI** — checkboxes per student on `WriteHomeworkPage`
   + `WriteAssignmentsPage` + mobile equivalents.
5. **Migration 056** — add `UNIQUE(school_id, student_id, subject, year_month)`
   on `reports` after a dedupe pass. Pair with the UPSERT UX update.
6. **Backend rollup job** — nightly cron writing the materialised
   tables. Backfill the past 2-3 months from existing `grades`,
   `reports`, `attendance`. Completion data starts only from the
   moment the writer UI ships.
7. **Backend readers** —
   - `GET /metrics/student/:id?from=&to=`
   - `GET /metrics/class/:id?...`
   - `GET /metrics/school?...`
   - `GET /metrics/teacher/:id?from=&to=` *(admin/HR only)*
8. **Frontend dashboards** per role.
9. **Behaviour-tag admin settings page** for managing the per-school
   dictionary.
10. **i18n** — reserve namespaces `homework.completion.*`,
    `assignment.completion.*`, `metrics.*`, `behavior_tags.*` across
    en/ar/ku.

### Open questions to resolve before code lands

- **Per-student fan-out on write** — when a teacher posts homework to
  a 30-student class, eager-create 30 `pending` rows or lazy-create on
  first mark? **Lean eager.** Reads dominate; 30 rows per homework is
  trivial storage; `% completion` becomes a simple aggregation.
- **Class-wide vs individual assignments** — `assignments.student_id`
  is nullable for class-wide. Same eager-vs-lazy question.
- **Reports dedupe before UNIQUE** — run `SELECT student_id, subject,
  year_month, COUNT(*) FROM reports GROUP BY 1,2,3 HAVING COUNT(*) > 1`
  before adding the constraint. Decide keep-newest vs merge.
- **Subject weighting in `grades_overall_avg`** — currently all
  subjects weight equally. Schools may want religion/PE deweighted vs
  math/science. Decide whether weighting lives in the rollup job, on
  the school config, or in the dashboard layer.
- **Computation version bumps** — when the rollup formula changes,
  recomputing past months is the right move. Plan for a one-shot
  re-run script.
- **Storage bucket for v2 parent-upload proof** — reuse the
  `chat-attachments` pattern (per-row ownership table + orphan sweep,
  per migration 047). Don't roll a new pattern.
- **HR role** — does it stay as an admin sub-permission, or become its
  own role in the `users.role` enum? If the latter, all role gates in
  the controllers need a parallel update.

### Notes for whoever picks this up

- The data foundation is already there — every grade entered since
  2026-06-12 carries `grade_scale_snapshot`; every report has a
  `year_month` bucket. You can write the rollup job against real data
  the day you start.
- **Don't drop** `assignments.submission_status`. Switch readers to
  `assignment_completions` and let the column quietly die. Active
  readers today: mobile AssignmentDetailScreen (line ~24), parent
  AssignmentsPage (line ~17). Dropping it without those switchovers
  breaks both screens.
- **Don't add the UNIQUE constraint on reports** as part of foundation
  changes. The current schema lets teachers post multiple reports per
  (student, subject, month) and the feature build is what gives them
  the UPSERT UX that replaces the duplicate-post error path.
- **Behaviour-tag inflation is a real risk** — teachers may over-
  report positive tags if Bucket A includes "behaviour-note fill rate".
  Watch the positive/neutral/negative ratio when the feature ships;
  schools where all teachers report 95% positive are either in heaven
  or gaming the system.
- **"Expected" definition for documentation metrics** matters. Naive
  count breaks down when a student joins mid-month or a class is
  cancelled. Prorate by enrolment days. `weekly_summary_periods.is_open`
  gives the school-level "school was open this week" signal.
- The user asked for this scope on 2026-06-12 (this commit's session
  transcript covers the design conversation). Re-reading the
  conversation before re-starting is recommended — several edge cases
  (mid-year scale changes, behaviour-tag gaming, supervisor access
  exclusion, monthly cadence enforcement) were each settled with
  explicit user calls that aren't obvious from the schema alone.

### ⚠️ Scalability flag — added 2026-06-16

The architecture here is already the scalable one — precomputed
`*_monthly_metrics` tables that dashboards read single-row, plus the
supporting indexes shipped in 049. Two job-design choices to get right
when writers/rollup land (neither needs a schema change):

- **Make the nightly rollup incremental, never a full sweep.** It scales
  with total grades/reports/attendance across *all* schools — process
  only rows changed since the last run (a watermark on `updated_at` /
  `created_at`), not the whole history every night.
- **Mind the eager fan-out write volume.** One
  `homework_submissions` / `assignment_completions` row per student per
  assignment is trivial per-school but compounds platform-wide. It's
  bounded and accepted per the locked design — just don't be surprised by
  the row count when you query it.

---

## Phone OTP (WhatsApp via OTPIQ + email fallback)

**Status:** Stage B (phone verification) shipped in **migration 050**
(2026-06-13). **Stage A — login MFA by phone AND email — SHIPPED
2026-06-14** as a 3-phase build (migrations 052/053 + an
`mfa_login_factors` registry + a login method-chooser + settings
"use at sign-in" toggles; web + mobile). Stage C (forgot-password by
phone) is still scheduled on the same foundation. One deliberate
follow-up to Stage A is **shelved — see "Phase 2b" below.**

> **Role-policy update (supersedes the bullet below):** the original
> "phone OTP for parents + drivers only" decision was **superseded** —
> Stage A shipped for **all roles**, voluntary opt-in, with the guardrail
> that **email can't be a user's sole factor** (must pair with phone or
> TOTP). TOTP remains available to the staff/admin roles as before.

### Phase 2b (SHELVED 2026-06-14): account-level recovery codes for non-TOTP login factors

**What it is:** Stage A lets any role arm phone/email OTP as a login
second factor. The break-glass for a lost factor is recovery codes — but
those live in `user_mfa.recovery_codes_hash`, which is TOTP-only. So a
phone-only user (e.g. a parent who armed WhatsApp OTP and never set up
TOTP) who loses their phone has **no self-service recovery** — only an
admin can rescue them (via the admin-disable cascade, which IS shipped).

**Why shelved (not a blocker):** the admin-rescue path exists and is the
same escape hatch a TOTP user gets after losing both authenticator and
codes. Doing recovery codes *properly* for phone/email means moving them
out of the TOTP-shaped `user_mfa` row — otherwise minting codes for a
phone-only user makes `getMfaStatus()` wrongly report "MFA enrolled" and
corrupts the TOTP hub. That's its own migration + refactor and deserves
deliberate design rather than being bolted onto Stage A.

**What it needs (when picked up):**
1. An account-level recovery-code store (new `user_recovery_codes` table,
   or a column independent of `user_mfa.confirmed_at`).
2. Mint codes on **first factor armed, any channel** (today: only at TOTP
   setup) and surface them once in the enable flow.
3. A login-time recovery path in `verifyLoginSecondFactor`
   (`backend/src/utils/loginFactors.ts`) that accepts a recovery code for
   any method, without entangling TOTP's disabled state.
4. Fix `getMfaStatus` so a recovery-only row doesn't read as TOTP-enrolled.

**Where Stage A lives:** backend `utils/loginFactors.ts` +
`controllers/mfaFactors.controller.ts` + migrations 052/053; clients —
`LoginFactorToggle` (web `components/layout/`, mobile
`components/settings/`) + the login method-chooser in the auth screens.
Full plan + locked decisions: `memory/phone-email-otp-login-plan.md`.

### Why

Parents and drivers in the user base often (a) don't have an email,
(b) have an email but don't read it, or (c) read English well enough
to fail a forgot-password flow that depends on email. WhatsApp is
ubiquitous in Iraq — the OTP arrives in the same app they already
read all day. OTPIQ is the local provider (https://otpiq.com /
https://docs.otpiq.com) and the Iraqi market default.

### Locked design decisions (asked + answered before code)

- **Staging:** B (verify phone) → C (forgot-password by phone) →
  A (login MFA). Each stage is a separate PR; A and C reuse the
  same `phone_otp_codes` table.
- **Role policy for Stage A:** phone OTP is available as an MFA
  factor for **parents + drivers only**. Teachers, supervisors,
  reception, accountants, HR, and admin keep TOTP as the required
  factor — a stolen SIM should not unlock money-moving or data-purge
  roles. Phone verification (Stage B) is available to ALL roles —
  it's used by HR contact records + future forgot-password by phone.
- **Channel:** OTPIQ provider = `whatsapp` ONLY. We deliberately do
  NOT use OTPIQ's `whatsapp-sms` provider (which would let OTPIQ pay
  for SMS fallback at 80 IQD/msg). If WhatsApp delivery fails, our
  own Resend SMTP fires the same code via email. Email fallback is
  free, uses infrastructure we already own, and matches the user's
  preference. Users with no email on file get a hard "couldn't
  deliver" error and must request again.
- **Country:** Iraqi mobile only (`+964` followed by 10 digits,
  leading 7). `users_phone_e164_format` CHECK enforces it.
  Landlines (leading 1) and any other country code rejected at
  validation time. International support is a deliberate future
  call.
- **Code shape:** 6-digit numeric, sha256-hashed at rest, 5-minute
  TTL, max 5 verify attempts. Matches the posture of the existing
  TOTP recovery codes + email-change codes.

### What migration 050 ships (the foundation)

- `users.phone_e164` + `users.phone_verified_at` — canonical phone
  + verification timestamp on the users table. `users.phone`
  (existing display column) is preserved as legacy contact info;
  the OTP layer never reads it.
- CHECK `users_phone_e164_format` — `+964[0-9]{10}` regex.
- `phone_otp_codes` — one row per generated code. Channel lifecycle
  via per-channel timestamp columns (`whatsapp_sent_at`,
  `whatsapp_delivered_at`, `whatsapp_failed_at`,
  `email_fallback_sent_at`). `purpose` enum carries all three
  stages now (`verify_phone`, `forgot_password`, `login_mfa`) so
  Stage A/C don't need a CHECK alter.
- `phone_otp_delivery_events` — ops/debug landing pad for OTPIQ
  delivery webhooks. Append-only. Auth decisions never read from
  it — the orchestrator updates `phone_otp_codes` directly.
- RLS: `tenant_isolation` + ENABLE + FORCE on both new tables.
  `phone_otp_delivery_events` policy permits `school_id IS NULL`
  for the moment between webhook landing and school_id back-fill.

### Admin-trusted phone propagation

When an admin creates or updates a parent / teacher / driver and
provides a phone number, the role-table `phone_number` write is
followed by a best-effort mirror onto `users.phone_e164` with
`users.phone_verified_at` stamped. This matches how
`users.email` works today — admin sets it, the system trusts it,
the user gets OTPs at that number from day one without re-entering
or verifying.

The mirror lives in `backend/src/utils/adminPhonePropagation.ts`
and is wired into:
  - `createStudent` (new-parent path)
  - `bulkUploadStudents` (the parent batch)
  - `createTeacher` / `updateTeacher`
  - `createDriver` / `updateDriver`
  - `createAccount` (unified parent/teacher/driver create endpoint)

Normalization rules (also in `phoneE164.ts`):
  - `0750…` / `+9647…` / `00964…` / spaced / parenthesised → all
    converge to `+9647xxxxxxxxx`.
  - Non-IQ or malformed input → `users.phone_e164` stays NULL,
    `users.phone_verified_at` stays NULL. The role-table column
    keeps the original text (it's contact info), but the OTP layer
    refuses to send to a number it can't validate.
  - Admin clears the field → both `phone_e164` and `phone_verified_at`
    are cleared.

If an admin update has `phoneNumber === undefined` in the request
body (the field wasn't touched at all), we don't touch
`users.phone_e164` either — only an explicit value (string, '', or
null) causes a propagation.

**Cost of this design** (explicitly accepted): admin typos route
OTPs to whoever holds the typo'd number. Mitigation: normalisation
catches "wrong country code" / "missing digit" / "leading zero"
errors, and Stage A (login MFA) is parents/drivers only — admin /
accountant / HR roles keep TOTP regardless of what's on
`users.phone_e164`.

### Backend (Stage B + reusable by Stage A/C)

- `backend/src/utils/otpiq.ts` — typed HTTP client (`sendVerification`,
  `trackSms`, `getProjectInfo`) with structured `OtpiqError`
  (`isAuthError` / `isCreditError` / `isRateLimitError` /
  `isValidationError` / `isTransientError` / `isTrialModeError`).
  Native `fetch`, 15s timeout, per-request webhook config.
- `backend/src/utils/phoneE164.ts` — normalise local 07…, 7…,
  00964…, +964…, spaced/parenthesised inputs to canonical
  `+9647xxxxxxxxx`. `parseIraqiPhone()` returns a tagged
  `PhoneParseResult` so callers can render specific error messages.
  `maskPhone()` is used in logs.
- `backend/src/utils/phoneOtp.ts` — `sendPhoneOtp()` generates a
  code, hashes it, inserts the row, queues WhatsApp via OTPIQ, and
  on synchronous OTPIQ failure fires immediate email fallback (if
  the user has an email on file). `processDeliveryEvent()` is
  called from the webhook controller: on async `failed`/`expired`
  delivery state, fires an email that tells the user the WhatsApp
  send failed and they should re-request (we deliberately do NOT
  email the code itself in fallback, because at webhook time the
  cleartext is gone — it was hashed at send). `verifyPhoneOtp()`
  is the constant-time check with attempts cap + consume-on-match.
- `backend/src/controllers/phoneOtp.controller.ts` — Stage B
  endpoints + webhook:
  - `POST /me/phone/send-verify-otp` — auth-gated, normalises
    phone, stamps `users.phone_e164` (clears `phone_verified_at`
    if changed), calls `sendPhoneOtp` with `purpose='verify_phone'`.
  - `POST /me/phone/confirm-verify-otp` — auth-gated,
    `verifyPhoneOtp` + stamps `users.phone_verified_at` on success.
  - `POST /public/otpiq-webhook` — public, HMAC-verifies the raw
    body against `OTPIQ_WEBHOOK_SECRET`, inserts into
    `phone_otp_delivery_events`, calls `processDeliveryEvent`.
- `backend/src/server.ts` — `express.json({ verify })` captures the
  raw OTPIQ webhook body onto `req.rawBody` so signature
  verification works against the exact bytes OTPIQ signed.
- Rate limits at the route layer (express-rate-limit, keyed on
  user id, with IP fallback):
  - `POST /me/phone/send-verify-otp`: 3 / 5min/user + 10 / 1h/user
  - `POST /me/phone/confirm-verify-otp`: 30 / 15min/user
  - `POST /public/otpiq-webhook`: 200/min/IP (modest, deflects
    misaddressed flood without dropping legitimate OTPIQ traffic)
- `/auth/me` now also returns `phoneE164` + `phoneVerifiedAt`.

### Frontend + mobile (Stage B)

- **Web** — `frontend/src/components/layout/AccountSettingsModal.tsx`
  grew a "Phone number" section between Email and MFA. Same flow as
  the email section: enter phone → send code → enter 6-digit code →
  verified. Pre-login language switcher already ships on
  `/login` + `/forgot-password`, so non-English-reading users
  arriving at this screen are not stranded.
- **Mobile** — `mobile/src/screens/common/PhoneSettingsScreen.tsx`
  (new) registered in `mobile/src/navigation/index.tsx` for all 4
  role branches. Each role's settings screen got a "Phone number"
  row (parent / driver / teacher / supervisor) with a green/amber
  status chip.
- Both surfaces use the same `phoneOtpApi.sendVerify` +
  `confirmVerify` shape and read `user.phoneE164` +
  `user.phoneVerifiedAt` from the auth store.

### Environment (`backend/.env.example`)

```
OTPIQ_API_KEY=             # sk_dev_… in dev (test phone), sk_live_… in prod
OTPIQ_BASE_URL=https://api.otpiq.com/api
OTPIQ_PROVIDER=whatsapp    # do NOT change to whatsapp-sms (we want our SMTP fallback)
OTPIQ_WEBHOOK_SECRET=      # 32 random bytes b64; paste same value into OTPIQ dashboard
OTPIQ_WEBHOOK_URL=         # public URL OTPIQ POSTs delivery events to (Railway or ngrok)
```

### What's deferred to Stage C and Stage A

- **Stage C — forgot-password by phone:** new public endpoint
  `POST /auth/forgot-password-phone { username, phone }` that
  looks up the user by username, checks `users.phone_e164`
  matches, calls `sendPhoneOtp({ purpose: 'forgot_password' })`.
  Then `POST /auth/reset-with-phone-otp { token, code, newPassword }`
  to apply. UI on login screen "Forgot via phone instead?".
- **Stage A — login MFA by phone (parents/drivers only):** at
  enrollment, the user picks "WhatsApp" instead of (or in addition
  to) TOTP. Login response carries an `mfaTicket` as today; a new
  `POST /auth/login/verify-mfa-phone` exchanges the ticket + a
  phone OTP for tokens. Eligibility gated server-side by role.
- Neither stage needs a new migration. Everything they require is
  already in `phone_otp_codes` (purpose enum + indexes).

### Gotchas captured for future-you

- OTPIQ phone format is **no leading `+`** (`9647…`, not `+9647…`).
  `toOtpiqFormat()` strips it; never hand-build the request body.
- OTPIQ webhook signature: `sha256=` prefix is sometimes present
  (and sometimes not depending on header used); the controller
  strips it. Webhook body is JSON but we verify against the raw
  bytes — never re-serialise before HMAC.
- Email fallback at webhook time CANNOT email the original code:
  we hashed it at send and don't keep cleartext. The fallback
  email is "we couldn't deliver, please request a new code." This
  is a deliberate trade-off — emailing the cleartext code would
  require keeping it in memory longer or storing it reversibly.
- `users.phone` (existing TEXT column) is **NOT** the auth-grade
  field. The OTP layer reads `users.phone_e164`. Future writers
  who touch user profiles must keep these two columns conceptually
  separate — `phone` is display contact info, `phone_e164` is
  verified canonical.
- The Laravel client at https://github.com/Rstacode/otpiq is the
  closest thing OTPIQ has to a written contract — refer to it
  before assuming any undocumented behaviour.
- Dev keys (`sk_dev_…`) route ALL sends to a single configured
  development phone regardless of `phoneNumber` in the payload.
  Use them in e2e + local dev so we never spam real numbers.

### ⚠️ Scalability flag — added 2026-06-16

Not a throughput problem — a **cost curve**, and it's live now (Stage A
shipped). Every login by an armed user fires a paid WhatsApp OTP via
OTPIQ; trusted-device caching + voluntary opt-in bound it, but the bill
tracks adoption, not infra load. Watch it as uptake grows — the levers
are a longer trusted-device TTL and nudging users toward TOTP (free)
where the role allows. Stage C (forgot-password) adds only one-per-reset
bursts (negligible). The existing rate limits cap abuse, not legitimate
cost.


