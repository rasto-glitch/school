-- Migration 027 — make append-only tables' outbound refs FK-less
--
-- Append-only tables (guarded by prevent_archive_mutation) cannot tolerate an
-- FK whose ON DELETE action mutates them. Deleting the referenced row forces:
--   • ON DELETE SET NULL  → UPDATE on the append-only row  → P0001 (blocked)
--   • ON DELETE CASCADE   → DELETE on the append-only row  → P0001 (blocked)
-- and for the hashed/chained tables, even allowing it would corrupt the
-- tamper-evidence hash (per-row) or break the chain (audit_logs/journal_entries).
--
-- This was the root cause of the student-archive 500 (journal_lines.student_id,
-- patched narrowly in 026) and ALSO breaks: employee archive / any user delete
-- (journal_entries.posted_by, audit_logs.actor_id, archived_*.archived_by) and
-- deleting a parent with archived children (archived_students.original_parent_id).
--
-- Fix (generalises the GL's existing journal_entries.source_id design): drop the
-- FK constraints and keep the columns as plain UUIDs. The delete no longer
-- touches the append-only row, the stored UUID literal never changes so every
-- hash/chain stays valid, and the text copies already on these tables
-- (actor_username, archived_by_name, parent_full_name, …) preserve readability.
--
-- Also reverts 026's journal_lines trigger exception back to strict immutability
-- (with the FK gone, no cascade reaches journal_lines, so the exception is dead
-- code — and removing it closes a hole where those dimensions could be mutated
-- directly).

-- ── Drop the FK constraints (name-agnostic; columns + data are kept) ──────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT rel.relname AS tbl, con.conname AS con
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND ns.nspname = 'public'
      AND array_length(con.conkey, 1) = 1
      AND (
        (rel.relname = 'journal_entries'    AND att.attname = 'posted_by') OR
        (rel.relname = 'journal_lines'      AND att.attname IN ('student_id','staff_id')) OR
        (rel.relname = 'archived_students'  AND att.attname IN ('archived_by','original_parent_id')) OR
        (rel.relname = 'archived_employees' AND att.attname = 'archived_by') OR
        (rel.relname = 'audit_logs'         AND att.attname = 'actor_id')
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tbl, r.con);
  END LOOP;
END $$;

-- ── Restore strict immutability (supersedes 026's exception) ──────────────
CREATE OR REPLACE FUNCTION prevent_archive_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_archive_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION '% is append-only — % is not permitted', TG_TABLE_NAME, TG_OP
    USING HINT = 'Archive/audit rows are immutable; deletion is only via the feature-off purge.';
END;
$$;
