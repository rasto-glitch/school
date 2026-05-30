-- Migration 030 — student_enrollments (per-year academic progression)
--
-- Background. The legacy `archived_students.classes_attended` JSONB was built
-- by walking the `attendance` table at archive time and grouping by academic
-- year. That field has two structural problems:
--   1. It conflates "classes" with "grades". Students don't attend a basket
--      of arbitrary classes — they're enrolled in one class per year, which
--      sits at a specific grade level. The right unit is the year + grade.
--   2. It's only as good as digital attendance. Schools that don't roll
--      daily attendance get an empty list, even for students who completed
--      multiple years.
--
-- This table fixes both. One row per (student, academic_year) per school,
-- with the grade_level and class name frozen at write time so the historical
-- record stays intact when classes are renamed or deleted. Status records
-- what happened that year — including 'on_leave' for paused students who
-- stay attached to the school but didn't attend a given year.
--
-- Status semantics:
--   enrolled     — currently in progress for this academic year
--   promoted     — finished the year, advanced to the next grade
--   retained     — finished the year, repeated the same grade
--   on_leave     — paused for this year; school holds the slot, no class
--   withdrew     — left mid-year (no completion credit)
--   transferred  — left to another school (incl. the future Scholify
--                  cross-tenant transfer feature)
--   graduated    — completed the final grade
--
-- Progression rule (locked design decision): a student who returns from
-- leave or re-enrols after withdrawal defaults to the grade_level of their
-- last enrollment row, NOT the calendar-projected level. The admin can
-- override at placement time. This is the "completion-based" model.
-- A future school-level setting (`schools.progression_model = 'calendar'`)
-- would change only the default-suggestion logic in the return wizard;
-- the stored data stays model-agnostic. See memory/student-transfer-plan.md
-- and the conversation 2026-05-30 for the locked design.
--
-- Mid-year section change (e.g. moved from 7A to 7B in October) is recorded
-- by UPDATING the same row's class_id + class_name_snapshot — not by
-- inserting a new row. The unique (student_id, academic_year) constraint
-- enforces this.
--
-- Multi-year leave is recorded as ONE row per academic year of leave (the
-- unique constraint forces it). Each year is explicitly accounted for in
-- the timeline.
--
-- FK behaviour:
--   student_id ON DELETE CASCADE — when a student is hard-deleted (no
--     archive feature) or archived (snapshot built into JSONB on
--     archived_students.enrollment_history before delete), the live
--     enrollment history can go with them.
--   class_id ON DELETE SET NULL — deleting a class must not destroy a
--     student's historical year record. class_name_snapshot is the
--     resilient label.

CREATE TABLE IF NOT EXISTS student_enrollments (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id              UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id             UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year          TEXT NOT NULL,                                       -- e.g. '2024-2025'
  class_id               UUID REFERENCES classes(id) ON DELETE SET NULL,      -- NULL for on_leave rows
  class_name_snapshot    TEXT,                                                -- frozen for resilience; NULL for on_leave
  grade_level            TEXT NOT NULL,                                       -- frozen; always known (paused level for on_leave)
  status                 TEXT NOT NULL CHECK (status IN (
                            'enrolled', 'promoted', 'retained',
                            'on_leave', 'withdrew', 'transferred', 'graduated'
                         )),
  started_on             DATE NOT NULL,
  ended_on               DATE,                                                -- NULL while status='enrolled'
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, academic_year)
);

-- Per-student progression read: "give me Ahmed's enrollment history sorted".
CREATE INDEX IF NOT EXISTS idx_student_enrollments_student
  ON student_enrollments(school_id, student_id, academic_year DESC);

-- Year-end promote wizard: "give me all 'enrolled' students for 2024-2025".
CREATE INDEX IF NOT EXISTS idx_student_enrollments_year_status
  ON student_enrollments(school_id, academic_year, status);

-- Class roster reads: "who was in 7A in 2024-2025?".
CREATE INDEX IF NOT EXISTS idx_student_enrollments_class_year
  ON student_enrollments(school_id, class_id, academic_year)
  WHERE class_id IS NOT NULL;

-- updated_at trigger — keep in sync on every UPDATE.
CREATE OR REPLACE FUNCTION student_enrollments_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_enrollments_touch ON student_enrollments;
CREATE TRIGGER trg_student_enrollments_touch
  BEFORE UPDATE ON student_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION student_enrollments_touch_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- Snapshot column on archived_students. The legacy classes_attended column
-- stays for one deploy cycle (dual-write); migration 03X will drop it once
-- all reads have moved to enrollment_history.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE archived_students
  ADD COLUMN IF NOT EXISTS enrollment_history JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN archived_students.enrollment_history IS
  'Frozen per-year academic progression snapshot taken at archive time. '
  'Replaces classes_attended (which is attendance-derived and conflates '
  'classes with grades). Shape: [{academicYear, gradeLevel, classId, '
  'className, status, startedOn, endedOn}].';
