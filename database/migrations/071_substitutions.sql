-- ============================================================
-- Migration 071 — Schedule 2.0, Phase 4: substitute management.
--   When a teacher is absent (on staff_leave or ad-hoc), the admin covers each
--   of that teacher's lessons for the day with a free, qualified colleague.
--   One row per covered (class, period) on a date.
-- Safe to run multiple times (idempotent).
-- ============================================================
CREATE TABLE IF NOT EXISTS substitutions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  period_index SMALLINT NOT NULL CHECK (period_index >= 1),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  original_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  substitute_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','cancelled')),
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One cover per class-period per date.
  UNIQUE(school_id, date, class_id, period_index)
);
CREATE INDEX IF NOT EXISTS idx_substitutions_school_date ON substitutions(school_id, date);
CREATE INDEX IF NOT EXISTS idx_substitutions_substitute ON substitutions(substitute_teacher_id);
CREATE INDEX IF NOT EXISTS idx_substitutions_original ON substitutions(original_teacher_id);
