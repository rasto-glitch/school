-- Migration 053 — allow step_up_challenges to back login-time email OTP.
--
-- step_up_challenges (migration 051) stores short-lived, hashed, attempt-
-- capped proof codes for sensitive contact changes (action change_phone /
-- change_email). The login-OTP feature (052) reuses this exact store for
-- the EMAIL channel at sign-in — same TTL, attempt cap, and verify path —
-- so we only need to widen the action CHECK to admit 'login_mfa'. Phone
-- login codes ride phone_otp_codes (purpose login_mfa) instead, so no
-- change is needed there.
--
-- Drops whatever CHECK constraint currently guards `action` (by definition,
-- not by assumed name) and re-adds it with the third value, so this is
-- robust to the original auto-generated constraint name and safe to re-run.

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE rel.relname = 'step_up_challenges'
      AND n.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%action%'
  LOOP
    EXECUTE format('ALTER TABLE public.step_up_challenges DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE step_up_challenges
  ADD CONSTRAINT step_up_challenges_action_check
  CHECK (action IN ('change_phone', 'change_email', 'login_mfa'));

COMMENT ON COLUMN step_up_challenges.action IS
  'Which operation the proof authorizes: change_phone / change_email (contact changes, migration 051) or login_mfa (email OTP as a sign-in second factor, migration 052/053). A code minted for one action is never accepted for another.';

-- Verification (run separately; expect the three values):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'step_up_challenges_action_check';
