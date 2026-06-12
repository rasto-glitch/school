-- Migration 050 — Phone OTP foundation (Stage B + ready for Stages A & C).
--
-- Adds infrastructure for phone-based OTP verification via OTPIQ
-- (WhatsApp) with email fallback through our existing SMTP pipeline.
-- This migration ships the schema for all three planned stages so
-- they don't each need a follow-up migration:
--
--   Stage B (this PR) — verify phone (user-initiated, account settings)
--   Stage C (next)    — forgot-password via phone
--   Stage A (last)    — login MFA via phone (parents/drivers only;
--                       staff stay on TOTP per locked policy)
--
-- Locked design decisions captured here:
--   - One canonical phone per user, on the users table in E.164 form
--     (e.g. +9647501234567). Role-table phone_number columns
--     (parents.phone_number, teachers.phone_number, drivers.phone_number)
--     remain as CONTACT INFO; they are NOT auth-grade and never read
--     by the OTP layer. Auth-grade phone is on users only.
--   - Iraqi numbers only at this stage — CHECK enforces +964 + 10
--     digits. Relaxing to international comes with a separate
--     migration when business need arrives.
--   - 6-digit codes, sha256-hashed at rest (same posture as TOTP
--     recovery codes), 5-minute TTL.
--   - One row per code. Channel lifecycle tracked via timestamp
--     columns (whatsapp_sent_at, whatsapp_delivered_at,
--     whatsapp_failed_at, email_fallback_sent_at) so the orchestrator
--     can answer "did we already try email for this code?" in one row
--     read.
--   - purpose enum carries all three stages now even though only
--     verify_phone is used in Stage B — avoids a CHECK alter later
--     when stages C and A ship.
--   - phone_otp_delivery_events is an ops/debug landing pad for the
--     OTPIQ webhook. Auth decisions NEVER read from it — the
--     orchestrator updates phone_otp_codes directly. The events
--     table exists so we can post-mortem delivery failures.
--   - Both new tables are tenant-isolated. phone_otp_delivery_events
--     allows school_id IS NULL during the webhook landing moment
--     (the webhook arrives without our JWT; admin client back-fills
--     school_id from the linked phone_otp_codes row).
--
-- Idempotent: safe to re-run.

-- ============================================================
-- 1. users.phone_e164 + users.phone_verified_at
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

-- Iraqi mobile format: +964 followed by 10 digits (e.g. +9647501234567).
-- Run in a DO block so a re-run on a DB that already has the constraint
-- is a no-op instead of a duplicate-constraint error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_phone_e164_format'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_phone_e164_format
      CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+964[0-9]{10}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_phone_e164
  ON users(phone_e164) WHERE phone_e164 IS NOT NULL;

COMMENT ON COLUMN users.phone_e164 IS
  'Canonical user phone in E.164 form (e.g. +9647501234567). Used for OTP delivery + verification. Distinct from role-table phone_number columns (parents/teachers/drivers), which are contact-info only and never consulted by the OTP layer.';
COMMENT ON COLUMN users.phone_verified_at IS
  'Timestamp of successful phone OTP verification. NULL until verified. Application code clears this whenever phone_e164 changes — re-verification required after any phone update.';

-- ============================================================
-- 2. phone_otp_codes — outbound OTP records
-- ============================================================
-- One row per generated code. Lifecycle of delivery is tracked by the
-- four timestamp columns rather than a state machine — easier to query
-- ("did email fallback fire?") and easier to audit.

CREATE TABLE IF NOT EXISTS phone_otp_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL,
  code_hash TEXT NOT NULL,                            -- sha256 hex of normalised 6-digit code
  purpose TEXT NOT NULL
    CHECK (purpose IN ('verify_phone', 'forgot_password', 'login_mfa')),

  -- OTPIQ correlation id (their smsId, format 'sms-…'). NULL if the
  -- send was email-only (e.g. WhatsApp send failed before OTPIQ
  -- returned an id and we went straight to email).
  provider_sms_id TEXT,

  -- Channel timestamps. Each transition is a single UPDATE, idempotent.
  whatsapp_sent_at TIMESTAMPTZ,
  whatsapp_delivered_at TIMESTAMPTZ,                  -- from OTPIQ webhook status='delivered'
  whatsapp_failed_at TIMESTAMPTZ,                     -- from OTPIQ webhook status='failed'/'expired'
  email_fallback_sent_at TIMESTAMPTZ,                 -- our SMTP fired

  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_otp_codes_user_purpose_recent
  ON phone_otp_codes(user_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_otp_codes_phone_recent
  ON phone_otp_codes(phone_e164, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_otp_codes_sms_id
  ON phone_otp_codes(provider_sms_id) WHERE provider_sms_id IS NOT NULL;
-- Active-code lookup for verification: open codes only (not consumed,
-- not expired). Partial index keeps it small even when the table grows.
CREATE INDEX IF NOT EXISTS idx_phone_otp_codes_active
  ON phone_otp_codes(user_id, purpose, expires_at)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE phone_otp_codes IS
  'Outbound phone OTP records — one row per generated code. Hashed at rest (sha256). 5-minute TTL. Channel lifecycle (WhatsApp via OTPIQ + email fallback via our SMTP) tracked by per-channel timestamp columns.';

-- ============================================================
-- 3. phone_otp_delivery_events — OTPIQ webhook landing pad
-- ============================================================
-- Append-only log. Auth decisions never read from this table — the
-- webhook controller updates phone_otp_codes directly. This exists for
-- post-mortem debugging and for verifying webhook signature behaviour.

CREATE TABLE IF NOT EXISTS phone_otp_delivery_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Nullable: the webhook arrives without our JWT, and at the moment of
  -- insert the controller may not yet have resolved the linked code.
  -- Back-filled (when possible) from the linked phone_otp_codes row.
  school_id UUID REFERENCES schools(id) ON DELETE CASCADE,
  otp_code_id UUID REFERENCES phone_otp_codes(id) ON DELETE SET NULL,
  provider_sms_id TEXT NOT NULL,
  status TEXT NOT NULL,
  last_channel TEXT,
  payload_json JSONB,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_otp_delivery_events_sms_id
  ON phone_otp_delivery_events(provider_sms_id, received_at DESC);

COMMENT ON TABLE phone_otp_delivery_events IS
  'OTPIQ delivery-webhook landing pad. Append-only. Ops/debug only — auth decisions never read from this table; the orchestrator updates phone_otp_codes directly.';

-- ============================================================
-- 4. Row-level security on the new tables
-- ============================================================
-- Matches the rest of the schema: tenant_isolation policy + ENABLE +
-- FORCE. phone_otp_delivery_events permits NULL school_id rows because
-- the webhook controller (admin client, bypasses RLS) inserts before
-- school_id is resolved.

DROP POLICY IF EXISTS tenant_isolation ON phone_otp_codes;
CREATE POLICY tenant_isolation ON phone_otp_codes
  USING      (school_id = app_current_school_id())
  WITH CHECK (school_id = app_current_school_id());
ALTER TABLE phone_otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_otp_codes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON phone_otp_delivery_events;
CREATE POLICY tenant_isolation ON phone_otp_delivery_events
  USING      (school_id IS NULL OR school_id = app_current_school_id())
  WITH CHECK (school_id IS NULL OR school_id = app_current_school_id());
ALTER TABLE phone_otp_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE phone_otp_delivery_events FORCE ROW LEVEL SECURITY;

-- Verification (run separately; expect 2 / 2):
--   SELECT count(*) FROM pg_policies
--    WHERE policyname='tenant_isolation' AND schemaname='public'
--      AND tablename IN ('phone_otp_codes','phone_otp_delivery_events');
--   SELECT count(*) FROM pg_class
--    WHERE relkind='r' AND relforcerowsecurity = true
--      AND relname IN ('phone_otp_codes','phone_otp_delivery_events');
