-- Migration 034 — Scholify↔Scholify transfer support (phase B prep)
--
-- Migration 032 shipped phase A: source-side wizard producing a signed
-- bundle the parent walks to a non-Scholify destination. Phase B adds the
-- Scholify destination path: source picks a Scholify school from the
-- directory, the bundle goes into the destination's "Incoming" inbox,
-- destination admin accepts (which inserts the student under the
-- destination's school_id), then the source archives.
--
-- Why this works without the master.elkurdi.co identity DB: this product
-- is one Supabase with `school_id` partitioning, not one Supabase per
-- school. So "cross-tenant" is logically cross-school in the same DB —
-- the application + explicit school_id authorisation are the trust
-- authority. The identity DB will later add platform-wide STU_*
-- identifiers + cross-school dedup, but those don't gate the transfer
-- mechanic itself.
--
-- New state machine (still enforced in the CHECK):
--
--   pending_consent → consented → bundle_generated → … → completed
--                                                 \                ↗
--                                          (non_scholify) ────────╯
--                                                 \
--                                          (scholify)
--                                                  ↘
--                                              awaiting_destination
--                                                  ↙        ↘
--                                  destination_rejected   destination_imported
--                                                  ↙                  ↘
--                                          (re-send / cancel)      completed
--                                   cancelled (terminal, from any prior state)

-- ── 1. Expand the status CHECK ──────────────────────────────────────────
-- Drop + re-add with the new vocabulary. Idempotent.

ALTER TABLE student_transfers DROP CONSTRAINT IF EXISTS student_transfers_status_check;
ALTER TABLE student_transfers
  ADD CONSTRAINT student_transfers_status_check
  CHECK (status IN (
    'pending_consent', 'consented', 'bundle_generated',
    'awaiting_destination', 'destination_imported', 'destination_rejected',
    'completed', 'cancelled'
  ));

-- ── 2. Destination columns ──────────────────────────────────────────────
-- destination_school_id is the addressing field for Scholify destinations.
-- Nullable so non_scholify rows keep working. ON DELETE SET NULL so a
-- school being removed from the platform doesn't cascade into transfer
-- rows (the row stays as historical record with a null destination).

ALTER TABLE student_transfers
  ADD COLUMN IF NOT EXISTS destination_school_id UUID
    REFERENCES schools(id) ON DELETE SET NULL;

-- Destination-side actor refs (FK-less mirror of the source-side pattern).
ALTER TABLE student_transfers ADD COLUMN IF NOT EXISTS destination_admin_id UUID;
ALTER TABLE student_transfers ADD COLUMN IF NOT EXISTS destination_admin_name TEXT;
ALTER TABLE student_transfers ADD COLUMN IF NOT EXISTS destination_admin_role TEXT;

-- Destination-side lifecycle timestamps.
ALTER TABLE student_transfers ADD COLUMN IF NOT EXISTS destination_viewed_at TIMESTAMPTZ;
ALTER TABLE student_transfers ADD COLUMN IF NOT EXISTS destination_accepted_at TIMESTAMPTZ;
ALTER TABLE student_transfers ADD COLUMN IF NOT EXISTS destination_rejected_at TIMESTAMPTZ;
ALTER TABLE student_transfers ADD COLUMN IF NOT EXISTS destination_rejected_reason TEXT;

-- The new student row created at destination on accept. Nullable for
-- non_scholify (no destination student row) and for any state before
-- accept. ON DELETE SET NULL so destination admin can later delete the
-- student without destroying transfer history.
ALTER TABLE student_transfers ADD COLUMN IF NOT EXISTS destination_imported_student_id UUID
  REFERENCES students(id) ON DELETE SET NULL;

-- ── 3. Indexes for inbox queries ───────────────────────────────────────
-- The destination admin's inbox query is:
--   WHERE destination_school_id = $me AND status IN (…)
-- Partial index keeps it tight by skipping non_scholify rows.

CREATE INDEX IF NOT EXISTS idx_student_transfers_destination_inbox
  ON student_transfers(destination_school_id, status, created_at DESC)
  WHERE destination_school_id IS NOT NULL;

-- Lookup by the destination student id (for "where did this kid come
-- from?" queries on the destination side).
CREATE INDEX IF NOT EXISTS idx_student_transfers_destination_student
  ON student_transfers(destination_imported_student_id)
  WHERE destination_imported_student_id IS NOT NULL;

-- ── 4. Cross-tenant column comment ─────────────────────────────────────
-- For future maintainers reading the schema: this is the ONE place where
-- a row is meant to be readable by two different `school_id`s. The
-- application enforces it (source uses school_id; destination uses
-- destination_school_id). RLS, if/when added, will need an OR clause
-- here rather than the usual single-tenant policy.

COMMENT ON TABLE student_transfers IS
  'Cross-school student transfers (migrations 032 + 034). Source admin '
  'authors the row; destination admin reads + mutates it when accepting '
  'or rejecting. school_id is the source; destination_school_id is the '
  'recipient. RLS policies must accept either column as the tenant key.';
