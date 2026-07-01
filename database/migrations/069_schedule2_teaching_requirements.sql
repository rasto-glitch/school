-- ============================================================
-- Migration 069 — Schedule 2.0, Phase 2: بەشە وانە (teaching requirements + load).
--   The "demand" side of the timetable, mirroring aSc's lesson cards:
--     1. teachers.max_periods_per_week — the نصاب cap/target for a teacher's
--        weekly teaching load (nullable = no cap set).
--     2. timetable_requirements — one row per (class, subject): "this class
--        needs N periods/week of this subject, taught by this teacher, in this
--        room, with at most max_per_day of it on any single day." This is what
--        the Phase-3 auto-generator will place, and what the manual grid is
--        validated against. Seeded from the curriculum (class_subject_teachers).
-- Safe to run multiple times (idempotent).
-- ============================================================

-- ── 1. Per-teacher weekly load cap (target) ─────────────────────────────────
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS max_periods_per_week INT;

-- ── 2. Teaching requirements (the demand) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS timetable_requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  periods_per_week INT NOT NULL DEFAULT 1 CHECK (periods_per_week >= 0 AND periods_per_week <= 60),
  max_per_day INT NOT NULL DEFAULT 2 CHECK (max_per_day >= 1 AND max_per_day <= 12),
  room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One requirement per (class, subject). class_id already implies the school.
  UNIQUE(class_id, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_ttr_school ON timetable_requirements(school_id);
CREATE INDEX IF NOT EXISTS idx_ttr_class ON timetable_requirements(class_id);
CREATE INDEX IF NOT EXISTS idx_ttr_teacher ON timetable_requirements(teacher_id);

-- Seed from the curriculum: each (class, subject) taught in the school becomes a
-- requirement with a placeholder 1 period/week (the admin then sets the real
-- weekly count). If a (class, subject) has several teachers (team teaching),
-- pick one deterministically (earliest created) — the admin can reassign.
INSERT INTO timetable_requirements (school_id, class_id, subject_id, teacher_id, periods_per_week, max_per_day)
SELECT DISTINCT ON (cst.class_id, cst.subject_id)
  cst.school_id, cst.class_id, cst.subject_id, cst.teacher_id, 1, 2
FROM class_subject_teachers cst
ORDER BY cst.class_id, cst.subject_id, cst.created_at
ON CONFLICT (class_id, subject_id) DO NOTHING;
