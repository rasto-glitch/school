-- ============================================================
-- Migration 068 — Schedule 2.0, Phase 1: day skeleton (period/break times),
--   rooms, and subject/room/lock on each lesson.
--     1. schools.schedule_config JSONB — ordered daily skeleton: lesson +
--        break slots with start/end times (SAME skeleton every working day).
--        Empty {} → the backend synthesizes a default from periods_per_day,
--        so existing schools keep working until an admin edits it. Lives
--        outside `features` so editing it never bumps features_version.
--     2. rooms + classes.room_id (home room) — physical rooms/labs so the
--        Phase-3 generator can prevent two lessons sharing a room.
--     3. schedule_assignments gains subject_id (a lesson finally KNOWS its
--        subject instead of inferring it), room_id, and is_locked (the
--        Phase-3 generator preserves manually-pinned lessons). Partial unique
--        index = no room double-booking.
-- Safe to run multiple times (idempotent).
-- ============================================================

-- ── 1. Per-school day skeleton (no features bump) ───────────────────────────
ALTER TABLE schools ADD COLUMN IF NOT EXISTS schedule_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ── 2. Rooms + class home room ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  room_type TEXT CHECK (room_type IN ('classroom','lab','computer','gym','library','other')),
  capacity INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, name)
);
CREATE INDEX IF NOT EXISTS idx_rooms_school ON rooms(school_id);

ALTER TABLE classes ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES rooms(id) ON DELETE SET NULL;

-- ── 3. Enrich each scheduled lesson ─────────────────────────────────────────
ALTER TABLE schedule_assignments ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL;
ALTER TABLE schedule_assignments ADD COLUMN IF NOT EXISTS room_id UUID REFERENCES rooms(id) ON DELETE SET NULL;
ALTER TABLE schedule_assignments ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- No two lessons share a room at the same time (only enforced once a room is set).
CREATE UNIQUE INDEX IF NOT EXISTS uq_schedule_room_slot
  ON schedule_assignments(school_id, room_id, day_of_week, period_index)
  WHERE room_id IS NOT NULL;

-- Backfill subject_id from the curriculum when the (class, teacher) pair maps to
-- exactly ONE subject (unambiguous). Ambiguous pairs stay NULL for the admin to set.
UPDATE schedule_assignments sa
SET subject_id = cst.subject_id
FROM class_subject_teachers cst
WHERE sa.subject_id IS NULL
  AND cst.class_id = sa.class_id
  AND cst.teacher_id = sa.teacher_id
  AND (
    SELECT COUNT(*) FROM class_subject_teachers c2
    WHERE c2.class_id = sa.class_id AND c2.teacher_id = sa.teacher_id
  ) = 1;
