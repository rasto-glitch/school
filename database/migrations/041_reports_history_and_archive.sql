-- Migration 041 — Reports become durable, year-organized history.
--
-- BACKGROUND
-- ----------
-- Reports were treated as ephemeral monthly snapshots:
--   * No academic_year column on `reports` — only `report_date DATE`.
--   * The year-transition wizard (admin.controller#yearTransition) wiped
--     every active student's reports as a "clean slate."
--   * The student archive snapshot (archived_students.grades JSONB) didn't
--     include reports at all, so any reports written before a student left
--     vanished with the live row.
--
-- The new model treats reports as the year-by-year academic narrative of
-- each student — read by parents, by the student's next teacher in
-- September (Tier A handoff: same-subject visibility, with a per-report
-- opt-in for cross-subject share in PR 2), and frozen into the archive
-- snapshot when the student eventually leaves.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- 1. Adds first-class history columns to `reports`:
--      academic_year                  NOT NULL — stamped by the writer
--      class_id                       FK to classes (SET NULL on class delete)
--      class_name_snapshot            survives class rename / delete
--      teacher_name_snapshot          survives teacher delete / archive
--      shared_with_other_teachers     opt-in cross-subject visibility (PR 2)
--
-- 2. Adds `reports JSONB` to `archived_students` so departing students'
--    full report history is preserved alongside grades / payment_history.
--
-- 3. Bumps the per-row tamper-evidence canonical form of archived_students
--    from as.v1 → as.v2 to include `reports`. The integrity verifier
--    re-derives content_hash from the current canonical form, so old
--    demo-data archives (if any) will show as 'content_altered' — that's
--    expected; the demo data is disposable per the project state.
--
-- 4. Extends archive_student_atomic() with a p_reports JSONB parameter so
--    the controller can pass the snapshot through atomically with the
--    rest of the archive write.
--
-- 5. Drops the parameter defaults from archive_student_atomic that were
--    only there to support older callers during deploy (migration 031).
--    The single live caller (admin.controller#archiveStudent) is updated
--    in this same PR.
--
-- DEMO-DATA NOTE
-- --------------
-- Per project state: Scholify currently has only demo data. This migration
-- therefore (a) declares the new NOT NULL columns directly without a
-- nullable-then-backfill phase, and (b) does NOT version the canonical
-- form as a backward-compatible 'as.v1 OR as.v2' branch — a clean rebump
-- to v2 is the right thing for fresh demo rows.

-- ─────────────────────────────────────────────────────────────────────
-- 0. audit_logs.entity_type — allow 'report' for share-toggle audit (PR 2)
-- ─────────────────────────────────────────────────────────────────────

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
    -- PR 2 — share-toggle on teacher reports
    'report'
  )
);

-- ─────────────────────────────────────────────────────────────────────
-- 1. reports — new history columns
-- ─────────────────────────────────────────────────────────────────────

-- The academic_year column is referenced by the createReport controller
-- today but doesn't exist on the table (latent bug). Add it now, NOT NULL.
-- The single existing writer is updated in this PR to stamp it from the
-- date-derived authoritative academicYearOf() helper (not the stale
-- schools.current_academic_year — see audit finding HD-4).
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS academic_year TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS class_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS teacher_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS shared_with_other_teachers BOOLEAN NOT NULL DEFAULT false;

-- Hot read paths: (student, year DESC, created_at DESC) for the parent
-- timeline; (school, year) for any future cross-school report counts.
CREATE INDEX IF NOT EXISTS idx_reports_student_year
  ON reports(student_id, academic_year DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_school_year
  ON reports(school_id, academic_year);

-- ─────────────────────────────────────────────────────────────────────
-- 2. archived_students — capture reports in the snapshot
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE archived_students
  ADD COLUMN IF NOT EXISTS reports JSONB NOT NULL DEFAULT '[]';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Canonical form bump: as.v1 → as.v2 (adds `reports`)
-- ─────────────────────────────────────────────────────────────────────
-- The append-only triggers on archived_students compute content_hash
-- from this function on insert. Bumping the version tag is the documented
-- signal that the canonical input shape changed.

CREATE OR REPLACE FUNCTION _canon_archived_student(r archived_students) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', 'as.v2',
    r.school_id::text, coalesce(r.original_student_id::text,''),
    coalesce(r.full_name,''), coalesce(r.date_of_birth::text,''),
    coalesce(r.enrollment_date::text,''), coalesce(r.departure_date::text,''),
    coalesce(r.reason,''), coalesce(r.parent_full_name,''), coalesce(r.parent_phone,''),
    coalesce(r.classes_attended::text,'[]'), coalesce(r.grades::text,'[]'),
    coalesce(r.payment_history::text,'[]'), coalesce(r.reports::text,'[]'),
    coalesce(r.archived_by::text,''),
    coalesce(r.archived_by_name,''), coalesce(r.archived_by_role,''),
    coalesce(r.original_parent_id::text,''), coalesce(r.snapshot_version::text,'1'),
    coalesce(r.created_at::text,''))
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. archive_student_atomic — accept reports JSONB + carry transfer_id
-- ─────────────────────────────────────────────────────────────────────
-- Drop the old signatures first so the new one replaces them cleanly.
-- Postgres allows multiple overloads; we want exactly one to stay callable.
-- The new signature carries forward p_transfer_id (added by migration 033
-- for the studentTransfer flow) and adds p_reports.

DROP FUNCTION IF EXISTS archive_student_atomic(
  UUID, UUID, TEXT, DATE, DATE, DATE, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB, UUID, TEXT, TEXT, UUID, JSONB, UUID
);
DROP FUNCTION IF EXISTS archive_student_atomic(
  UUID, UUID, TEXT, DATE, DATE, DATE, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB, UUID, TEXT, TEXT, UUID, JSONB
);
DROP FUNCTION IF EXISTS archive_student_atomic(
  UUID, UUID, TEXT, DATE, DATE, DATE, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB, UUID, TEXT, TEXT, UUID
);

CREATE OR REPLACE FUNCTION archive_student_atomic(
  p_school_id UUID,
  p_student_id UUID,
  p_full_name TEXT,
  p_date_of_birth DATE,
  p_enrollment_date DATE,
  p_departure_date DATE,
  p_reason TEXT,
  p_parent_full_name TEXT,
  p_parent_phone TEXT,
  p_classes_attended JSONB,
  p_grades JSONB,
  p_payment_history JSONB,
  p_archived_by UUID,
  p_archived_by_name TEXT,
  p_archived_by_role TEXT,
  p_original_parent_id UUID,
  p_enrollment_history JSONB DEFAULT '[]'::jsonb,
  p_transfer_id UUID DEFAULT NULL,
  p_reports JSONB DEFAULT '[]'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_archive_id UUID;
BEGIN
  INSERT INTO archived_students (
    school_id, original_student_id, full_name, date_of_birth, enrollment_date,
    departure_date, reason, parent_full_name, parent_phone,
    classes_attended, enrollment_history, grades, payment_history, reports,
    archived_by, archived_by_name, archived_by_role, original_parent_id,
    transfer_id
  ) VALUES (
    p_school_id, p_student_id, p_full_name, p_date_of_birth, p_enrollment_date,
    p_departure_date, p_reason, p_parent_full_name, p_parent_phone,
    COALESCE(p_classes_attended, '[]'::jsonb),
    COALESCE(p_enrollment_history, '[]'::jsonb),
    COALESCE(p_grades, '[]'::jsonb),
    COALESCE(p_payment_history, '[]'::jsonb),
    COALESCE(p_reports, '[]'::jsonb),
    p_archived_by, p_archived_by_name, p_archived_by_role, p_original_parent_id,
    p_transfer_id
  )
  RETURNING id INTO v_archive_id;

  DELETE FROM students
   WHERE id = p_student_id AND school_id = p_school_id;

  RETURN v_archive_id;
END;
$$;
