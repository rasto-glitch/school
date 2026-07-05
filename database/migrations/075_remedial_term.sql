-- 075: Remedial term (Round Two / خوولی دووەم) foundation — REMEDIAL_TERM_PLAN.md Phase 1.
--
-- 1) terms.kind — 'regular' terms count toward the year average (Round One);
--    at most ONE 'remedial' term per school (the school-named Round Two retake
--    bucket, created/managed ONLY from the dedicated Remedial settings section).
-- 2) remedial_grades — one entry per (student, subject, year, corrected term).
--    Deliberately its OWN table, NOT rows in grades: a student retaking BOTH
--    terms of a subject would collide on grades' identity index
--    idx_grades_identity (072), since both rows would share
--    (student_id, subject, <remedial term name>, academic_year).
--    Total out of 100 = exam_value (teacher-entered, out of the configured
--    exam mark type's max) + carry_value (auto-copied verbatim from the
--    corrected term's grade row; 0 + carry_missing=true when the source mark
--    is absent). Exam/carry mark types and passPercent live in
--    schools.grading_config JSONB (no schema change needed there).

ALTER TABLE terms ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'regular';

DO $$ BEGIN
  ALTER TABLE terms ADD CONSTRAINT terms_kind_check CHECK (kind IN ('regular', 'remedial'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_terms_one_remedial_per_school
  ON terms(school_id) WHERE kind = 'remedial';

CREATE TABLE IF NOT EXISTS remedial_grades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  academic_year TEXT NOT NULL,
  -- grading_period of the REGULAR term this entry corrects.
  for_period TEXT NOT NULL,
  -- Remedial exam result, teacher-entered; NULL until filed.
  exam_value NUMERIC(5,2),
  -- Carried component: mark-type name + value auto-copied from the corrected
  -- term's grade row at pre-build time (never teacher-edited).
  carry_name TEXT,
  carry_value NUMERIC(5,2) NOT NULL DEFAULT 0,
  carry_missing BOOLEAN NOT NULL DEFAULT false,
  -- Same release-gate semantics as grades: parents see nothing until release.
  is_released BOOLEAN NOT NULL DEFAULT false,
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, subject, academic_year, for_period)
);

CREATE INDEX IF NOT EXISTS idx_remedial_grades_school_year
  ON remedial_grades(school_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_remedial_grades_student
  ON remedial_grades(student_id, academic_year);
