-- ============================================================
-- Migration 066 — Report cards & transcripts, Phase 1 core.
--   Report cards are LIVE-rendered PDFs built on demand from existing
--   released `grades` data (no grade duplication). This migration adds only
--   the small surfaces that aren't derivable from grades:
--     1. schools.report_card_config — per-school template (signatories,
--        header/footer note, default language). Separate column (NOT in
--        `features`) so editing it never bumps features_version / forces
--        re-login (mirrors grading_config / staff_attendance_config).
--     2. report_card_remarks — the overall homeroom/principal comment per
--        (student, academic_year, term). Per-subject notes already live on
--        grades.admin_note.
--     3. report_card_publish — per (school, academic_year, term) publish gate.
--        Phase 1 only creates it; the publish endpoint + the parent-visibility
--        check land in Phase 2 (parents must not pull a half-entered term).
--     4. audit_logs.entity_type — add 'report_card'.
-- Safe to run multiple times (idempotent).
-- ============================================================

-- ── 1. Per-school report-card template config (no version bump) ─────────────
ALTER TABLE schools ADD COLUMN IF NOT EXISTS report_card_config JSONB NOT NULL DEFAULT
  '{"signatories":{"classTeacher":"","principal":""},"headerNote":"","footerNote":"","defaultLang":"en"}'::jsonb;

-- ── 2. Overall homeroom / principal remark per student per term ─────────────
CREATE TABLE IF NOT EXISTS report_card_remarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  homeroom_comment TEXT,
  principal_comment TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One remark row per student per term (upsert target).
  UNIQUE(school_id, student_id, academic_year, term)
);
CREATE INDEX IF NOT EXISTS idx_report_card_remarks_lookup
  ON report_card_remarks(school_id, student_id, academic_year, term);

-- ── 3. Per-term publish gate (parent visibility — used from Phase 2) ────────
CREATE TABLE IF NOT EXISTS report_card_publish (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(school_id, academic_year, term)
);
CREATE INDEX IF NOT EXISTS idx_report_card_publish_lookup
  ON report_card_publish(school_id, academic_year, term);

-- ── 4. Widen audit_logs.entity_type ─────────────────────────────────────────
-- Add 'report_card' (covers config / remarks / publish writes). Re-declared as
-- the full current superset (last set in migration 063) so this also heals drift.
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
    'staff_attendance','staff_leave',
    -- Migration 066 — report cards (config / remarks / publish)
    'report_card'
  )
);
