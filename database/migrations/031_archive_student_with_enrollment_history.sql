-- Migration 031 — pass enrollment_history through archive_student_atomic
--
-- The student archive path snapshots academic data into the archived_students
-- row inside a single PL/pgSQL function (archive_student_atomic) so the
-- INSERT + DELETE are atomic. Migration 030 added archived_students.enrollment_history
-- but the function still hardcodes only the legacy fields. This migration
-- extends the function to accept and persist enrollment_history.
--
-- The new parameter is optional (defaults to '[]'::jsonb) so the function
-- signature stays callable without breaking older clients during deploy.

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
  p_enrollment_history JSONB DEFAULT '[]'::jsonb
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_archive_id UUID;
BEGIN
  INSERT INTO archived_students (
    school_id, original_student_id, full_name, date_of_birth, enrollment_date,
    departure_date, reason, parent_full_name, parent_phone,
    classes_attended, enrollment_history, grades, payment_history,
    archived_by, archived_by_name, archived_by_role, original_parent_id
  ) VALUES (
    p_school_id, p_student_id, p_full_name, p_date_of_birth, p_enrollment_date,
    p_departure_date, p_reason, p_parent_full_name, p_parent_phone,
    COALESCE(p_classes_attended, '[]'::jsonb),
    COALESCE(p_enrollment_history, '[]'::jsonb),
    COALESCE(p_grades, '[]'::jsonb),
    COALESCE(p_payment_history, '[]'::jsonb),
    p_archived_by, p_archived_by_name, p_archived_by_role, p_original_parent_id
  )
  RETURNING id INTO v_archive_id;

  DELETE FROM students
   WHERE id = p_student_id AND school_id = p_school_id;

  RETURN v_archive_id;
END;
$$;
