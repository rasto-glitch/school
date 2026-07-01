-- ============================================================
-- Migration 070 — Schedule 2.0, Phase 3: teacher availability for the
--   auto-generator. Presence of a row = the teacher is NOT available at that
--   (day, period) — days off, blocked periods, part-time windows. The Phase-3
--   solver treats these cells as forbidden for that teacher.
-- Safe to run multiple times (idempotent).
-- ============================================================
CREATE TABLE IF NOT EXISTS teacher_unavailability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  period_index SMALLINT NOT NULL CHECK (period_index >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(teacher_id, day_of_week, period_index)
);
CREATE INDEX IF NOT EXISTS idx_teacher_unavail_school ON teacher_unavailability(school_id);
CREATE INDEX IF NOT EXISTS idx_teacher_unavail_teacher ON teacher_unavailability(teacher_id);
