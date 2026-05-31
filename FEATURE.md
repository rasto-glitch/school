# Shelved features

Things that are built (or partially built) in this repo but intentionally
hidden from the UI until a follow-up phase ships. The code is left in place
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
