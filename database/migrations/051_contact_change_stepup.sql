-- Migration 051 — Step-up auth for contact changes + phone-change recovery.
--
-- Closes an account-takeover gap: changing an already-verified phone or
-- email is a sensitive operation, but the phone-change flow performed it
-- with no re-authentication and overwrote users.phone_e164 on *send*
-- (before any code was entered). This migration adds the two tables the
-- hardened flow needs. The new policy (locked with the product owner):
--
--   * First-time set (no verified contact on file) stays low-bar:
--     password re-auth + verify the new channel.
--   * Changing an ALREADY-VERIFIED phone/email requires:
--       password (always) + proof of one EXISTING factor, in order of
--       preference: TOTP (if enrolled) → OTP to the OLD phone → OTP to
--       the verified email. Floor (no factor enrolled at all): password
--       + alert + recovery window.
--   * The users.phone_e164 swap is deferred to confirm-time (it rides on
--     the existing phone_otp_codes row for the new number — no new
--     "pending phone" table needed).
--   * On commit, the OLD channel is alerted and a revert token is issued
--     so a hijack is both visible and reversible — mirroring the email
--     account_recovery_tokens mechanism (migration 036).
--
-- Idempotent: safe to re-run.

-- ============================================================
-- 1. step_up_challenges — proof codes for sensitive changes
-- ============================================================
-- A short-lived 6-digit code sent to an EXISTING factor (the OLD phone
-- over WhatsApp/SMS, or the verified email) to prove the caller controls
-- a factor already on the account before we let them change a contact.
-- TOTP proofs need no row here — they're verified inline against the
-- stored authenticator secret.
--
-- Tenant-isolated like phone_otp_codes: every row is school-scoped and
-- RLS is FORCEd. sha256-hashed at rest, short TTL, per-code attempt cap.

CREATE TABLE IF NOT EXISTS step_up_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Which sensitive operation this proof authorizes. A code minted for
  -- change_phone must NOT be accepted to authorize change_email.
  action TEXT NOT NULL CHECK (action IN ('change_phone', 'change_email')),

  -- Where the code was delivered. 'sms' = OTPIQ WhatsApp/SMS to the OLD
  -- verified phone; 'email' = our SMTP to the verified email. TOTP is
  -- never stored here.
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),

  code_hash TEXT NOT NULL,                 -- sha256 hex of the normalised 6-digit code
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Active-proof lookup: open codes only (not consumed). Keyed by the
-- (user, action, channel) triple the verifier filters on.
CREATE INDEX IF NOT EXISTS idx_step_up_challenges_active
  ON step_up_challenges(user_id, action, channel, expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_step_up_challenges_user_recent
  ON step_up_challenges(user_id, created_at DESC);

COMMENT ON TABLE step_up_challenges IS
  'Step-up proof codes for sensitive contact changes (change_phone / change_email). A code proves control of an EXISTING factor (old phone via OTPIQ, or verified email) before a change is allowed. sha256-hashed, short TTL, attempt-capped. TOTP proofs are verified inline and never stored here.';

-- ============================================================
-- 2. phone_recovery_tokens — revert a phone change
-- ============================================================
-- Mirrors account_recovery_tokens (migration 036) for the email side:
-- when a verified phone is changed, the OLD number (and the email on
-- file) get an alert carrying a revert link. Clicking it restores the
-- previous phone + its verified timestamp and signs out every session,
-- so a session-hijack phone swap is reversible by the real owner.
--
-- User-keyed with NO school_id and NO RLS — identical posture to
-- account_recovery_tokens. Touched ONLY by the server via the admin
-- (RLS-bypassing) client, from the public revert endpoint where the
-- token itself is the authorization. The token_hash is the secret.
--
-- Chaining: like the email anchor, the FIRST change in a window pins
-- anchor_phone_e164 to the original good number; chained changes keep
-- that anchor and only rotate the token + latest + expiry, so an
-- attacker cannot move the revert target by changing the number twice.

CREATE TABLE IF NOT EXISTS phone_recovery_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The previous verified phone we revert TO, and the verified timestamp
  -- to restore alongside it. Both NULL only in the degenerate case where
  -- there was no prior verified phone (then no recovery row is written).
  anchor_phone_e164 TEXT,
  anchor_phone_verified_at TIMESTAMPTZ,

  -- The (possibly attacker-set) number we changed TO — recorded so the
  -- alert can name it and audit can show the swap.
  latest_phone_e164 TEXT NOT NULL,

  token_hash TEXT NOT NULL,                -- sha256 hex of the revert token
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS phone_recovery_tokens_user_active_idx
  ON phone_recovery_tokens(user_id, expires_at DESC)
  WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS phone_recovery_tokens_token_idx
  ON phone_recovery_tokens(token_hash);

COMMENT ON TABLE phone_recovery_tokens IS
  'Revert tokens for phone changes — mirror of account_recovery_tokens (email). User-keyed, no school_id, no RLS: touched only by the server admin client from the public revert endpoint where the token IS the auth. Chains to the original number so repeated changes cannot move the revert target.';

-- ============================================================
-- 3. Row-level security
-- ============================================================
-- step_up_challenges is school-scoped → full tenant_isolation + FORCE,
-- matching phone_otp_codes. phone_recovery_tokens intentionally has no
-- RLS (see comment above) — same as account_recovery_tokens.

DROP POLICY IF EXISTS tenant_isolation ON step_up_challenges;
CREATE POLICY tenant_isolation ON step_up_challenges
  USING      (school_id = app_current_school_id())
  WITH CHECK (school_id = app_current_school_id());
ALTER TABLE step_up_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_up_challenges FORCE ROW LEVEL SECURITY;

-- Verification (run separately; expect 1 / 1):
--   SELECT count(*) FROM pg_policies
--    WHERE policyname='tenant_isolation' AND schemaname='public'
--      AND tablename='step_up_challenges';
--   SELECT count(*) FROM pg_class
--    WHERE relkind='r' AND relforcerowsecurity = true
--      AND relname='step_up_challenges';
