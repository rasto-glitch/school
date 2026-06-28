-- ============================================================
-- Migration 060 — dashboard "Needs your attention" rework:
--   1. grade_filing_windows  — per-term filing window (AUTHORITATIVE: when no
--      window is open for a term, teachers cannot file grades for it; admins
--      always override). Drives the dashboard grade signal's state machine.
--   2. login_attempts        — best-effort record of every failed credential
--      check (after the school is resolved). Powers the failed-login dashboard
--      signal + the IT security page. NEVER blocks login. Auto-purged ~90 days.
--   3. attention_action_cooldowns — anti-spam for the dashboard Notify/Remind
--      actions (one row per school+kind; also lets the UI show "sent Xm ago").
--   4. notifications.notification_type — add 'attendance' + 'security'.
--   5. audit_logs.entity_type — add 'grade_filing_window'.
-- Safe to run multiple times.
-- ============================================================

-- ── 1. Grade filing windows ────────────────────────────────────────────────
-- term matches grades.grading_period (= terms.name). One window per (school,
-- term); today (school-local) ∈ [opens_on, closes_on] ⇒ filing is open.
CREATE TABLE IF NOT EXISTS grade_filing_windows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  opens_on DATE NOT NULL,
  closes_on DATE NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, term),
  CONSTRAINT grade_window_dates_ok CHECK (closes_on >= opens_on)
);
CREATE INDEX IF NOT EXISTS idx_grade_windows_school ON grade_filing_windows(school_id);

-- ── 2. Login attempts ──────────────────────────────────────────────────────
-- Written best-effort on a failed credential check, once the school has been
-- resolved (so school_id is always present). matched_user_id is NULL when the
-- username matched no account; matched_role freezes the targeted account's
-- role so the "failed logins on an admin account" signal survives a later role
-- change or account deletion.
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  matched_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  matched_role TEXT,
  ip TEXT,
  user_agent TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_school_time
  ON login_attempts(school_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_user
  ON login_attempts(matched_user_id, attempted_at DESC)
  WHERE matched_user_id IS NOT NULL;

-- ── 3. Attention action cooldowns ──────────────────────────────────────────
-- One row per (school, kind). kind ∈ {'attendance','grade_remind'}. Upserted
-- whenever the matching dashboard action fires; the server refuses to re-notify
-- within the cooldown window and the UI reads last_fired_at to disable + label
-- the button ("Notified 8m ago").
CREATE TABLE IF NOT EXISTS attention_action_cooldowns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  last_fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_fired_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(school_id, kind)
);

-- ── 4. Widen notifications.notification_type ───────────────────────────────
-- Add 'attendance' (supervisor "classes missing today's attendance" nudge) and
-- 'security' (failed-login alert). Re-declared as the full current superset so
-- this also heals any drift between schema.sql and the live constraint.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_notification_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check
  CHECK (notification_type IN (
    'homework','assignment','announcement','bus','grade','grade_pending',
    'general','system','report','appointment','post',
    'payment_recorded','fees_reminder','salary_due_soon','salary_paid',
    'attendance','security'
  ));

-- ── 5. Widen audit_logs.entity_type ────────────────────────────────────────
-- New 'grade_filing_window' for set/clear of a term's filing window. Last set
-- in migration 058.
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
    -- Migration 060 — per-term grade filing window set/clear
    'grade_filing_window'
  )
);
