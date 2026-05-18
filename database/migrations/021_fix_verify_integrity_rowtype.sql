-- Migration 021 — fix verify_school_integrity (bug in 019)
--
-- 019's verifier looped with generic RECORD variables and passed them to
-- _canon_*(<table> composite) helpers. PL/pgSQL cannot implicitly cast a
-- `record` to a named row type, so the function raised at call time:
--   ERROR 42846: cannot cast type record to archived_students
--
-- Only the verifier is affected — column adds, hash triggers, and the
-- 019 backfill all succeeded (they use correctly-typed row/alias values),
-- so existing hashes/chain are intact. This just recreates the function
-- with typed %ROWTYPE loop variables. Idempotent / safe to re-run.

CREATE OR REPLACE FUNCTION verify_school_integrity(p_school_id UUID)
RETURNS TABLE(kind TEXT, table_name TEXT, row_id UUID, detail TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  rs       archived_students%ROWTYPE;
  re       archived_employees%ROWTYPE;
  ra       audit_logs%ROWTYPE;
  v_prev   TEXT := 'GENESIS';
  v_expect BIGINT := 0;
BEGIN
  -- archived_students content
  FOR rs IN SELECT * FROM archived_students WHERE school_id = p_school_id LOOP
    IF rs.content_hash IS NULL THEN
      RETURN QUERY SELECT 'unhashed', 'archived_students', rs.id, 'no content_hash (pre-019)';
    ELSIF rs.content_hash <> _sha(_canon_archived_student(rs)) THEN
      RETURN QUERY SELECT 'content_altered', 'archived_students', rs.id, rs.full_name;
    END IF;
  END LOOP;

  -- archived_employees content
  FOR re IN SELECT * FROM archived_employees WHERE school_id = p_school_id LOOP
    IF re.content_hash IS NULL THEN
      RETURN QUERY SELECT 'unhashed', 'archived_employees', re.id, 'no content_hash (pre-019)';
    ELSIF re.content_hash <> _sha(_canon_archived_employee(re)) THEN
      RETURN QUERY SELECT 'content_altered', 'archived_employees', re.id, re.full_name;
    END IF;
  END LOOP;

  -- audit_logs chain (ordered by chain_seq)
  FOR ra IN SELECT * FROM audit_logs WHERE school_id = p_school_id ORDER BY chain_seq LOOP
    v_expect := v_expect + 1;
    IF ra.chain_seq IS NULL OR ra.row_hash IS NULL THEN
      RETURN QUERY SELECT 'unhashed', 'audit_logs', ra.id, 'no chain (pre-019)';
      CONTINUE;
    END IF;
    IF ra.chain_seq <> v_expect THEN
      RETURN QUERY SELECT 'sequence_gap', 'audit_logs', ra.id,
        format('expected seq %s, got %s', v_expect, ra.chain_seq);
      v_expect := ra.chain_seq;
    END IF;
    IF ra.prev_hash <> v_prev THEN
      RETURN QUERY SELECT 'chain_broken', 'audit_logs', ra.id,
        format('prev_hash mismatch at seq %s', ra.chain_seq);
    END IF;
    IF ra.row_hash <> _sha(ra.prev_hash || '|' || _canon_audit(ra)) THEN
      RETURN QUERY SELECT 'content_altered', 'audit_logs', ra.id,
        format('row_hash mismatch at seq %s', ra.chain_seq);
    END IF;
    v_prev := ra.row_hash;
  END LOOP;
END $$;
