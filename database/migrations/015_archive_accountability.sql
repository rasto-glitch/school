-- Migration 015 — archive audit & accountability (audit findings F1, F2)
--
-- F1: audit_logs.entity_type CHECK (last set in migration 009) never
--     listed the employee entity types. Every teacher/driver/supervisor/
--     admin archive or delete called logAudit({ entityType: 'teacher' … }),
--     the insert violated the CHECK, and logAudit (best-effort) swallowed
--     the error — so destructive employee operations were UNAUDITED.
--     Widen the constraint to cover them.
--
-- F2: archived_students / archived_employees had no record of WHO archived
--     the row. Combined with F1 (employee audit dropped), the actor was
--     lost entirely for employees. Add archived_by* columns, stored as
--     text too so the actor survives that actor's own later deletion.
--     Thread through both atomic RPCs — the signature changes, so the old
--     overload is dropped before recreate.

-- ── F1 ────────────────────────────────────────────────────────────────
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check
  CHECK (entity_type IN (
    'student','fee_plan','student_fee','fee_payment','staff_member','staff_salary_payment',
    'expense_category','expense_template','expense',
    'accounting_period','payment_account','fx_rate','late_fee',
    'teacher','driver','supervisor','admin'
  ));

-- ── F2: columns ───────────────────────────────────────────────────────
ALTER TABLE archived_students  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE archived_students  ADD COLUMN IF NOT EXISTS archived_by_name TEXT;
ALTER TABLE archived_students  ADD COLUMN IF NOT EXISTS archived_by_role TEXT;
ALTER TABLE archived_employees ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE archived_employees ADD COLUMN IF NOT EXISTS archived_by_name TEXT;
ALTER TABLE archived_employees ADD COLUMN IF NOT EXISTS archived_by_role TEXT;

-- ── F2: archive_student_atomic (drop old 12-arg overload, recreate) ────
DROP FUNCTION IF EXISTS archive_student_atomic(UUID,UUID,TEXT,DATE,DATE,DATE,TEXT,TEXT,TEXT,JSONB,JSONB,JSONB);
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
  p_archived_by_role TEXT
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
    archived_by, archived_by_name, archived_by_role
  ) VALUES (
    p_school_id, p_student_id, p_full_name, p_date_of_birth, p_enrollment_date,
    p_departure_date, p_reason, p_parent_full_name, p_parent_phone,
    COALESCE(p_classes_attended, '[]'::jsonb),
    COALESCE(p_grades, '[]'::jsonb),
    COALESCE(p_payment_history, '[]'::jsonb),
    p_archived_by, p_archived_by_name, p_archived_by_role
  )
  RETURNING id INTO v_archive_id;

  DELETE FROM students
   WHERE id = p_student_id AND school_id = p_school_id;

  RETURN v_archive_id;
END;
$$;

-- ── F2: archive_employee_atomic (drop old 21-arg overload, recreate) ──
DROP FUNCTION IF EXISTS archive_employee_atomic(UUID,UUID,UUID,TEXT,TEXT,DATE,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,DATE,DATE,TEXT,JSONB,JSONB,JSONB,JSONB,JSONB);
CREATE OR REPLACE FUNCTION archive_employee_atomic(
  p_school_id UUID,
  p_user_id UUID,
  p_original_employee_id UUID,
  p_role TEXT,
  p_full_name TEXT,
  p_date_of_birth DATE,
  p_age INTEGER,
  p_phone_number TEXT,
  p_email TEXT,
  p_emergency_contact TEXT,
  p_profile_picture TEXT,
  p_position TEXT,
  p_subject TEXT,
  p_hire_date DATE,
  p_departure_date DATE,
  p_reason TEXT,
  p_account JSONB,
  p_teaching JSONB,
  p_transport JSONB,
  p_employment JSONB,
  p_payment_history JSONB,
  p_archived_by UUID,
  p_archived_by_name TEXT,
  p_archived_by_role TEXT
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_archive_id UUID;
BEGIN
  INSERT INTO archived_employees (
    school_id, original_employee_id, role, full_name, date_of_birth, age,
    phone_number, email, emergency_contact, profile_picture, position, subject,
    hire_date, departure_date, reason,
    account, teaching, transport, employment, payment_history,
    archived_by, archived_by_name, archived_by_role
  ) VALUES (
    p_school_id, p_original_employee_id, p_role, p_full_name, p_date_of_birth, p_age,
    p_phone_number, p_email, p_emergency_contact, p_profile_picture, p_position, p_subject,
    p_hire_date, p_departure_date, p_reason,
    COALESCE(p_account, '{}'::jsonb),
    COALESCE(p_teaching, '[]'::jsonb),
    COALESCE(p_transport, '{}'::jsonb),
    COALESCE(p_employment, '{}'::jsonb),
    COALESCE(p_payment_history, '[]'::jsonb),
    p_archived_by, p_archived_by_name, p_archived_by_role
  )
  RETURNING id INTO v_archive_id;

  DELETE FROM users
   WHERE id = p_user_id AND school_id = p_school_id;

  RETURN v_archive_id;
END;
$$;
