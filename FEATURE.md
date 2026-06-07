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
