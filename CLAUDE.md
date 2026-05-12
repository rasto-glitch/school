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
- **Subjects: many-to-many, with caches.** `subject_teachers` (join table) is the source of truth — a subject can have several teachers and a teacher several subjects. `teachers.subject` (text, comma-joined) and `subjects.teacher_id` ("primary"/first teacher) are denormalized caches kept in sync by helpers in `admin.controller.ts` (`setSubjectTeachers` / `setTeacherSubjects` / `refreshTeacherSubjectText` / `refreshSubjectPrimaryTeacher`). Teacher profile endpoints resolve from `subject_teachers`, fall back to `teachers.subject` for legacy rows, and return both `subject` (joined string) and `subjects: [{id,name}]`. Teacher-authored content (homework/assignments/reports/weekly summaries) still tags with the joined `subject` string — no per-content subject picker yet.
- **Drivers have `vehicle_type`** (`bus` | `taxi`) and `excluded_student_ids UUID[]` for students they don't transport.
- **Password reset is admin-mediated, not email-based.** `forgotPassword()` creates a `password_reset_requests` row; an admin sees it in their panel and calls `resetUserPassword()`. `nodemailer` is imported in the backend but never called.

## Before you edit

- Touching `grades` / `reports` read or write paths → re-read the dual-schema rule.
- Touching any backend query → verify `school_id` scoping.
- Adding a new role, field, or API shape → update both `frontend/src/types/index.ts` AND `mobile/src/types/index.ts`.
- Adding UI strings → update `en`, `ar`, AND `ku` locale files.
- Touching mobile → decide OTA vs native rebuild before reporting done.
- Touching the master portal → don't add deploy config.
- Touching auth or user creation → remember the `<abbreviation>_<name>` username rule.
- Touching `schools.features` → remember it forces every client of that school to re-login.
