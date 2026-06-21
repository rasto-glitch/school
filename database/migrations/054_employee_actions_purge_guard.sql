-- Migration 054 — let delete_school_cascade purge employee_actions
--
-- BUG: employee_actions (migration 029) is append-only, but its guard
-- employee_actions_append_only() RAISEs on EVERY UPDATE/DELETE
-- unconditionally. Unlike every other append-only guard —
-- prevent_archive_mutation() (016/026/027) and
-- prevent_archive_backups_core_mutation() (045) — it never checks the
-- `app.allow_archive_purge` GUC.
--
-- delete_school_cascade() sets that GUC to 'on' so the privileged purge can
-- cascade through the append-only tables (the comment on the function even
-- names "audit_logs / archived_*" as the triggers it has to get past). Because
-- employee_actions ignored the flag, deleting a school whose employees have any
-- HR-action rows failed: employee_actions.school_id is ON DELETE CASCADE, so the
-- school DELETE cascaded into employee_actions, hit this trigger, RAISEd
-- `0A000 employee_actions is append-only (got DELETE)`, and aborted the whole
-- transaction. The master portal's DELETE /api/schools/:id surfaced that as a
-- 400 (the route passes any RPC error straight through).
--
-- FIX: recreate the function to honour the same break-glass GUC as the other
-- guards. employee_actions stays fully append-only for all normal operations;
-- it only yields to the purge flag that delete_school_cascade (and the archive
-- purge) already set. The trigger itself is unchanged — CREATE OR REPLACE
-- FUNCTION re-points trg_employee_actions_append_only at the new body. It is a
-- STATEMENT-level trigger, so OLD/NEW are unavailable and the return value is
-- ignored; RETURN NULL under the GUC simply lets the statement proceed.

CREATE OR REPLACE FUNCTION employee_actions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Privileged purge path (delete_school_cascade / archive purge): allow it,
  -- matching prevent_archive_mutation() and prevent_archive_backups_core_mutation().
  IF current_setting('app.allow_archive_purge', true) = 'on' THEN
    RETURN NULL;  -- statement-level trigger: return value ignored, delete proceeds
  END IF;
  RAISE EXCEPTION 'employee_actions is append-only (got %)', TG_OP
    USING ERRCODE = '0A000';
END $$;
