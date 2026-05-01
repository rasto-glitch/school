-- ============================================================
-- Migration 005 — Structured weekly schedule
-- Replaces the previous "upload an image/PDF" schedule flow.
-- Safe to run multiple times.
-- ============================================================

-- 1. School-level schedule config
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS periods_per_day INT NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS schedule_days TEXT[] NOT NULL DEFAULT
    ARRAY['sunday','monday','tuesday','wednesday','thursday'];

-- 2. Drop the legacy file-upload column (no longer used)
ALTER TABLE schools DROP COLUMN IF EXISTS schedule_url;

-- 3. Per-cell assignment: one row = one teacher, on one day, in one period, teaching one class.
CREATE TABLE IF NOT EXISTS schedule_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  period_index SMALLINT NOT NULL CHECK (period_index >= 1),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- A teacher can only be in one class per (day, period)
  UNIQUE(school_id, teacher_id, day_of_week, period_index),
  -- A class can only have one teacher per (day, period)
  UNIQUE(school_id, class_id, day_of_week, period_index)
);

CREATE INDEX IF NOT EXISTS idx_schedule_assignments_school
  ON schedule_assignments(school_id);
CREATE INDEX IF NOT EXISTS idx_schedule_assignments_teacher
  ON schedule_assignments(school_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_schedule_assignments_class
  ON schedule_assignments(school_id, class_id);
