-- Migration 010 — archive integrity fixes
--
-- C3 (option A): change grades.class_id and attendance.class_id from
--   ON DELETE CASCADE → ON DELETE SET NULL.
--   When an admin deletes a class, the historical grade/attendance rows
--   survive as orphans (class_id = NULL) instead of being silently
--   destroyed. Per-student reads still surface them; per-class reads
--   correctly miss them because the class no longer exists.
--
-- M8: add ON DELETE SET NULL to assignments.student_id.
--   The column was REFERENCES students(id) with no clause — Postgres
--   default NO ACTION blocked any student delete that had a personalised
--   assignment, causing archiveStudent to throw a 500 with an FK error.
--
-- M9: wrap the archive insert + student delete in a single PL/pgSQL
--   function so it runs in one transaction. Previously the two REST
--   calls could partially succeed (insert OK, delete fails) and leave
--   a duplicate archive row alongside the live student.

-- ---------------------------------------------------------------------
-- C3 — grades.class_id
-- ---------------------------------------------------------------------
ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_class_id_fkey;
ALTER TABLE grades ALTER COLUMN class_id DROP NOT NULL;
ALTER TABLE grades
  ADD CONSTRAINT grades_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- C3 — attendance.class_id
-- ---------------------------------------------------------------------
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_class_id_fkey;
ALTER TABLE attendance ALTER COLUMN class_id DROP NOT NULL;
ALTER TABLE attendance
  ADD CONSTRAINT attendance_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;

-- Note: the UNIQUE(student_id, class_id, date) constraint still applies
-- and treats two NULL class_ids on the same (student, date) as distinct
-- (per Postgres standard NULL semantics), which is the desired behaviour
-- — a student can have orphan attendance from multiple deleted classes.

-- ---------------------------------------------------------------------
-- M8 — assignments.student_id
-- ---------------------------------------------------------------------
ALTER TABLE assignments DROP CONSTRAINT IF EXISTS assignments_student_id_fkey;
ALTER TABLE assignments
  ADD CONSTRAINT assignments_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- M9 — atomic archive function
-- ---------------------------------------------------------------------
-- The controller builds the snapshot JSONBs in TypeScript (complex business
-- logic that benefits from staying there). This function just does the
-- final insert + delete pair atomically.
--
-- Returns the new archived_students.id on success. Any exception rolls
-- back the entire operation — neither row is committed.
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
  p_payment_history JSONB
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_archive_id UUID;
BEGIN
  INSERT INTO archived_students (
    school_id, original_student_id, full_name, date_of_birth, enrollment_date,
    departure_date, reason, parent_full_name, parent_phone,
    classes_attended, grades, payment_history
  ) VALUES (
    p_school_id, p_student_id, p_full_name, p_date_of_birth, p_enrollment_date,
    p_departure_date, p_reason, p_parent_full_name, p_parent_phone,
    COALESCE(p_classes_attended, '[]'::jsonb),
    COALESCE(p_grades, '[]'::jsonb),
    COALESCE(p_payment_history, '[]'::jsonb)
  )
  RETURNING id INTO v_archive_id;

  DELETE FROM students
   WHERE id = p_student_id AND school_id = p_school_id;

  RETURN v_archive_id;
END;
$$;
