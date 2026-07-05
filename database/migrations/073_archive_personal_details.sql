-- ============================================================
-- Migration 073 — archive extended personal fields + transfer-archive parity
-- (2026-07-02 functional audit H-3 + follow-up decision)
--
-- 1. archived_students gains home_address / emergency_contact / phone_number
--    so a departed student's extended personal record survives archiving.
--    Until now only name/DOB/parent name+phone were frozen; the rest
--    CASCADE-deleted with the live student row.
--
-- 2. The tamper-evidence canonical form bumps as.v3 → as.v4 to cover the
--    new columns, and every existing row is re-hashed — same precedent as
--    migrations 041 (as.v2) and 045 (as.v3). DEMO-DATA NOTE: Scholify holds
--    only demo data, so rewriting content_hash on existing rows is expected
--    and acceptable, exactly as documented in migration 045.
--
-- 3. archive_student_atomic() gains p_home_address / p_emergency_contact /
--    p_phone_number (all DEFAULT NULL). The old 19-param signature is
--    dropped first — leaving it would create an ambiguous overload for
--    PostgREST named-argument calls (same pattern as migration 041).
--
-- The transfer-completion H-3 fix itself (attendance + payment history in
-- the transfer archive) is app code: studentTransfer.controller now reuses
-- admin.controller's buildStudentArchiveSnapshot. No extra DDL needed for
-- that — the columns/params here serve both the withdraw and transfer paths.
-- ============================================================

-- 1 ─ new personal columns
ALTER TABLE archived_students ADD COLUMN IF NOT EXISTS home_address TEXT;
ALTER TABLE archived_students ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE archived_students ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- 2 ─ canonical form as.v4 (adds the three personal fields, grouped with
--     the other personal columns; everything else identical to as.v3)
CREATE OR REPLACE FUNCTION _canon_archived_student(r archived_students) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', 'as.v4',
    r.school_id::text, coalesce(r.original_student_id::text,''),
    coalesce(r.full_name,''), coalesce(r.date_of_birth::text,''),
    coalesce(r.enrollment_date::text,''), coalesce(r.departure_date::text,''),
    coalesce(r.reason,''), coalesce(r.parent_full_name,''), coalesce(r.parent_phone,''),
    coalesce(r.home_address,''),        -- new in v4
    coalesce(r.emergency_contact,''),   -- new in v4
    coalesce(r.phone_number,''),        -- new in v4
    coalesce(r.classes_attended::text,'[]'),
    coalesce(r.enrollment_history::text,'[]'),
    coalesce(r.grades::text,'[]'),
    coalesce(r.payment_history::text,'[]'),
    coalesce(r.reports::text,'[]'),
    coalesce(r.transfer_id::text,''),
    coalesce(r.archived_by::text,''),
    coalesce(r.archived_by_name,''), coalesce(r.archived_by_role,''),
    coalesce(r.original_parent_id::text,''), coalesce(r.snapshot_version::text,'1'),
    coalesce(r.created_at::text,''))
$$;

-- Re-hash every existing archive row under as.v4 (append-only trigger
-- requires the purge GUC for this session, same as migration 045).
SELECT set_config('app.allow_archive_purge', 'on', false);

UPDATE archived_students s
   SET content_hash = _sha(_canon_archived_student(s));

SELECT set_config('app.allow_archive_purge', 'off', false);

-- 3 ─ archive_student_atomic with personal params
DROP FUNCTION IF EXISTS archive_student_atomic(
  UUID, UUID, TEXT, DATE, DATE, DATE, TEXT, TEXT, TEXT,
  JSONB, JSONB, JSONB, UUID, TEXT, TEXT, UUID, JSONB, UUID, JSONB
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
  p_reports JSONB DEFAULT '[]'::jsonb,
  p_home_address TEXT DEFAULT NULL,
  p_emergency_contact TEXT DEFAULT NULL,
  p_phone_number TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_archive_id UUID;
BEGIN
  INSERT INTO archived_students (
    school_id, original_student_id, full_name, date_of_birth, enrollment_date,
    departure_date, reason, parent_full_name, parent_phone,
    home_address, emergency_contact, phone_number,
    classes_attended, enrollment_history, grades, payment_history, reports,
    archived_by, archived_by_name, archived_by_role, original_parent_id,
    transfer_id
  ) VALUES (
    p_school_id, p_student_id, p_full_name, p_date_of_birth, p_enrollment_date,
    p_departure_date, p_reason, p_parent_full_name, p_parent_phone,
    p_home_address, p_emergency_contact, p_phone_number,
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
