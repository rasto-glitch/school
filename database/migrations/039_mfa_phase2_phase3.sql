-- 039_mfa_phase2_phase3.sql
-- Phase 2 (enforcement + role expansion) + Phase 3 (trusted devices).
--
-- ── Phase 2: enforcement setting ────────────────────────────────────────
-- schools.mfa_required is the per-school toggle for "require MFA on
-- eligible roles". When TRUE, any eligible user (admin/accountant/
-- teacher/supervisor/reception by Phase 2 scope) who hasn't yet enrolled
-- is pushed into a mandatory enrollment flow at next login. The single-
-- admin lockout case is handled by allowing self-enrollment in that
-- flow — no out-of-band admin involvement needed.
--
-- ── Phase 3: trusted devices ────────────────────────────────────────────
-- After a successful MFA verify, the user may opt to "remember this
-- browser for 30 days". We store a sha256 hash of an opaque token; the
-- client persists the raw token (cookie / AsyncStorage) and replays it
-- on subsequent /auth/login requests via X-Trusted-Device. Matching the
-- token to a non-expired, non-revoked row for the SAME user bypasses
-- the MFA prompt for that login.

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS mfa_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS trusted_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  device_label  TEXT,
  user_agent    TEXT,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);

-- Partial index on the hot path: looking up "active trusted devices for
-- this user". Active = non-revoked AND non-expired.
CREATE INDEX IF NOT EXISTS trusted_devices_user_active_idx
  ON trusted_devices (user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;

-- audit_logs widening — log trusted device issuance + revocation.
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
    'user_account',
    'user_mfa',
    -- Phase 3 trusted devices (migration 039)
    'trusted_device'
  )
);
