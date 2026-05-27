-- Migration 026 — let student/staff archive proceed past append-only GL lines
--
-- journal_lines.student_id and .staff_id are ON DELETE SET NULL (optional
-- drill-down dimensions), but journal_lines is append-only
-- (prevent_archive_mutation). Deleting a student during archive
-- (archive_student_atomic → DELETE FROM students) makes Postgres run
--     UPDATE journal_lines SET student_id = NULL ...
-- to honour the FK, which the append-only trigger rejected with P0001 —
-- aborting the whole archive (surfaced as a sanitized 500 "Invalid request").
--
-- Fix: allow that ONE narrow mutation — an FK cascade nulling student_id /
-- staff_id on a journal line — while keeping all financial columns immutable.
-- The entry's tamper-evidence hash is unaffected: lines_fingerprint is
-- account:debit:credit:currency and excludes these dimensions.
--
-- NOTE: employee archive can still hit a related wall via
-- journal_entries.posted_by (also append-only AND part of the entry hash);
-- that needs a different fix and is intentionally NOT addressed here.

CREATE OR REPLACE FUNCTION prevent_archive_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_archive_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'journal_lines'
     AND NEW.entry_id    IS NOT DISTINCT FROM OLD.entry_id
     AND NEW.account_id  IS NOT DISTINCT FROM OLD.account_id
     AND NEW.debit       IS NOT DISTINCT FROM OLD.debit
     AND NEW.credit      IS NOT DISTINCT FROM OLD.credit
     AND NEW.currency    IS NOT DISTINCT FROM OLD.currency
     AND NEW.description  IS NOT DISTINCT FROM OLD.description
     AND (NEW.student_id IS NULL OR NEW.student_id IS NOT DISTINCT FROM OLD.student_id)
     AND (NEW.staff_id   IS NULL OR NEW.staff_id   IS NOT DISTINCT FROM OLD.staff_id)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only — % is not permitted', TG_TABLE_NAME, TG_OP
    USING HINT = 'Archive/audit rows are immutable; deletion is only via the feature-off purge.';
END;
$$;
