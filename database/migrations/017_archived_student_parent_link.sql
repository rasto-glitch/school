-- Migration 017 — parent link on archived students (finding F6, Phase C)
--
-- Parents of a graduated OR archived child must be able to log in and see
-- a read-only frozen snapshot of that child. Graduated children still
-- have a live students row (parent_id intact), but transferred/withdrew
-- children have their students row deleted — archived_students only kept
-- parent name/phone as text, with no reliable key back to the parent
-- account. Capture original_parent_id at archive time.
--
-- Rows archived before this migration have a NULL original_parent_id and
-- are intentionally NOT surfaced to parents (admin/accountant only).
--
-- archive_student_atomic signature changes again ⇒ drop the 15-arg
-- overload (post-migration-015 shape) before recreate.

ALTER TABLE archived_students
  ADD COLUMN IF NOT EXISTS original_parent_id UUID REFERENCES parents(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_archived_students_parent
  ON archived_students(school_id, original_parent_id)
  WHERE original_parent_id IS NOT NULL;

DROP FUNCTION IF EXISTS archive_student_atomic(UUID,UUID,TEXT,DATE,DATE,DATE,TEXT,TEXT,TEXT,JSONB,JSONB,JSONB,UUID,TEXT,TEXT);
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
  p_original_parent_id UUID
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_archive_id UUID;
BEGIN
  INSERT INTO archived_students (
    school_id, original_student_id, full_name, date_of_birth, enrollment_date,
    departure_date, reason, parent_full_name, parent_phone,
    classes_attended, grades, payment_history,
    archived_by, archived_by_name, archived_by_role, original_parent_id
  ) VALUES (
    p_school_id, p_student_id, p_full_name, p_date_of_birth, p_enrollment_date,
    p_departure_date, p_reason, p_parent_full_name, p_parent_phone,
    COALESCE(p_classes_attended, '[]'::jsonb),
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
