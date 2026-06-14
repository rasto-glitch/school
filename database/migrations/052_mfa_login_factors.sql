-- Migration 052 — MFA login-factor registry.
--
-- Today "MFA enrolled" is synonymous with "has a confirmed TOTP secret"
-- (user_mfa, one row per user). There is no notion of WHICH channels a
-- user has armed as a sign-in second factor, nor a preference between
-- them. This migration adds that registry so phone (WhatsApp/SMS OTP) and
-- email OTP can become real login factors alongside TOTP.
--
-- Locked product decisions (owner, 2026-06-14):
--   * Audience: ALL roles may arm a factor (parents/drivers included) —
--     they have no authenticator app, so OTP is exactly their path in.
--   * Email may be armed, but NEVER as the sole factor — it must be paired
--     with phone or TOTP (enforced in the factor-management controller,
--     Phase 2; the registry just records state).
--   * Voluntary per user — no school-policy enforcement engine here.
--
-- Design:
--   * user_mfa stays the TOTP secret + recovery-code vault. This table
--     only records what is armed for sign-in and which is preferred.
--   * TOTP back-compat: a confirmed authenticator is treated as a login
--     factor whether or not a row exists here (the login path folds it in
--     from availability), so pre-052 enrollees keep working untouched. The
--     backfill below seeds their rows so the Phase-2 hub reads consistently.
--   * School-scoped → full tenant_isolation + FORCE RLS, matching
--     step_up_challenges / phone_otp_codes.
--
-- Idempotent: safe to re-run.

-- ============================================================
-- 1. mfa_login_factors — one row per (user, armed factor)
-- ============================================================
CREATE TABLE IF NOT EXISTS mfa_login_factors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Which channel is armed as a login second factor. 'phone' = WhatsApp/SMS
  -- OTP to the verified phone (phone_otp_codes, purpose login_mfa); 'email'
  -- = code to the email on file (step_up_challenges, action login_mfa);
  -- 'totp' = the authenticator secret in user_mfa.
  factor TEXT NOT NULL CHECK (factor IN ('totp', 'phone', 'email')),

  -- Soft-arm lifecycle. disabled_at IS NULL ⇒ currently armed. Disarming
  -- keeps the row for audit rather than deleting it.
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ,

  -- The user's default factor at sign-in. At most one active preferred row
  -- per user (enforced by the partial unique index below).
  is_preferred BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per user per channel; re-arming flips disabled_at back to NULL
  -- instead of inserting a duplicate.
  UNIQUE (user_id, factor)
);

-- Active-factor lookup (the login gate reads this on every password success).
CREATE INDEX IF NOT EXISTS idx_mfa_login_factors_active
  ON mfa_login_factors(user_id)
  WHERE disabled_at IS NULL;

-- At most one preferred *active* factor per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_login_factors_one_preferred
  ON mfa_login_factors(user_id)
  WHERE is_preferred = true AND disabled_at IS NULL;

COMMENT ON TABLE mfa_login_factors IS
  'Registry of login second factors a user has armed (totp / phone / email) + which is preferred. user_mfa remains the TOTP secret vault; this only records sign-in arming state. School-scoped, tenant_isolation + FORCE RLS.';

-- ============================================================
-- 2. Backfill — seed a totp row for existing confirmed enrollees
-- ============================================================
-- Forward-correct so the Phase-2 hub lists their factor; behaviour does
-- not depend on it (the login path folds confirmed TOTP in regardless).
-- Effectively a no-op on the current demo data set.
INSERT INTO mfa_login_factors (school_id, user_id, factor, enabled_at, is_preferred)
SELECT u.school_id, um.user_id, 'totp', COALESCE(um.confirmed_at, NOW()), true
FROM user_mfa um
JOIN users u ON u.id = um.user_id
WHERE um.confirmed_at IS NOT NULL
  AND um.disabled_at IS NULL
ON CONFLICT (user_id, factor) DO NOTHING;

-- ============================================================
-- 3. Row-level security
-- ============================================================
DROP POLICY IF EXISTS tenant_isolation ON mfa_login_factors;
CREATE POLICY tenant_isolation ON mfa_login_factors
  USING      (school_id = app_current_school_id())
  WITH CHECK (school_id = app_current_school_id());
ALTER TABLE mfa_login_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_login_factors FORCE ROW LEVEL SECURITY;

-- Verification (run separately; expect 1 / 1):
--   SELECT count(*) FROM pg_policies
--    WHERE policyname='tenant_isolation' AND schemaname='public'
--      AND tablename='mfa_login_factors';
--   SELECT count(*) FROM pg_class
--    WHERE relkind='r' AND relforcerowsecurity = true
--      AND relname='mfa_login_factors';
