# School Management System

Multi-tenant school management monorepo. Six workspaces share one Supabase database.

## Workspaces

| Folder | What it is | Where it runs |
| --- | --- | --- |
| `frontend/` | Main web app (parent, teacher, admin, driver, supervisor, reception) — Vite + React 19 | Deployed on **Vercel** |
| `backend/` | Express 5 + Socket.io API | Deployed on **Railway** with **root directory = `backend`**. Entry is `dist/server.js` (relative to `backend/`, because root_dir rebases the build container at `backend/`). Build config: `railway.json` at the repo root + `backend/nixpacks.toml` — the nixpacks file **must** live inside `backend/` or Railway's root_dir filter skips it. `npm ci` runs under `NODE_ENV=production`, so devDeps (including `typescript`) are stripped unless the install step passes `--include=dev`. |
| `mobile/` | Expo / React Native app | Shipped via **EAS** — OTA channel `preview` |
| `master/` | Superadmin portal (`client/` + `server/`) for managing schools | **Local only. Bound to `127.0.0.1`, never deployed.** Security-sensitive — do not add deploy targets. |
| `academic/` | Academic content portal (`client/` only) — rich-text posts & ebooks | Local for now; will go online later. Gated by `school.features.academic_portal`. |
| `database/` | Supabase SQL schema (`schema.sql`) | Source of truth for DB changes |

Frontend and backend do not run locally day-to-day. When the user says "the backend" they mean the Railway deployment unless they specify otherwise.

## Deploy & change workflow

After any change, state what the user needs to do:

- **`frontend/`** → push to main, Vercel auto-deploys
- **`backend/`** → push to main, Railway auto-deploys
- **`mobile/` JS-only changes** → OTA: `cd mobile && eas update --channel preview --message "<what changed>"`
- **`mobile/` native changes** (native deps, permissions, config plugins, `app.json` native fields) → full EAS build, not OTA
- **`database/schema.sql` changes** → user runs the SQL against Supabase manually
- **`master/`** → local only, no deploy step

Mobile runtime version policy is `appVersion` — OTA only applies to matching app versions; native changes bump app version and require a full build.

Always commit and push after edits unless told otherwise.

## Architecture invariants

Non-obvious rules that have caused real bugs. Breaking any of them silently corrupts data, leaks tenants, or locks users out.

### 1. `school_id` multi-tenancy — manual, no RLS

Every table is scoped by `school_id`. Every backend query must filter by `schoolId` from `req.user!.schoolId`:

```ts
.eq('school_id', schoolId)
```

**There are no Supabase RLS policies on any table.** The backend uses the service role key, which bypasses RLS entirely. Multi-tenancy is enforced purely by developer discipline in each controller — there is no middleware or query builder that adds the filter automatically. Forgetting it leaks data across schools.

### 2. Auth: custom JWT with `features_version` gating

- JWTs are issued by `backend/src/controllers/auth.controller.ts` — **not** Supabase Auth.
- Two middleware layers in `backend/src/middleware/auth.ts`:
  1. `authenticate()` — validates token, checks account + school are `is_active`, compares `password_changed_at` to the token's stamp, compares `features_version` to the current `schools` row.
  2. `authorize(...roles)` — enforces role.
- **`features_version` auto-increments via DB trigger whenever `schools.features` changes.** If an admin toggles any feature flag, every client with a stale token is forced to re-login on their next request ("School settings updated. Please log in again."). This is intentional — treat unexpected 401s on the client as a feature-flag change, not a bug.

### 3. Username format: `<schoolAbbreviation>_<name>`

Login parses the school abbreviation from the username prefix before the first underscore. `fisk_karzanahmed` → school `fisk`, username `karzanahmed`.

- A username without `_` returns "Invalid credentials" with no further explanation.
- The master portal auto-prepends the abbreviation when creating admin accounts.
- Never create users in code without this prefix — login will silently reject them.

### 4. Grades & reports: `marks[]` is the source of truth, legacy columns are stale

Both `grades` and `reports` have two parallel shapes:

- **Legacy columns:** `daily_grade`, `quiz_grade`, `monthly_exam_grade`, `term_exam_grade` on `grades`; `quiz_marks`, `exam_marks` on `reports`.
- **Dynamic `marks JSONB`:** `[{ name, value }]` populated from admin-defined `mark_types` rows (`applies_to` ∈ `'report' | 'grade' | 'both'`).

Current writes (`teacher.controller.ts` `upsertGrade` / `createReport`) populate only `marks[]`. Legacy columns stay at 0 / null.

**Rule for every reader (web, mobile, any future PDF or report generator):**
1. Read `marks[]` first; use it if non-empty.
2. Fall back to legacy columns only for old records predating the migration.
3. Never hardcode mark names like `"Quiz"` or `"Daily"` — column headers come from whatever `mark_types` the school configured. Preserve insertion order when collecting names across records.

Web `frontend/src/pages/parent/GradesPage.tsx` has the reference `getMarkNames` / `getMarkValue` / `gradeTotal` helpers. Mirror that pattern.

### 5. Supabase is Postgres + storage only

- Service role key is server-side only (`backend/` and `master/server/`). Never ship it to any client.
- Frontend, mobile, and academic never call Supabase directly — they all go through the backend API.
- Storage bucket: `homework-attachments` — reused for homework, assignments, schedule images, and academic posts.

## API conventions

- **Controllers** live in `backend/src/controllers/` — one per role: `admin`, `teacher`, `parent`, `driver`, `supervisor`, `reception`, plus `chat` and `academic`. `auth` is separate.
- **Response transform:** all DB columns are camelCased by `toCC()` in `backend/src/utils/transform.ts` before returning. Type definitions in `frontend/src/types/index.ts` and `mobile/src/types/index.ts` must match the camelCase shape.
- **Error shape:** `{ error: string }` with an appropriate HTTP status. No structured error codes.
- **Validation:** each controller parses and validates inline. `joi` is in `package.json` but unused (dead import) — don't assume central validators exist.
- **Rate limiting** is hardcoded in `backend/src/server.ts`: 15 login attempts / 15 min, 5 password resets / 15 min, 200 general calls / min. Not env-configurable.
- **Tests: none, anywhere.** No jest/vitest/playwright in any package. Don't look for a test runner — write changes carefully and verify by running the affected surface.

## Realtime (Socket.io)

Clients connect with the JWT in `handshake.auth`. Auto-joined rooms:

- `school:${schoolId}:user:${userId}` — personal notifications
- `school:${schoolId}:admins` — for admins and reception (appointment alerts)

Explicit rooms:

- `school:${schoolId}:driver:${driverId}` — parents call `watchDriver(driverId)` to follow a bus. UUIDs are regex-validated on the server to prevent room-spam.

What's realtime vs REST:

- **Realtime:** driver location pushes, bus proximity alerts, in-app notifications, chat **typing** indicators.
- **REST only:** chat messages themselves (send/edit/delete — clients refetch after POST), grades, reports, homework, everything else.

**Proximity dedup is in-memory.** The `proximityState` Map in `driver.controller.ts` tracks which thresholds (10 min / 5 min / 2 min / arriving) have been sent per student per driver. Restarting the backend loses this state, so duplicate alerts may re-fire on the next location push after a restart.

### Bus GPS specifics

Driver posts location every 30s to `POST /api/driver/location`. Backend computes Haversine distance to each assigned student's home coordinates and emits proximity alerts at the thresholds above. Parents with no `latitude`/`longitude` set get only a "drive started" notification — proximity tracking is opt-in.

## Web frontend conventions

- **Role routing:** `ProtectedRoute` in `App.tsx` wraps each role's subtree and checks `allowedRoles`. Adding a page means adding a route and registering it under the right role.
- **Zustand stores:** `authStore` uses a custom `conditionalStorage` adapter (localStorage if `rememberMe`, else sessionStorage — reads from both, writes to one). Also `socketStore` and `notificationStore` (separate badge counters per content type).
- **Forms:** `react-hook-form` + `zod`. Shared primitives in `frontend/src/components/common/`.
- **i18n:** three languages — `en`, `ar`, `ku` — in `frontend/src/i18n/locales/`. Persisted as `app-language` in localStorage. **Add every new UI string to all three files.**
- **Axios 401 handler** auto-logs out unless the request URL contains `/auth/login` (so a failed login doesn't trigger a logout loop).

## Mobile specifics

- **OTA channel:** `preview`. Runtime version policy: `appVersion` (OTA only applies to matching app versions).
- **Types are duplicated** with web at `mobile/src/types/index.ts`. They have drifted — e.g., mobile's `Role` is missing `reception`. When adding a new role or field, update **both** `frontend/src/types/index.ts` and `mobile/src/types/index.ts`. There is no shared package.
- **Background location** (driver tracking) needs the foreground service permission on Android and `UIBackgroundModes: location` on iOS — configured in `app.json`. Any change to location or notification config forces a full rebuild.
- **Push notifications** go through Expo push (`https://exp.host/--/api/v2/push/send`). Device tokens live in `device_tokens` (unique on `(user_id, token)`).
- **Same API base URL as web:** `EXPO_PUBLIC_API_URL` points at the Railway deployment.

## Master portal

- **Purpose:** create/edit/delete schools, seed the first admin per school, reset admin passwords, toggle `is_active`, edit feature flags.
- **Why local-only:** auth is a single shared `MASTER_SECRET` (not per-user JWT). The server binds to `127.0.0.1:5002` and CORS whitelists only `localhost:5174`. Putting this online would make that shared secret a single point of compromise for every school in the database.
- **Admin creation:** auto-prepends the school abbreviation to the admin username if the operator didn't include it. Passwords are bcrypt-hashed and `password_changed_at` is stamped.
- **Feature toggles** cascade through `features_version` — toggling a feature for a school invalidates every active session for that school on the next request.

## Academic portal

- **Purpose:** rich-text posts (Tiptap editor with images/links/formatting) and ebook uploads. Parents/teachers/supervisors/admins read; teachers/admins write.
- **Gated by `school.features.academic_portal`** — backend rejects login for that portal if the flag is off.
- **Login passes `portal: 'academic'`** so the backend can discriminate. Same JWT, same API, same controllers (`academic.controller.ts`).
- **Tables:** `academic_posts` (`content_type` ∈ `'richtext' | 'plaintext' | 'file'`, `is_published`) and `ebooks`.

## Database gotchas

- **Soft-delete is inconsistent.** `users.is_active`, `students.is_graduated`, `messages.is_deleted` — no unified flag. Hard deletes cascade via FK.
- **Students are archived, not soft-deleted.** `archiveStudent()` copies the student into `archived_students` (snapshotting `classes_attended` and `grades` as JSONB), then deletes the original row. `archived_students` is not cascaded from `students`.
- **Announcements cut off at 60 days for parents only.** `parent.controller.ts` filters `created_at` within the last 60 days. Admin, teacher, and supervisor see everything.
- **Weekly summary submission is gated** by `weekly_summary_periods.is_open`. Teachers get a 403 if the supervisor has closed the period. Surface this in UI when adding weekly-summary screens.
- **Bus ride records cross-validate attendance.** `bus_ride_records` stores per-student per-day ride status with an exclusion reason (`school_absent` / `went_home_with_parents`) and a snapshot of school attendance for reconciliation.
- **Curriculum: class ↔ subject ↔ teacher.** `class_subject_teachers` is the source of truth (one row = "teacher T teaches subject S to class C"). `subject_teachers` (distinct teacher↔subject pairs), `teachers.subject` (comma-joined text) and `subjects.teacher_id` (primary teacher) are auto-synced caches recomputed from it by helpers in `admin.controller.ts` (`recomputeTeacherCaches` / `recomputeSubjectPrimary` / `recomputeCaches`); curriculum mutations and class/subject deletes call them. Edits live in the admin Classes tab's Curriculum modal (`addCurriculumRow` / `deleteCurriculumRow`); the Subjects/Teachers tabs show derived read-only summaries. `/teacher/profile-data` and `/academic/me` return `subject` (joined string fallback), `subjects: [{id,name}]`, and `teaching: [{classId, subjects:[{id,name}]}]`; with no curriculum rows yet they fall back to splitting `teachers.subject` so schools that haven't filled it in aren't blocked. Teacher content screens (homework/assignment/grade/report/weekly summary/academic post) filter the Subject picker by the chosen class; backend `subjectAllowedForClass` (in `utils/curriculum.ts`) lenient-validates the (subject, class) pair on create — only rejects when the teacher *has* curriculum rows for that class and the picked subject isn't among them.
- **Drivers have `vehicle_type`** (`bus` | `taxi`) and `excluded_student_ids UUID[]` for students they don't transport.
- **Accounting integrity columns.** `fee_payments` has `currency`, sequential `receipt_year + receipt_number` (per-school, per-calendar-year — formatted `RCP-YYYY-NNNNN`), `tax_amount + tax_label`, `payment_account_id`, plus `is_refund + refund_of_payment_id` (refunds are a separate row, not a void; original receipt stays valid). `expenses` and `staff_salary_payments` have matching `tax_*` and `payment_account_id` columns. Currency on `fee_payments` is the source of truth — readers must NOT fall back to `tuition_config.currency`. Fee plans carry a `kind` enum (`tuition|transport|lunch|uniform|exam|registration|other`) and `late_fee_*` config; late fees auto-apply nightly via `apply_late_fees()` pg_cron, materializing into `student_fee_late_fees` and contributing to `dueTotal` in every read path. Recurring expenses materialize the same way via `auto_record_recurring_expenses()`.
- **Period close blocks edits.** `accounting_periods` (one row per closed range, reopen sets `reopened_at`) is checked by `backend/src/utils/period.ts#assertPeriodOpen` before every create/update/void on `fee_payments`, `expenses`, `staff_salary_payments`. A 423 response with the offending range surfaces to the UI. Both old AND new dates are checked on edit, so payments can't be moved INTO a closed period either.
- **Payment accounts + FX rates.** `payment_accounts` (cash/bank/wallet/other) optionally tags every cash-touching row; balances are computed live by `accounting.controller.ts#listPaymentAccounts`. `fx_rates` (school-scoped, dated) powers the `/accounting/reports/rollup` endpoint and any single-currency report consolidation; the most recent rate ≤ `asOf` wins.
- **Accounting portal is accountant-owned; admin is excluded.** Finance is not the admin's job — `accountingRW = ['accountant']` and `accountingRO = ['accountant', 'reception']` in `backend/src/routes/index.ts`, and admin is absent from every `<ProtectedRoute>` under `/accounting/*` in `frontend/src/App.tsx`. Reception keeps RO on the tuition student list + per-student detail so the front desk can answer "how much does this family owe?" walk-ins. Don't re-add `'admin'` to those tuples without explicit user direction.
- **`utils/money.ts` is the only currency formatter.** Web `frontend/src/utils/money.ts` and server `backend/src/utils/currency.ts` carry the same symbol table (USD/EUR/GBP plus IQD/AED/SAR/KWD/QAR/BHD/OMR/JOD/LBP/EGP/TRY/ILS/INR/PKR/BDT/LKR/CNY/KRW/RUB/BRL/ZAR/etc.) and ZERO_DECIMAL set. Don't reintroduce inline `fmt(amount, cur)` helpers.
- **Password reset is admin-mediated, not email-based.** `forgotPassword()` creates a `password_reset_requests` row; an admin sees it in their panel and calls `resetUserPassword()`. `nodemailer` is imported in the backend but never called.
- **Employee documents live in a private bucket** (`employee-documents`), not the public `homework-attachments`. Reads are signed-URL only (5-min TTL, audited per issue). Uploads are MIME-allowlisted (jpg/png/webp/pdf), magic-byte sniffed (PENTEST H-2), SHA-256 hashed, max 10 MB. Backed by `employee_documents` (Wave 1 — migration 028). Categories live in code (`backend/src/utils/employeeDocs.ts` → `DOCUMENT_CATEGORIES`) and can be overridden per school via `school_document_categories`. `users.is_hr_officer` gates high-sensitivity reads (identity, right-to-work, health, background). The Wave 1 + Wave 2 plan is in `memory/employee-records-plan.md`. To add a category: append to `DOCUMENT_CATEGORIES` with a key/label/group/sensitivity/requiresExpiry tuple, then add the key + label translations under `admin.docs.categories.*` (Wave 1 ships untranslated category labels — the frontend renders the catalog `label` directly). No DB migration needed.
- **Employee extended PII is field-level encrypted** (Wave 2 — migration 029). AES-256-GCM with a key derived from `EMPLOYEE_PII_KEY` env var via HKDF-SHA256, plus a per-school salt mixed into `info` so each tenant's derived key is different. Wire format: `v1:<iv-b64url>:<ct+tag-b64url>`. Encrypt / decrypt / lookup-hash helpers in `backend/src/utils/employeePiiCrypto.ts`. `EMPLOYEE_PII_KEY` must be ≥32 chars — set it once and never rotate without a key-version bump in the wire format. Sensitivity tiers (per the locked decisions): `religion` and `social_insurance_no` are HR-officer-only on read; `mother_full_name`, `father_full_name`, `spouse_name`, `bank_iban`, `tax_id` are encrypted but any admin (or the employee themselves via self-service) can read. Lookup hashes (`*_lookup_hash` columns) enable equality search without decryption. Right-to-erasure: `POST /admin/employees/:role/:id/extended/redact` NULLs every encrypted column + lookup hash and stamps `redacted_at`; the row stays as a tombstone so the archive integrity chain still verifies.
- **Polymorphic owner pointers survive archive.** `employee_documents` (Wave 1) plus `employee_extended_profile`, `employee_emergency_contacts`, `employee_acknowledgements`, `employee_actions` (Wave 2) are all keyed on `(owner_type, owner_id)`. On archive, `utils/employeeArchive.ts#rewriteOwnershipToArchive()` rewrites the pointer from `teachers`/`drivers`/`staff_members`/`users` to `archived_employees`, called from every archive path (deleteTeacher / deleteDriver / deleteAccount in admin.controller, deleteStaff in staff.controller, the termination flow). Don't add a new polymorphic table without also adding it to that helper.
- **HR officer is a sub-role flag**, not a top-level role. `users.is_hr_officer BOOLEAN` only flips true for admins (DB CHECK + API guard). Promoting / revoking notifies every OTHER admin via the notifications table (transparency). Manage at `/admin/hr-officers`.
- **Self-service employee records** at `/me/profile` (Wave 2.5). The logged-in employee reads + edits their own low + medium PII fields (mother / father / spouse / IBAN / tax ID + place of birth / nationality / blood type / languages / dependents / bank name) plus emergency contacts. Religion + SSN are deliberately absent from the self-service input contract — the backend strips them from `PUT /me/extended` even if a client posts them. Resolution: `meEmployee.controller.ts#resolveMyOwner()` maps the JWT role to (`teachers`/`drivers`/`users`, owner_id). Parents 403; staff doesn't apply because staff isn't a login role. Employee acknowledgement of school policies still goes through the admin endpoints today — adding `/me/acknowledgements` is a follow-up.
- **Profile export = schemaVersion 2** (Wave 2.5). `GET /admin/employees/:role/:id/export.json` now ships extended profile + emergency contacts + acknowledgements + actions alongside the Wave-1 profile + documents. PDF gets matching sections. Religion + SSN follow the same HR-officer gating — non-officers see `[hr_officer_required]`.
- **ClamAV scanning is opt-in via `EMPLOYEE_DOC_SCAN_ENABLED=true`** (Wave 3). When that env var is set on the API, new uploads land with `scan_status='pending'` and the signed-URL endpoint refuses to issue links (425 Too Early) until the worker flips the row to `clean` or `infected`. The standalone worker lives at `clamav-worker/` (separate Railway service, Dockerfile installs ClamAV CLI + freshclam, polling loop downloads from Supabase, scans with `clamscan`, updates the row, notifies admins on `infected`). With the flag off, uploads still write `scan_status='skipped'` and downloads are immediate — Wave 1's MIME allowlist + magic-byte sniff + `Content-Disposition: attachment` + 10 MB cap + private bucket are still in force, and the `infected` block still applies if anything ever flips a row to it. To retroactively scan pre-existing rows after enabling: `UPDATE employee_documents SET scan_status='pending' WHERE scan_status='skipped' AND voided_at IS NULL;`.
- **PII key rotation is supported via versioned wire format** (Wave 3). The encrypted value's `vN:` prefix tags the master-key version. Add `EMPLOYEE_PII_KEY_V<N>` env vars alongside the existing `EMPLOYEE_PII_KEY` (= v1) and the encrypt path uses the highest version present; decrypt dispatches by tag. Run `npm run rotate:pii -w backend` (script at `backend/scripts/rotate-pii-keys.ts`) to re-encrypt rows still on an old version. After the script reports all rows on the new version, remove the old env var. Lookup hashes get rebuilt on rotation so equality search keeps working. Per-school keys: the HKDF derivation already mixes `schoolId` into the `info` parameter, so each tenant's encryption key is independent even on a single master.

## Before you edit

- Touching `grades` / `reports` read or write paths → re-read the dual-schema rule.
- Touching any backend query → verify `school_id` scoping.
- Adding a new role, field, or API shape → update both `frontend/src/types/index.ts` AND `mobile/src/types/index.ts`.
- Adding UI strings → update `en`, `ar`, AND `ku` locale files.
- Touching mobile → decide OTA vs native rebuild before reporting done.
- Touching the master portal → don't add deploy config.
- Touching auth or user creation → remember the `<abbreviation>_<name>` username rule.
- Touching `schools.features` → remember it forces every client of that school to re-login.
