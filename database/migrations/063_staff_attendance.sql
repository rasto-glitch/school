-- ============================================================
-- Migration 063 — Staff (employee) QR attendance, Phase 1 core.
--   A SEPARATE domain from the existing STUDENT `attendance` table /
--   `features.attendance` flag. Everything here is namespaced `staff_*`.
--
--   1. users.role            — add the generic 'staff' role (accountless
--                              workers: cleaner / security / kitchen; their
--                              ONLY portal purpose is clocking in/out).
--   2. users.job_title       — display label for staff ("Cleaner","Security").
--   3. schools.features       — add the `staff_attendance` gate to the DEFAULT
--                              (NEW schools only; existing rows get the key when
--                              an admin first enables it — no mass re-login).
--   4. schools.staff_attendance_config — geofence pin + radius + schedule.
--                              Lives OUTSIDE `features` so editing the pin /
--                              schedule does NOT bump features_version / force a
--                              re-login (mirrors grading_config).
--   5. staff_attendance      — one row per (school, employee, work_date); the
--                              toggle model resolves check-in vs check-out from
--                              the open row.
--   6. staff_leave           — lightweight admin leave marker (date range).
--   7. audit_logs.entity_type — add 'staff_attendance' + 'staff_leave'.
-- Safe to run multiple times (idempotent).
-- ============================================================

-- ── 1. Add the generic 'staff' role ────────────────────────────────────────
-- Re-declared as the full current superset so this also heals any drift
-- between schema.sql and the live constraint (last widened in migration 007).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('parent','teacher','admin','driver','supervisor','reception','accountant','staff'));

-- ── 2. Staff display job title ──────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;

-- ── 3. Feature gate on the features DEFAULT (new schools only) ──────────────
-- Existing rows are intentionally left untouched: a missing key reads as
-- falsy (feature off), and adding it now to every row would fire the
-- increment_features_version trigger and force every user at every school to
-- re-login. The settings "Enable staff attendance" toggle adds the key (and
-- bumps the version — intended, since new tabs/screens then load) per school.
ALTER TABLE schools ALTER COLUMN features SET DEFAULT
  '{"homework":true,"assignments":true,"announcements":true,"grades":true,"reports":true,"bus_tracking":true,"appointments":true,"attendance":true,"weekly_summary":true,"chat":true,"teacher_report_handoff":true,"staff_attendance":false}';

-- ── 4. Geofence + schedule config (separate column, no version bump) ────────
-- Shape: { "geofence": {"lat":null,"lng":null,"radiusMeters":250},
--          "schedule": {"startTime":"08:00","endTime":"15:00","lateGraceMinutes":15} }
-- The map pin (lat/lng) must be set before the feature can sensibly be enabled
-- (the scan endpoint needs a centre to measure the geofence from).
ALTER TABLE schools ADD COLUMN IF NOT EXISTS staff_attendance_config JSONB NOT NULL DEFAULT
  '{"geofence":{"lat":null,"lng":null,"radiusMeters":250},"schedule":{"startTime":"08:00","endTime":"15:00","lateGraceMinutes":15}}'::jsonb;

-- ── 5. staff_attendance ─────────────────────────────────────────────────────
-- work_date is the school-LOCAL date (computed in the controller from
-- schools.timezone). UNIQUE(school_id,user_id,work_date) = one row/day; the
-- toggle resolves in vs out (no open row → check-in; open row → check-out;
-- closed/auto_closed → already done for today). Multi-punch = Phase 2.
CREATE TABLE IF NOT EXISTS staff_attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  check_in_at TIMESTAMPTZ,
  check_in_lat DOUBLE PRECISION,
  check_in_lng DOUBLE PRECISION,
  check_in_method TEXT DEFAULT 'qr',
  check_out_at TIMESTAMPTZ,
  check_out_lat DOUBLE PRECISION,
  check_out_lng DOUBLE PRECISION,
  check_out_method TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','auto_closed')),
  is_late BOOLEAN NOT NULL DEFAULT FALSE,
  -- flagged rows surface in the admin review queue (auto-closeout / manual edits)
  flagged BOOLEAN NOT NULL DEFAULT FALSE,
  flag_reason TEXT,
  corrected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  corrected_at TIMESTAMPTZ,
  correction_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, user_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_school_date
  ON staff_attendance(school_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_user
  ON staff_attendance(user_id, work_date DESC);
-- Partial index for the auto-closeout sweep + "who's still open" board.
CREATE INDEX IF NOT EXISTS idx_staff_attendance_open
  ON staff_attendance(school_id) WHERE status = 'open';

-- ── 6. staff_leave (lightweight admin marker) ──────────────────────────────
-- Admin records {employee, date range, type}; the summary/board treat a user
-- as on-leave (not absent) when today ∈ [start_date, end_date]. Full
-- request→approval workflow = Phase 2.
CREATE TABLE IF NOT EXISTS staff_leave (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  leave_type TEXT NOT NULL DEFAULT 'other',
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_leave_dates_ok CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_staff_leave_school
  ON staff_leave(school_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_staff_leave_user
  ON staff_leave(user_id, start_date, end_date);

-- ── 7. Widen audit_logs.entity_type ─────────────────────────────────────────
-- Add 'staff_attendance' (manual correction of a punch) and 'staff_leave'
-- (add/remove a leave marker). Re-declared as the full current superset
-- (last set in migration 060) so this also heals any drift.
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check CHECK (
  entity_type IN (
    'student','fee_plan','student_fee','fee_payment','staff_member','staff_salary_payment',
    'expense_category','expense_template','expense',
    'accounting_period','payment_account','fx_rate','late_fee',
    'teacher','driver','supervisor','admin','reception','accountant',
    'employee_document','employee_profile',
    'employee_extended_profile','employee_emergency_contact',
    'school_policy','employee_acknowledgement','employee_action',
    'hr_officer',
    'archived_employee','archived_student',
    'class','student_transfer','attendance',
    'user_account','user_mfa','trusted_device','user_session',
    'report',
    'chart_of_account','journal_entry',
    'admin_clearance',
    'grade_filing_window',
    -- Migration 063 — staff (employee) QR attendance
    'staff_attendance','staff_leave'
  )
);
