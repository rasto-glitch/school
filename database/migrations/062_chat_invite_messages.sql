-- ============================================================
-- Migration 062 — in-chat meeting invites (Phase D, chat extension).
-- A supervisor can invite a parent to a meeting from INSIDE their chat thread.
-- The invite is posted as a chat message of type 'invite' that carries a
-- reference to the appointment it created; the parent fills it inline (no
-- redirect) and the card flips to pending. Reuses the appointment lifecycle
-- from migration 061 (invited → pending → approved/rejected).
--   * messages.type gains 'invite'
--   * messages.related_appointment_id — the appointment this invite card tracks;
--     ON DELETE SET NULL so deleting an appointment just turns the card inert.
-- Safe to run multiple times.
-- ============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS related_appointment_id UUID
  REFERENCES appointments(id) ON DELETE SET NULL;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check
  CHECK (type IN ('text', 'image', 'file', 'invite'));

CREATE INDEX IF NOT EXISTS idx_messages_related_appointment
  ON messages(related_appointment_id)
  WHERE related_appointment_id IS NOT NULL;
