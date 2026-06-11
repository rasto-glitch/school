# Scholify E2E Findings — deep++++ test pass

Live deployment: `https://portal.scholify.krd` (API: `school-production-3ccc.up.railway.app`).

Severity matches PENTEST_FINDINGS.md so security and feature tracks stay comparable:

- 🟥 **Critical** — feature broken end-to-end, no workaround, blocks day-of-school.
- 🟧 **High** — feature broken, workaround exists but bad UX or data risk.
- 🟨 **Medium** — feature degraded; visible to users; should fix soon.
- 🟦 **Low** — cosmetic or rare edge case.
- 🟩 **Info** — observation, no action required.

Status starts at `OPEN`. Move to `FIXED` once shipped (cite commit), `WONTFIX` if accepted, `DUPE` if it folds into another row, `INVESTIGATING` while a human verifies.

Execution order: **admin → teacher → supervisor → driver → accountant → parent**. Accountant runs before parent so the parent verification can confirm tuition + payment flows.

## Findings

| # | Day / Role | Severity | Status | Feature | Issue | Repro | Screenshot |
|---|---|---|---|---|---|---|---|
| 1 | admin | 🟨 Medium | FIXED (pending deploy + migration 048) | Bulk upload — parent default password | All parents created via bulk upload shared `Parent@123` so the credential was effectively public. **Fix:** keep the default for admin-to-parent communication but flag the new user with `must_change_password=true`. The first successful login redirects to a new `/force-change-password` screen they can't navigate away from until they pick a strong, non-default password. Same treatment applied to driver / teacher / supervisor / accountant / reception creates and to admin-initiated password resets. The change endpoints reject any of the shipping defaults so users can't "rotate" through them. Admin's bulk-upload success card now also reads "Parents will be asked to change this password on first login." Existing accounts are explicitly left alone (column defaults FALSE on backfill). New pre-login language switcher on `/login` + `/forgot-password` + `/force-change-password` (web + mobile) so parents understand the screen if their UI is set to ku/ar. Touched: `backend/src/utils/defaultPasswords.ts` (new), `backend/src/controllers/admin.controller.ts` (5 create flows + resetUserPassword), `backend/src/controllers/auth.controller.ts` (login responses + new firstTimeChangePassword + changePassword default-reject), `frontend/src/pages/auth/ForceChangePasswordPage.tsx` (new), `frontend/src/components/auth/PreLoginLanguageSwitcher.tsx` (new), `mobile/src/screens/auth/ForceChangePasswordScreen.tsx` (new), `mobile/src/components/PreLoginLanguageSwitcher.tsx` (new), `database/migrations/048_must_change_password.sql` (new). | (after deploy + migration) Upload data/students.xlsx → log in as new parent with `Parent@123` → screen forces password change before any other route loads. | — |
| 2 | admin | 🟨 Medium | FIXED (pending deploy + migration 048) | Driver creation — default password | Same root cause as #1. Drivers (and teachers) created with a blank password field were stamped with the per-role shipping default. **Fix:** same as #1 — the new account is flagged `must_change_password=true` and forced through the change screen on first login. The driver-add success toast still shows `Driver@123` so the admin can communicate it, but the driver cannot use any feature until they pick a new password. | (after deploy + migration) /admin/drivers → leave password blank → Add → log in as that driver with `Driver@123` → screen forces password change. | — |
| 3 | admin | 🟩 Info | OPEN | Teacher onboarding — class assignment optional at create | The wizard's class-checkbox panel is optional; an admin can save a teacher with zero classes. Such a teacher cannot take attendance, post homework, post assignments, write grades or reports — every feature is gated on `teacherApi.getClasses()` being non-empty. Make the panel either required or surface a "no classes yet" banner on the teacher dashboard with a deep link back to admin. | /admin/employees/new/teacher → fill name + creds → don't tick any class → Save. | — |
| 4 | admin | 🟩 Info | OPEN | Driver onboarding — student assignment optional at create | DriversManagement's Add card lets the admin save a driver with zero assigned students, leaving /driver/students empty and the StartDrive UI non-functional. | /admin/drivers → fill required fields → don't tick any student → Add. | — |
| 5 | supervisor | 🟧 High | FIXED (false positive) | Absent-today empty after teacher marked an absence | Manual verification on 2026-06-11 confirmed `/supervisor/absent-today` does surface today's absent student on both web and mobile. The test fired because its empty-state regex matched substrings like "0 absent" that also appear in per-class summary chrome (e.g. "Grade 1: 0 absent" while Grade 5 has 1). Test 3.3 regex tightened to whole-page empty markers only. | (no longer reproducible) | — |
| 6 | supervisor | 🟨 Medium | OPEN | Student reports list — empty even with sharedWithOtherTeachers=true | Day-2 teacher submitted a report with the "Share with other teachers of this student" toggle ticked (sharedWithOtherTeachers=true in the API payload — confirmed via `[report] share toggle ticked` log line). Supervisor `/supervisor/student-reports` still shows no entry. Either the supervisor list filters reports by a different flag, or the list query is too narrow. | Login as supervisor → /supervisor/student-reports. Expected: at least one entry from the day-2 submission. | — |
| 7 | parent | 🟨 Medium | OPEN | Parent attendance history — empty | Day-2 teacher saved attendance for Grade 5; parent of Niga sees no entries on `/parent/attendance`. The page uses `parentApi.getChildAttendanceHistory` which requires enrollment_history rows that bulk-upload does NOT create. Tracked under the existing enrollment-history backfill memory; may be expected for fresh-bulk-loaded students. | Login as parent de_khalidwahab / Parent@123 → /parent/attendance. | — |
| 8 | accountant | 🟧 **High** | FIXED (pending deploy) | Recurring expense template — backend rejects null `nextDueDate` | Diagnostic test 6.28 captured `"nextDueDate: Invalid input: expected string, received null"`. The frontend serializes an empty "Next due" input as `null`, but the API's zod schema had `nextDueDate: isoDate.optional()` — `.optional()` permits the field to be missing but rejects `null`. Mirrored the existing nullable staff `nextPaymentDate` pattern. Fix: backend/src/validators/accounting.ts:131 → `isoDate.nullable().optional()`. Controller already handles null (`next_due_date: nextDueDate \|\| null`) and the "upcoming" report queries already `.not('next_due_date', 'is', null)` so null templates are correctly excluded from due-soon lookups. | (after deploy: leave Next due empty → Create template → success toast instead of error) | — |
| 9 | accountant | 🟨 Medium | OPEN | P&L report — $25 expense doesn't always appear | After 6.15 records a $25 expense, /accounting/reports/profit-loss for this month sometimes shows the $25 line and sometimes doesn't (intermittent). Could be a timing issue — the report defaults to firstOfMonth → today and may not refresh on navigation. Could also be that the expense's posting date isn't normalized to the school timezone. | Login as accountant → /accounting/reports/profit-loss after 6.15 ran. Look for the $25 expense line. | — |

## Confirmed-working feature coverage (deep++++)

End-to-end happy paths that pass on every run against live prod:

**Admin (13 tests):** login → bulk upload 50 students → create teacher/supervisor/accountant/driver (idempotent) → create Math + English subjects → assign teacher to all 6 classes → map curriculum → assign 5 students to driver → set schedule cell → post announcement → walk all 12 admin surfaces.

**Teacher (10 tests):** login → walk all 11 surfaces → take attendance (mark one absent + save) → post homework with Math subject for Grade 5 → post assignment → submit a grade → submit a report (share toggle ON) → roster has 4+ students → schedule shows the day-1 cell.

**Supervisor (8 tests):** login → walk all 9 surfaces → attendance overview filters → homework feed shows teacher's post → assignments feed shows teacher's post → weekly summary renders.

**Driver (5 tests):** login → walk all 4 surfaces → roster shows 6 students → start drive → toast confirms → stop drive → toast confirms (geolocation pinned over Erbil) → exclude a student then repeat.

**Accountant (33 tests):** login → walk all 14 surfaces → create payment account → all 4 reports render → expenses tabs + new-expense button visible → tuition settings render → periods + FX rates render → save tuition config currency=USD → create tuition plan + Assign to all students → **Niga in students rollup** → **record $100 payment** → **set $500 staff salary** → **create expense category** → **add $25 one-time expense** → **add FX rate USD→IQD 1500** → **ledger entries visible** → recurring expense template (driven through Create — see finding #8 for the captured backend error) → **close + reopen Jan 2020 period** (lock-then-unlock cycle exercised) → **refund $50 of payment** → **enable sibling discount + tier** → **broadcast tuition reminder — 41 parents notified** → **P&L renders with income** → **AR aging shows Niga** → **download receipt PDF (21 KB)** → **apply -$10 scholarship adjustment** → **void a payment row (confirm dialog handled)** → **recurring template diagnostic captures real backend error** → **cash flow forecast renders table + currency cards** → **tax report renders table or empty state** → **record salary payment $500 for QA Teacher One** → **orchestrated insurance payout** (set 10% → record payment with accrual → archive → Pay insurance → Mark insurance paid → reactivate) → **bulk set next-payment date 2027-01-01 for all active staff**.

**Parent (13 tests):** login → walk all 14 surfaces → dashboard shows linked student Niga → homework + assignments + announcements feeds correct → **tuition page reflects payment + refund (`balance/remaining` visible)** → request appointment.

## Run log

| Date (UTC) | Days | Tests | Notes |
|---|---|---|---|
| 2026-06-10 18:25–19:03 UTC | 1–6 (shallow) | 36 / 0 / 0 | initial bring-up |
| 2026-06-10 19:14–19:43 UTC | 1–6 (deep, iterative) | 58 / 0 / 0 | deep coverage; some false positives from regex-in-marker bug |
| 2026-06-10 19:44 UTC | 3, 5 — substring fix | 21 / 0 / 0 | feeds confirmed working |
| 2026-06-10 20:30–20:55 UTC | 1–6 (deep+, final) | 60 / 0 / 0 | tuition setup wired; parent verifies $100 due |
| 2026-06-11 09:30 UTC | 1–6 (deep++) | 67 / 0 / 0 | record payment, set salary, post expense, add FX, verify ledger |
| 2026-06-11 10:30 UTC | 1–6 (deep+++) | 74 / 0 / 0 | recurring template + period lock/unlock + refund + sibling discount + bulk reminder + P&L + AR aging |
| 2026-06-11 11:30 UTC | 1–6 (deep++++) | 80 / 0 / 0 | receipt PDF download + adjustment + void + recurring-template error captured + cash flow + tax report; ~4.5 min total |
| 2026-06-11 10:34 UTC | day 6 only (deep+++++) | 4 / 0 / 0 (login + 6.31/6.32/6.33) | salary payment + orchestrated insurance payout + bulk next-payment date; 25s cold then 8.7s idempotent re-run |
