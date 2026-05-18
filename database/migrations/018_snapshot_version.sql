-- Migration 018 — archive audit Phase D (finding F10)
--
-- Archive snapshots had no schema/version marker, so a future change to
-- the snapshot JSONB shape couldn't be detected or migrated. Add
-- snapshot_version (default 1) to both archive tables. Existing rows
-- backfill to 1 via the DEFAULT.

ALTER TABLE archived_students  ADD COLUMN IF NOT EXISTS snapshot_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE archived_employees ADD COLUMN IF NOT EXISTS snapshot_version INTEGER NOT NULL DEFAULT 1;
