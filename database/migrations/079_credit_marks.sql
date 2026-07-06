-- ============================================================================
-- Migration 079 — credit marks (نمرەی هاوکاری): school-controlled support marks
-- (CREDIT_MARKS_PLAN.md — locked decisions 2026-07-06)
--
-- Each student has a per-ROUND pool of "support" credit marks (size set per
-- school in grading_config.creditMarks.perRoundPool; 0/absent = feature off).
-- During review the school allocates credits to FAILING subjects only, capped
-- so the effective mark never exceeds the pass mark (47 + 3 → 50, never 51).
-- One pool splits across subjects within the same round.
--
-- Allocations are their own audited rows and NEVER mutate the teacher's raw
-- marks — every grade surface computes effective = raw + credit at read time
-- and prints the split ("50 = 47 + هاوکاری 3") plus a per-round summary
-- (خولی یەکەم / خولی دووەم).
--
--   round = 'round1' → applies to the subject's Round One YEAR average
--                      (the M-3b subject-first mean across regular terms;
--                      lifting it to pass removes the subject from the
--                      remedial roster)
--   round = 'round2' → applies to the subject's remedial (Round Two) total
--
-- Config (no DDL — grading_config JSONB on schools):
--   grading_config.creditMarks = { "perRoundPool": <number> }
--   pass mark reuses the existing grading_config.passPercent (default 50).
-- ============================================================================

CREATE TABLE IF NOT EXISTS grade_credit_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  round TEXT NOT NULL CHECK (round IN ('round1', 'round2')),
  subject TEXT NOT NULL,
  amount NUMERIC(5,2) NOT NULL CHECK (amount > 0),
  note TEXT,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_by_name TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id, academic_year, round, subject)
);

CREATE INDEX IF NOT EXISTS idx_credit_alloc_student
  ON grade_credit_allocations(school_id, student_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_credit_alloc_year
  ON grade_credit_allocations(school_id, academic_year, round);
