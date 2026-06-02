-- 038_user_mfa.sql
-- Phase 1 MFA — opt-in TOTP for admin + accountant roles.
--
-- Encryption at rest: secret_encrypted holds an AES-256-GCM ciphertext
-- produced by the application using a key in process.env.TOTP_ENC_KEY.
-- The key never lives in the DB, so a DB dump alone doesn't expose any
-- user's TOTP secret. We considered pgcrypto with the key threaded
-- through .rpc() calls — same property, more plumbing — and chose
-- Node-side AES for ergonomics. Swap surface is utils/mfa.ts.
--
-- Lifecycle:
--   enrolled_at   — secret generated, QR shown, awaiting first verify
--   confirmed_at  — first TOTP code verified; MFA is now active for login
--   disabled_at   — admin (or self) revoked MFA; row stays for audit
--
-- A user re-enrolling after a disable updates the same row (PK on
-- user_id), bumps enrolled_at, and clears confirmed_at / disabled_at.
--
-- Recovery codes are stored as TEXT[] of sha256 hashes. Burning a code
-- removes its hash from the array. Regenerating replaces the entire
-- array.

CREATE TABLE IF NOT EXISTS user_mfa (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted     BYTEA NOT NULL,
  recovery_codes_hash  TEXT[] NOT NULL DEFAULT '{}',
  enrolled_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at         TIMESTAMPTZ,
  last_used_at         TIMESTAMPTZ,
  disabled_at          TIMESTAMPTZ,
  disabled_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  failed_attempts      SMALLINT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index: hot path is "is MFA active for this user?" — answered
-- by selecting rows where confirmed_at IS NOT NULL AND disabled_at IS NULL.
CREATE INDEX IF NOT EXISTS user_mfa_active_idx
  ON user_mfa (user_id)
  WHERE confirmed_at IS NOT NULL AND disabled_at IS NULL;

-- audit_logs entity_type widening — covers MFA enroll / confirm /
-- disable / regen events written by the new endpoints.
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
    -- MFA Phase 1 (migration 038)
    'user_mfa'
  )
);
