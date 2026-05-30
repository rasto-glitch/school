-- Migration 032 — outgoing student transfers (cross-school feature, phase A)
--
-- Phase A scope (locked plan): source-side only — capture parental consent,
-- build a signed bundle (JSON + PDF), and finalise by archiving the student
-- with reason='transferred'. The destination is non-Scholify (free-text
-- school name + contact), so the parent walks the bundle to wherever they
-- want. Scholify↔Scholify push lands in phase B once master.elkurdi.co
-- issues platform-wide student IDs.
--
-- State machine:
--   pending_consent  — wizard opened, awaiting parental consent capture.
--   consented        — consent recorded; bundle not yet generated.
--   bundle_generated — JSON + PDF emitted; archive not yet finalised.
--   completed        — student archived (reason='transferred', transfer_id
--                      stored on archived_students.transfer_id).
--   cancelled        — admin cancelled before completion. Terminal.
-- Forward transitions only (no rollback from completed/cancelled).

CREATE TABLE IF NOT EXISTS student_transfers (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id               UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

  -- Source student. References the LIVE row at wizard time; nullable
  -- afterwards because completion deletes the live row (the snapshot in
  -- archived_students.transfer_id is the durable link going forward).
  student_id              UUID REFERENCES students(id) ON DELETE SET NULL,
  student_name_snapshot   TEXT NOT NULL,                          -- frozen at create

  -- Destination (phase A: free-text). Phase B will add destination_school_id
  -- + destination_tenant for Scholify↔Scholify push.
  destination_kind        TEXT NOT NULL DEFAULT 'non_scholify'
                            CHECK (destination_kind IN ('non_scholify', 'scholify')),
  destination_school_name TEXT NOT NULL,                          -- e.g. "Baghdad International School"
  destination_city        TEXT,
  destination_country     TEXT,
  destination_contact     TEXT,                                   -- email / phone / address

  -- Parental consent (mandatory before bundle generation).
  consent_parent_name     TEXT,
  consent_text_version    TEXT,                                   -- 'v1' etc — lets us evolve the text without losing history
  consent_signed_at       TIMESTAMPTZ,
  consent_witness_name    TEXT,                                   -- admin/staff witnessing the signature
  consent_witness_role    TEXT,
  consent_hash            TEXT,                                   -- SHA-256 of canonical consent input (for tamper evidence)

  -- Bundle artefacts (recorded after generation).
  bundle_signature        TEXT,                                   -- Ed25519 over canonical bundle JSON (hex)
  bundle_sha256           TEXT,                                   -- of canonical bundle JSON (hex)
  bundle_generated_at     TIMESTAMPTZ,
  bundle_format_version   INTEGER NOT NULL DEFAULT 1,             -- schema version for future evolution

  -- Lifecycle.
  status                  TEXT NOT NULL DEFAULT 'pending_consent'
                            CHECK (status IN (
                              'pending_consent', 'consented',
                              'bundle_generated', 'completed', 'cancelled'
                            )),
  cancelled_reason        TEXT,
  completed_at            TIMESTAMPTZ,

  -- Actor refs (FK-less, mirroring the archived_* pattern from migration
  -- 027 so users can be deleted without breaking referential integrity).
  initiated_by            UUID,
  initiated_by_name       TEXT,
  initiated_by_role       TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_transfers_school
  ON student_transfers(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_transfers_status
  ON student_transfers(school_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_transfers_student
  ON student_transfers(student_id) WHERE student_id IS NOT NULL;

-- updated_at trigger.
CREATE OR REPLACE FUNCTION student_transfers_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_transfers_touch ON student_transfers;
CREATE TRIGGER trg_student_transfers_touch
  BEFORE UPDATE ON student_transfers
  FOR EACH ROW
  EXECUTE FUNCTION student_transfers_touch_updated_at();

-- Link the archive row back to the transfer that produced it. The column
-- is added to archived_students but is NOT part of _canon_archived_student
-- (migration 019) — adding it would invalidate every existing content_hash.
-- The tamper-evidence guarantee comes via the append-only trigger plus
-- transfer-side hashes (consent_hash + bundle_sha256 + bundle_signature).
ALTER TABLE archived_students
  ADD COLUMN IF NOT EXISTS transfer_id UUID REFERENCES student_transfers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_archived_students_transfer
  ON archived_students(transfer_id) WHERE transfer_id IS NOT NULL;
