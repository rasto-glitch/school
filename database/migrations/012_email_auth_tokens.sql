-- 012_email_auth_tokens.sql
-- Self-service password reset (via email link) and email-change confirmation
-- (via link sent to the NEW address). Both flows use the same shape:
-- generate a cryptographically random token, store only its SHA-256 hash,
-- and burn the row on first use. The raw token only exists in the email
-- link in transit.
--
-- Coexists with the existing admin-mediated reset in password_reset_requests;
-- both paths are user-visible on the login page so users without an email on
-- file aren't stranded.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  requested_ip  TEXT
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id, expires_at DESC);

-- Token must be either fresh (unused, not expired) OR show a use timestamp.
-- We don't add a CHECK here for that — it changes mid-row when used_at is
-- set; the application code is the authority.

CREATE TABLE IF NOT EXISTS email_change_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email     TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_change_tokens_user_idx
  ON email_change_tokens (user_id, expires_at DESC);
