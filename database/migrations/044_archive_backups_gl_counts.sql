-- Migration 044 — track GL row counts on archive_backups.
--
-- Closes AC-10 from ACCOUNTANT_AUDIT.md. The archive backup payload
-- (admin self-serve + master pre-purge) is being extended in this PR to
-- include the General Ledger — journal_entries + journal_lines + chart of
-- accounts + payment accounts + historical fee_plans. These two count
-- columns let the master-side verifier confirm the GL arrays parsed
-- with the right cardinality, matching the existing student_count /
-- employee_count pattern.
--
-- Nullable so existing v1 rows stay valid; v2-and-later writers populate
-- both columns at insert time. The verify function treats NULL as
-- "v1 backup, GL counts not tracked" and skips the GL count check.

ALTER TABLE archive_backups
  ADD COLUMN IF NOT EXISTS journal_entry_count INT;

ALTER TABLE archive_backups
  ADD COLUMN IF NOT EXISTS journal_line_count INT;
