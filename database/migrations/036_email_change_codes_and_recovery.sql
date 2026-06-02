-- 036_email_change_codes_and_recovery.sql
-- Two related changes:
--
-- 1. email_change_tokens.attempts — switching the email-change confirmation
--    from a 24h link to a 10-min 6-digit code. A 6-digit code has only ~1M
--    possibilities, so we cap wrong-code attempts at 5 per token in addition
--    to the short TTL. The application code increments on each verify call
--    and treats the token as dead at attempt 5.
--
-- 2. account_recovery_tokens — when a user changes their email, the OLD
--    address gets an alert with a recovery link. Clicking the link reverts
--    the email and forces a password reset in one shot.
--
--    The 7-day "anchor" model: the first email change inside a window pins
--    the recovery target to that original address. Subsequent changes in
--    the same window do NOT rotate the anchor — they update the row's
--    latest_email (for the alert body) and re-send the alert to the same
--    anchor address. This means a chain like A -> B -> C -> D inside one
--    week still recovers to A with the original token. The attacker cannot
--    suppress alerts or move the recovery target by chaining changes.

ALTER TABLE email_change_tokens
  ADD COLUMN IF NOT EXISTS attempts SMALLINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS account_recovery_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  anchor_email  TEXT NOT NULL,
  latest_email  TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_recovery_tokens_user_active_idx
  ON account_recovery_tokens (user_id, expires_at DESC)
  WHERE used_at IS NULL;
