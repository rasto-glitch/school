-- Migration 048 — must_change_password flag on users.
--
-- Pentest findings #1 + #2 (FINDINGS.md): default passwords (`Parent@123`,
-- `Driver@123`, `Teacher@123`) ship with every account the admin creates
-- via the bulk-upload or single-user-create flows. The defaults never
-- expire and are never rotated, so any account whose user never logs in
-- stays trivially accessible to anyone who knows the username scheme.
--
-- This migration introduces the "force change on first login" pattern.
-- Going forward, every create flow that falls back to a default password
-- sets must_change_password=true on the new row. The login endpoint
-- surfaces the flag; the frontend (web + mobile) redirects the user to
-- a force-change-password screen they can't navigate away from until
-- they pick a real password. The change endpoint rejects defaults so
-- the new password can't itself be `Parent@123`.
--
-- Existing accounts: explicitly left alone. The DEFAULT FALSE on the
-- column applies to every existing row, so no parent / driver / teacher
-- currently using their default gets bounced into the change-password
-- screen on their next login. New accounts created after this migration
-- ships get the proper treatment.
--
-- Idempotent: re-running is a no-op (IF NOT EXISTS on the column).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.must_change_password IS
  'When true, the next successful login forces the user to the change-password screen before any other route is reachable. Cleared by /auth/first-time-change-password.';
