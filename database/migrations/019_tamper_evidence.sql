-- Migration 019 — Phase E-a: cryptographic tamper-evidence (audit finding "a")
--
-- The append-only triggers (migration 016) BLOCK mutation through normal
-- paths but cannot PROVE a row was never altered by something with
-- DB-level access. This adds SHA-256 evidence:
--
--   • archived_students / archived_employees → content_hash (per-row).
--     Any edit to a snapshot field changes the hash → detectable.
--   • audit_logs → a per-school HASH CHAIN (chain_seq + prev_hash +
--     row_hash). Editing, deleting, reordering, or forging an audit row
--     breaks the chain from that point on → detectable.
--
-- Hashing is done in the DB (BEFORE INSERT triggers) so it is
-- path-independent (every controller/RPC insert is covered) and the
-- canonicalisation lives in ONE place, reused by verify_school_integrity().
-- The hash columns are themselves protected by the 016 append-only trigger.
--
-- Backfill of pre-existing rows establishes a baseline as of now (it
-- proves "unaltered since migration 019", not since original archival).
-- Backfill UPDATEs would be blocked by the append-only trigger, so the
-- migration sets the tx-local purge GUC while it runs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Columns ───────────────────────────────────────────────────────────
ALTER TABLE archived_students  ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE archived_employees ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS chain_seq BIGINT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS prev_hash TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS row_hash  TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_logs_chain ON audit_logs(school_id, chain_seq);

-- ── Canonical serialisations (single source of truth) ─────────────────
-- Stable, NULL-safe, delimiter-joined. jsonb::text is deterministic for a
-- given value (jsonb stores normalised/sorted keys).
CREATE OR REPLACE FUNCTION _canon_archived_student(r archived_students) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', 'as.v1',
    r.school_id::text, coalesce(r.original_student_id::text,''),
    coalesce(r.full_name,''), coalesce(r.date_of_birth::text,''),
    coalesce(r.enrollment_date::text,''), coalesce(r.departure_date::text,''),
    coalesce(r.reason,''), coalesce(r.parent_full_name,''), coalesce(r.parent_phone,''),
    coalesce(r.classes_attended::text,'[]'), coalesce(r.grades::text,'[]'),
    coalesce(r.payment_history::text,'[]'), coalesce(r.archived_by::text,''),
    coalesce(r.archived_by_name,''), coalesce(r.archived_by_role,''),
    coalesce(r.original_parent_id::text,''), coalesce(r.snapshot_version::text,'1'),
    coalesce(r.created_at::text,''))
$$;

CREATE OR REPLACE FUNCTION _canon_archived_employee(r archived_employees) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', 'ae.v1',
    r.school_id::text, coalesce(r.original_employee_id::text,''), coalesce(r.role,''),
    coalesce(r.full_name,''), coalesce(r.date_of_birth::text,''), coalesce(r.age::text,''),
    coalesce(r.phone_number,''), coalesce(r.email,''), coalesce(r.emergency_contact,''),
    coalesce(r.profile_picture,''), coalesce(r.position,''), coalesce(r.subject,''),
    coalesce(r.hire_date::text,''), coalesce(r.departure_date::text,''), coalesce(r.reason,''),
    coalesce(r.account::text,'{}'), coalesce(r.teaching::text,'[]'),
    coalesce(r.transport::text,'{}'), coalesce(r.employment::text,'{}'),
    coalesce(r.payment_history::text,'[]'), coalesce(r.archived_by::text,''),
    coalesce(r.archived_by_name,''), coalesce(r.archived_by_role,''),
    coalesce(r.snapshot_version::text,'1'), coalesce(r.created_at::text,''))
$$;

CREATE OR REPLACE FUNCTION _canon_audit(r audit_logs) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', 'al.v1',
    r.chain_seq::text, r.school_id::text, coalesce(r.entity_type,''),
    coalesce(r.entity_id::text,''), coalesce(r.action,''),
    coalesce(r.changes::text,'{}'), coalesce(r.actor_id::text,''),
    coalesce(r.actor_username,''), coalesce(r.actor_role,''),
    coalesce(r.label,''), coalesce(r.reason,''), coalesce(r.created_at::text,''))
$$;

CREATE OR REPLACE FUNCTION _sha(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT encode(digest(coalesce(t,''), 'sha256'), 'hex') $$;

-- ── BEFORE INSERT hash triggers ───────────────────────────────────────
CREATE OR REPLACE FUNCTION hash_archived_student() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.content_hash := _sha(_canon_archived_student(NEW));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION hash_archived_employee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.content_hash := _sha(_canon_archived_employee(NEW));
  RETURN NEW;
END $$;

-- Per-school chain. Advisory xact lock serialises concurrent inserts for
-- the same school so chain_seq / prev_hash never fork.
CREATE OR REPLACE FUNCTION hash_audit_log() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_seq  BIGINT;
  v_prev TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_chain:' || NEW.school_id::text));
  SELECT chain_seq, row_hash INTO v_seq, v_prev
    FROM audit_logs WHERE school_id = NEW.school_id
    ORDER BY chain_seq DESC LIMIT 1;
  NEW.chain_seq := coalesce(v_seq, 0) + 1;
  NEW.prev_hash := coalesce(v_prev, 'GENESIS');
  NEW.row_hash  := _sha(NEW.prev_hash || '|' || _canon_audit(NEW));
  RETURN NEW;
END $$;

-- trg_* names sort AFTER nothing relevant; these are INSERT-only and the
-- 016 append-only triggers are UPDATE/DELETE-only, so no event overlap.
DROP TRIGGER IF EXISTS trg_archived_students_hash ON archived_students;
CREATE TRIGGER trg_archived_students_hash BEFORE INSERT ON archived_students
  FOR EACH ROW EXECUTE FUNCTION hash_archived_student();

DROP TRIGGER IF EXISTS trg_archived_employees_hash ON archived_employees;
CREATE TRIGGER trg_archived_employees_hash BEFORE INSERT ON archived_employees
  FOR EACH ROW EXECUTE FUNCTION hash_archived_employee();

DROP TRIGGER IF EXISTS trg_audit_logs_hash ON audit_logs;
CREATE TRIGGER trg_audit_logs_hash BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION hash_audit_log();

-- ── Integrity verifier (reused by admin + master) ─────────────────────
-- Returns one row per detected problem; empty result = intact.
CREATE OR REPLACE FUNCTION verify_school_integrity(p_school_id UUID)
RETURNS TABLE(kind TEXT, table_name TEXT, row_id UUID, detail TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  r        RECORD;
  v_prev   TEXT := 'GENESIS';
  v_expect BIGINT := 0;
BEGIN
  -- archived_students content
  FOR r IN SELECT * FROM archived_students WHERE school_id = p_school_id LOOP
    IF r.content_hash IS NULL THEN
      RETURN QUERY SELECT 'unhashed', 'archived_students', r.id, 'no content_hash (pre-019)';
    ELSIF r.content_hash <> _sha(_canon_archived_student(r)) THEN
      RETURN QUERY SELECT 'content_altered', 'archived_students', r.id, r.full_name;
    END IF;
  END LOOP;

  -- archived_employees content
  FOR r IN SELECT * FROM archived_employees WHERE school_id = p_school_id LOOP
    IF r.content_hash IS NULL THEN
      RETURN QUERY SELECT 'unhashed', 'archived_employees', r.id, 'no content_hash (pre-019)';
    ELSIF r.content_hash <> _sha(_canon_archived_employee(r)) THEN
      RETURN QUERY SELECT 'content_altered', 'archived_employees', r.id, r.full_name;
    END IF;
  END LOOP;

  -- audit_logs chain (ordered by chain_seq)
  FOR r IN SELECT * FROM audit_logs WHERE school_id = p_school_id ORDER BY chain_seq LOOP
    v_expect := v_expect + 1;
    IF r.chain_seq IS NULL OR r.row_hash IS NULL THEN
      RETURN QUERY SELECT 'unhashed', 'audit_logs', r.id, 'no chain (pre-019)';
      CONTINUE;
    END IF;
    IF r.chain_seq <> v_expect THEN
      RETURN QUERY SELECT 'sequence_gap', 'audit_logs', r.id,
        format('expected seq %s, got %s', v_expect, r.chain_seq);
      v_expect := r.chain_seq;
    END IF;
    IF r.prev_hash <> v_prev THEN
      RETURN QUERY SELECT 'chain_broken', 'audit_logs', r.id,
        format('prev_hash mismatch at seq %s', r.chain_seq);
    END IF;
    IF r.row_hash <> _sha(r.prev_hash || '|' || _canon_audit(r)) THEN
      RETURN QUERY SELECT 'content_altered', 'audit_logs', r.id,
        format('row_hash mismatch at seq %s', r.chain_seq);
    END IF;
    v_prev := r.row_hash;
  END LOOP;
END $$;

-- ── One-time backfill (baseline as of now) ────────────────────────────
-- Append-only trigger (016) blocks these UPDATEs; allow them for this
-- migration session only.
SELECT set_config('app.allow_archive_purge', 'on', false);

UPDATE archived_students  s SET content_hash = _sha(_canon_archived_student(s)) WHERE content_hash IS NULL;
UPDATE archived_employees e SET content_hash = _sha(_canon_archived_employee(e)) WHERE content_hash IS NULL;

DO $$
DECLARE
  sch  UUID;
  r    RECORD;
  rec  audit_logs%ROWTYPE;
  v_seq  BIGINT;
  v_prev TEXT;
BEGIN
  FOR sch IN SELECT DISTINCT school_id FROM audit_logs WHERE chain_seq IS NULL LOOP
    v_seq := 0; v_prev := 'GENESIS';
    FOR r IN SELECT id FROM audit_logs WHERE school_id = sch
             ORDER BY created_at, id LOOP
      v_seq := v_seq + 1;
      -- 1) assign sequence + prev pointer
      UPDATE audit_logs SET chain_seq = v_seq, prev_hash = v_prev WHERE id = r.id;
      -- 2) hash the row WITH its now-assigned chain_seq/prev_hash
      SELECT * INTO rec FROM audit_logs WHERE id = r.id;
      UPDATE audit_logs SET row_hash = _sha(rec.prev_hash || '|' || _canon_audit(rec))
        WHERE id = r.id;
      SELECT row_hash INTO v_prev FROM audit_logs WHERE id = r.id;
    END LOOP;
  END LOOP;
END $$;

SELECT set_config('app.allow_archive_purge', 'off', false);
