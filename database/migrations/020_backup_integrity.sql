-- Migration 020 — Phase E-b: provable backups (audit finding "b")
--
-- "A backup exists" is not "we verified we can restore it". Record a
-- SHA-256 of every backup file and a verification result so storage rot
-- or tampering is detectable. Verification (download → re-hash → parse →
-- count check) runs in the backend (always-on, has Storage access);
-- pg_cron can't reach object storage so it is NOT used here.

ALTER TABLE archive_backups ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE archive_backups ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE archive_backups ADD COLUMN IF NOT EXISTS verify_status TEXT
  NOT NULL DEFAULT 'unverified'
  CHECK (verify_status IN ('unverified', 'verified', 'failed', 'missing'));
ALTER TABLE archive_backups ADD COLUMN IF NOT EXISTS verify_detail TEXT;

CREATE INDEX IF NOT EXISTS idx_archive_backups_verify
  ON archive_backups(verify_status, verified_at);
