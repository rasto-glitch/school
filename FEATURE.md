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

