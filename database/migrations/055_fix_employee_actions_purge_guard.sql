-- Migration 055 — actually fix the employee_actions purge guard (054 missed it)
--
-- 054 ran `CREATE OR REPLACE FUNCTION employee_actions_append_only()` — the
-- name migration 029 uses in the repo. But the LIVE database's trigger executes
-- a function named `trg_employee_actions_append_only()` (confirmed by the raised
-- error CONTEXT: "PL/pgSQL function trg_employee_actions_append_only() line 4 at
-- RAISE"). The deployed DB drifted from the repo's 029, so 054 replaced a
-- function the trigger never calls — it had no effect, and deleting a school
-- still hit the unguarded live function and raised 0A000.
--
-- Fix it independent of which name the live function had: detach the trigger,
-- (re)create the guard under the canonical name WITH the purge escape, repoint
-- the trigger at it, and drop the drifted function if present. Every step is
-- idempotent, so this is safe whether the DB drifted or already matched the repo.

-- 1. Detach the trigger so we can rewire functions freely.
DROP TRIGGER IF EXISTS trg_employee_actions_append_only ON employee_actions;

-- 2. Canonical guard — honors app.allow_archive_purge like every other
--    append-only guard (prevent_archive_mutation / *_backups_core_mutation),
--    so delete_school_cascade's privileged purge can pass through.
CREATE OR REPLACE FUNCTION employee_actions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_archive_purge', true) = 'on' THEN
    RETURN NULL;  -- statement-level trigger: return value ignored, delete proceeds
  END IF;
  RAISE EXCEPTION 'employee_actions is append-only (got %)', TG_OP
    USING ERRCODE = '0A000';
END $$;

-- 3. Repoint the trigger at the canonical guard.
CREATE TRIGGER trg_employee_actions_append_only
  BEFORE UPDATE OR DELETE ON employee_actions
  FOR EACH STATEMENT EXECUTE FUNCTION employee_actions_append_only();

-- 4. Remove the drifted live function now that nothing references it.
--    No-op on DBs that already used the canonical name.
DROP FUNCTION IF EXISTS trg_employee_actions_append_only();
