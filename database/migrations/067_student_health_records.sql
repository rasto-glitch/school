-- ============================================================
-- Migration 067 — Student health / clinic records, Phase 1.
--   Clinic-internal medical record per student + a nurse-visit log.
--   Gated by the new `health.manage` admin capability (code-level, in
--   constants/clearance.ts — no DB column). Sensitive free-text fields are
--   field-level encrypted by the app (employeePiiCrypto.ts, EMPLOYEE_PII_KEY)
--   and stored in the *_ct columns as opaque text; structured tags stay
--   plaintext so they remain queryable. No parent-facing surface (v1).
--     1. student_health_profiles — one row per student.
--     2. student_health_visits   — nurse-visit / incident log.
--     3. audit_logs.entity_type  — add 'student_health'.
-- Safe to run multiple times (idempotent).
-- ============================================================

-- ── 1. Per-student medical profile (one row per student) ────────────────────
CREATE TABLE IF NOT EXISTS student_health_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- Structured / plaintext (queryable, displayable).
  blood_type TEXT CHECK (blood_type IN (
    'A+','A-','B+','B-','AB+','AB-','O+','O-','unknown'
  )),
  allergy_tags TEXT[] NOT NULL DEFAULT '{}',
  immunizations JSONB NOT NULL DEFAULT '[]'::jsonb,        -- [{name,date,notes}]
  emergency_contacts JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{name,relationship,phone,altPhone,priority}]
  physician_name TEXT,
  physician_phone TEXT,
  -- Encrypted free-text (vN:iv:ct+tag wire format; opaque to the DB).
  chronic_conditions_ct TEXT,
  medications_ct TEXT,
  dietary_notes_ct TEXT,
  notes_ct TEXT,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_student_health_profiles_lookup
  ON student_health_profiles(school_id, student_id);

-- ── 2. Nurse-visit / incident log (many per student) ────────────────────────
CREATE TABLE IF NOT EXISTS student_health_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category TEXT NOT NULL CHECK (category IN (
    'injury','illness','medication','mental_health','routine','other'
  )),
  temperature_c NUMERIC(4,1),
  -- Encrypted free-text clinical fields.
  complaint_ct TEXT,
  assessment_ct TEXT,
  treatment_ct TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN (
    'returned_to_class','sent_home','referred_external','kept_observation'
  )),
  parent_notified BOOLEAN NOT NULL DEFAULT FALSE,
  parent_notified_at TIMESTAMPTZ,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_student_health_visits_student
  ON student_health_visits(school_id, student_id, visited_at DESC);

-- ── 3. Widen audit_logs.entity_type ─────────────────────────────────────────
-- Add 'student_health' (covers profile + visit writes / decrypted reads).
-- Re-declared as the full current superset (last set in migration 066) so this
-- also heals drift.
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
    'report_card',
    -- Migration 067 — student health / clinic records
    'student_health'
  )
);
