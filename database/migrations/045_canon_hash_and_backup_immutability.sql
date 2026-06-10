-- Migration 045 — tighten tamper-evidence (HD-2 + HD-9 from HISTORICAL_DATA_AUDIT.md).
--
-- HD-2: The canonical form of archived_students was bumped to `as.v2` in
-- migration 041 (added `reports`) but still does NOT cover two JSONB / FK
-- columns added by later migrations:
--   * enrollment_history (migration 031) — per-year academic history.
--   * transfer_id        (migration 033) — link to the cross-school transfer.
-- If either is silently UPDATEd (bypassing the append-only trigger via the
-- GUC, or by direct DB access), the row hash does NOT change and
-- verify_school_integrity() still reports "intact." This migration
-- re-includes both fields and bumps the version tag to `as.v3`.
--
-- HD-9: archive_backups has no append-only trigger. The table IS mutated
-- after insert (the nightly backupVerify sweep stamps verify_status /
-- verified_at / verify_detail), so a blanket prevent_archive_mutation is
-- wrong. Instead this migration installs a SELECTIVE trigger: verify_*
-- columns may change at will; every other column is frozen post-insert
-- unless the standard `app.allow_archive_purge='on'` GUC is set.
--
-- DEMO-DATA NOTE — Scholify currently has only demo data
-- ([[scholify-demo-data-only]]). The hash backfill rewrites every archive
-- row's content_hash to the new canonical form; demo rows lose their
-- existing v2 hash. That's expected and matches the migration-041
-- precedent.

-- ─────────────────────────────────────────────────────────────────────
-- HD-2 — bump archived_students canonical form to as.v3
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _canon_archived_student(r archived_students) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', 'as.v3',
    r.school_id::text, coalesce(r.original_student_id::text,''),
    coalesce(r.full_name,''), coalesce(r.date_of_birth::text,''),
    coalesce(r.enrollment_date::text,''), coalesce(r.departure_date::text,''),
    coalesce(r.reason,''), coalesce(r.parent_full_name,''), coalesce(r.parent_phone,''),
    coalesce(r.classes_attended::text,'[]'),
    coalesce(r.enrollment_history::text,'[]'),     -- new in v3 (was missing since 031)
    coalesce(r.grades::text,'[]'),
    coalesce(r.payment_history::text,'[]'),
    coalesce(r.reports::text,'[]'),
    coalesce(r.transfer_id::text,''),              -- new in v3 (was missing since 033)
    coalesce(r.archived_by::text,''),
    coalesce(r.archived_by_name,''), coalesce(r.archived_by_role,''),
    coalesce(r.original_parent_id::text,''), coalesce(r.snapshot_version::text,'1'),
    coalesce(r.created_at::text,''))
$$;

-- Re-hash every existing archive row under the new canonical form. The
-- append-only trigger from migration 016 blocks UPDATEs by default — flip
-- the GUC for this migration session only.
SELECT set_config('app.allow_archive_purge', 'on', false);

UPDATE archived_students s
   SET content_hash = _sha(_canon_archived_student(s));

SELECT set_config('app.allow_archive_purge', 'off', false);

-- ─────────────────────────────────────────────────────────────────────
-- HD-9 — selective append-only trigger on archive_backups
-- ─────────────────────────────────────────────────────────────────────
-- archive_backups has three columns that are intentionally mutable post
-- insert (the nightly backup-verify sweep stamps them):
--   verify_status, verified_at, verify_detail
-- Every other column is the durable record of "what was backed up where,
-- and what hash should it match." Mutating storage_path / sha256 /
-- *_count after the fact would let someone silently re-point a backup row
-- at a different file and have it pass verification on the next pass.
-- This trigger blocks that.

CREATE OR REPLACE FUNCTION prevent_archive_backups_core_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Same purge override as the other append-only tables, so
  -- delete_school_cascade still works when a tenant is removed.
  IF current_setting('app.allow_archive_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'archive_backups is append-only — DELETE is not permitted';
  END IF;

  -- UPDATE: only the verify_* columns may change.
  IF NEW.school_id        IS DISTINCT FROM OLD.school_id
     OR NEW.kind            IS DISTINCT FROM OLD.kind
     OR NEW.storage_bucket  IS DISTINCT FROM OLD.storage_bucket
     OR NEW.storage_path    IS DISTINCT FROM OLD.storage_path
     OR NEW.byte_size       IS DISTINCT FROM OLD.byte_size
     OR NEW.student_count   IS DISTINCT FROM OLD.student_count
     OR NEW.employee_count  IS DISTINCT FROM OLD.employee_count
     OR NEW.journal_entry_count IS DISTINCT FROM OLD.journal_entry_count
     OR NEW.journal_line_count  IS DISTINCT FROM OLD.journal_line_count
     OR NEW.reason          IS DISTINCT FROM OLD.reason
     OR NEW.created_by_name IS DISTINCT FROM OLD.created_by_name
     OR NEW.sha256          IS DISTINCT FROM OLD.sha256
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'archive_backups core fields are immutable — only verify_status / verified_at / verify_detail may change after insert';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_archive_backups_append_only ON archive_backups;
CREATE TRIGGER trg_archive_backups_append_only
  BEFORE UPDATE OR DELETE ON archive_backups
  FOR EACH ROW EXECUTE FUNCTION prevent_archive_backups_core_mutation();
