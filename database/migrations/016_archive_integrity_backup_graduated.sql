-- Migration 016 — archive audit Phase B (findings F3, F4, F5)
--
-- F3: archived_students / archived_employees / audit_logs were plain
--     tables the service role could UPDATE/DELETE freely (no
--     tamper-evidence). Add BEFORE UPDATE OR DELETE triggers that RAISE,
--     making them append-only. The only legitimate delete — the
--     feature-off purge and full school deletion — goes through the
--     SECURITY DEFINER purge_school_archive(), which sets a tx-local GUC
--     the trigger honors.
--
-- F4: a school cancelling the archive feature must leave a retained
--     backup (school + provider). archive_backups records each backup
--     file (the file itself lives in Storage). Backups are NOT purged.
--
-- F5: graduated students were never snapshotted (read live, could drift
--     or vanish). They now get a frozen archived_students row with
--     reason='graduated' — widen the reason CHECK.

-- ── F5: graduated reason ──────────────────────────────────────────────
ALTER TABLE archived_students DROP CONSTRAINT IF EXISTS archived_students_reason_check;
ALTER TABLE archived_students
  ADD CONSTRAINT archived_students_reason_check
  CHECK (reason IN ('transferred', 'withdrew', 'graduated'));

-- ── F4: archive_backups ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS archive_backups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pre_purge', 'manual')),
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  byte_size INTEGER,
  student_count INTEGER,
  employee_count INTEGER,
  reason TEXT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_archive_backups_school ON archive_backups(school_id, created_at DESC);

-- ── F3: append-only enforcement ───────────────────────────────────────
-- A tx-local GUC 'app.allow_archive_purge' = 'on' lets the privileged
-- purge path through; everything else is blocked.
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

DROP TRIGGER IF EXISTS trg_archived_students_append_only ON archived_students;
CREATE TRIGGER trg_archived_students_append_only
  BEFORE UPDATE OR DELETE ON archived_students
  FOR EACH ROW EXECUTE FUNCTION prevent_archive_mutation();

DROP TRIGGER IF EXISTS trg_archived_employees_append_only ON archived_employees;
CREATE TRIGGER trg_archived_employees_append_only
  BEFORE UPDATE OR DELETE ON archived_employees
  FOR EACH ROW EXECUTE FUNCTION prevent_archive_mutation();

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_archive_mutation();

-- The one sanctioned delete path. SECURITY DEFINER so it owns the GUC;
-- the GUC is tx-local (set_config(..., true)) so it never leaks. Also
-- used before a full school delete so the schools-FK cascade doesn't trip
-- the append-only triggers. archive_backups is intentionally NOT purged.
CREATE OR REPLACE FUNCTION purge_school_archive(p_school_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM set_config('app.allow_archive_purge', 'on', true);
  DELETE FROM archived_students  WHERE school_id = p_school_id;
  DELETE FROM archived_employees WHERE school_id = p_school_id;
  DELETE FROM students WHERE school_id = p_school_id AND is_graduated = true;
  -- audit_logs is intentionally retained on feature-off (compliance log,
  -- not "historical records"). It is only removed on full school delete.
END;
$$;

-- Full school deletion. The schools-FK cascade would otherwise hit the
-- append-only triggers on audit_logs / archived_* and fail. Setting the
-- tx-local GUC before the cascade lets those cascade-deletes through.
CREATE OR REPLACE FUNCTION delete_school_cascade(p_school_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM set_config('app.allow_archive_purge', 'on', true);
  DELETE FROM schools WHERE id = p_school_id;
END;
$$;
