-- ============================================================
-- Migration 061 — supervisor→parent meeting invites + reception-assigned admin
-- (Phase D liaison flow).
--   * invited_by        — the supervisor who initiated an invite (NULL for a
--                         normal parent-initiated appointment).
--   * invite_reason     — the supervisor's reason for the meeting (distinct
--                         from the parent's own reason/message).
--   * assigned_admin_id — the admin reception assigns to take the meeting. The
--                         assigned admin sees it in their (read-only) view;
--                         Owners see all. Reception remains the only actor.
--   * status gains 'invited' — a supervisor-created invite the parent has not
--                         completed yet. Lifecycle: invited → (parent completes)
--                         pending → (reception confirms+assigns) approved /
--                         rejected.
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS invite_reason TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS assigned_admin_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Widen the status CHECK to include 'invited'.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'invited'));

CREATE INDEX IF NOT EXISTS idx_appointments_assigned_admin
  ON appointments(school_id, assigned_admin_id)
  WHERE assigned_admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_invited_by
  ON appointments(school_id, invited_by)
  WHERE invited_by IS NOT NULL;
