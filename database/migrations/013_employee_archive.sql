-- Migration 013 — employee archive system (Phase 1)
--
-- Mirrors the student archive (archived_students + archive_student_atomic
-- from migration 010). Until now teacher/driver/supervisor deletion was a
-- HARD delete: the users row was destroyed and authored content orphaned,
-- with no historical record. Staff used a separate soft-void.
--
-- Phase 1 adds:
--   1. archived_employees   — one unified snapshot table for all employee
--                             roles (teacher / driver / supervisor / staff;
--                             staff wiring lands in Phase 2).
--   2. previous_archive_id  — rehire link on the role tables (inert until
--                             the Phase 3 returning-employee UI uses it).
--   3. archive_employee_atomic() — insert snapshot + delete the users row
--                             in one transaction. Deleting users cascades
--                             the teachers/drivers row (ON DELETE CASCADE),
--                             teacher_classes, and bus_locations. The
--                             controller still performs the content-
--                             preserving pre-steps (homework/grades/etc.
--                             teacher_id → NULL, student.driver_id → NULL)
--                             in TypeScript before calling this, exactly as
--                             archiveStudent builds its JSONB in TS.

-- ---------------------------------------------------------------------
-- archived_employees
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS archived_employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  original_employee_id UUID,                       -- teachers.id / drivers.id / staff_members.id / users.id (supervisor)
  role TEXT NOT NULL CHECK (role IN ('teacher', 'driver', 'supervisor', 'staff')),
  full_name TEXT NOT NULL,
  date_of_birth DATE,
  age INTEGER,
  phone_number TEXT,
  email TEXT,
  emergency_contact TEXT,
  profile_picture TEXT,
  position TEXT,                                    -- staff position / supervisor title
  subject TEXT,                                     -- teacher: joined subject string
  hire_date DATE,                                   -- proxy: role-row or users created_at
  departure_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('resigned', 'terminated', 'contract_ended', 'retired', 'transferred', 'other')),
  account JSONB DEFAULT '{}',                       -- snapshot of the users row (NO password_hash)
  teaching JSONB DEFAULT '[]',                      -- teacher: classes/subjects taught + authored-content summary
  transport JSONB DEFAULT '{}',                     -- driver: bus, license, vehicle, roster, ride-record stats
  employment JSONB DEFAULT '{}',                    -- staff: salary/insurance config (Phase 2)
  payment_history JSONB DEFAULT '[]',               -- staff: salary payment history (Phase 2)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_archived_employees_school ON archived_employees(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archived_employees_role ON archived_employees(school_id, role);

-- ---------------------------------------------------------------------
-- Rehire links (Phase 3 UI; inert now). ON DELETE SET NULL so purging an
-- archive row never blocks or cascades into a live employee.
-- ---------------------------------------------------------------------
ALTER TABLE teachers       ADD COLUMN IF NOT EXISTS previous_archive_id UUID REFERENCES archived_employees(id) ON DELETE SET NULL;
ALTER TABLE drivers        ADD COLUMN IF NOT EXISTS previous_archive_id UUID REFERENCES archived_employees(id) ON DELETE SET NULL;
ALTER TABLE staff_members  ADD COLUMN IF NOT EXISTS previous_archive_id UUID REFERENCES archived_employees(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- archive_employee_atomic — snapshot insert + users-row delete in one tx.
-- Any exception rolls back both. Returns the new archived_employees.id.
-- ---------------------------------------------------------------------
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
  p_payment_history JSONB
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
    account, teaching, transport, employment, payment_history
  ) VALUES (
    p_school_id, p_original_employee_id, p_role, p_full_name, p_date_of_birth, p_age,
    p_phone_number, p_email, p_emergency_contact, p_profile_picture, p_position, p_subject,
    p_hire_date, p_departure_date, p_reason,
    COALESCE(p_account, '{}'::jsonb),
    COALESCE(p_teaching, '[]'::jsonb),
    COALESCE(p_transport, '{}'::jsonb),
    COALESCE(p_employment, '{}'::jsonb),
    COALESCE(p_payment_history, '[]'::jsonb)
  )
  RETURNING id INTO v_archive_id;

  -- Cascades: users → teachers/drivers (ON DELETE CASCADE) → teacher_classes,
  -- bus_locations. Supervisor has no role row; only the users row is removed.
  DELETE FROM users
   WHERE id = p_user_id AND school_id = p_school_id;

  RETURN v_archive_id;
END;
$$;
