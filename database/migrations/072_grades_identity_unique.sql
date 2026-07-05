-- ============================================================
-- Migration 072 — track the grades upsert identity index (audit H-1)
--
-- The teacher grade save (teacher.controller.ts upsertGrade) and the admin
-- xlsx import both upsert with
--   ON CONFLICT (student_id, subject, grading_period, academic_year)
-- which Postgres only accepts when a matching UNIQUE index exists. Prod has
-- one (grades_student_subject_period_year_unique), but it was added
-- out-of-band in the SQL editor and never tracked — so a fresh provision
-- from schema.sql + migrations came up with grade entry broken (42P10).
--
-- This migration records the index with the SAME name and definition as
-- prod: running it on prod is a no-op; running it anywhere else fixes
-- grade entry. Found in the 2026-07-02 functional audit (H-1).
-- ============================================================

-- Dedupe first. No-op on prod (the index has been enforcing uniqueness all
-- along), but an environment that ran without it may hold duplicates that
-- would make the CREATE UNIQUE fail. Keep the newest row per identity.
DELETE FROM grades g
USING grades g2
WHERE g.student_id = g2.student_id
  AND g.subject = g2.subject
  AND g.grading_period IS NOT DISTINCT FROM g2.grading_period
  AND g.academic_year IS NOT DISTINCT FROM g2.academic_year
  AND g.id <> g2.id
  AND (g.created_at, g.id) < (g2.created_at, g2.id);

-- The identity the grade upserts rely on. Columns must stay exactly in sync
-- with the onConflict list in teacher.controller.ts / admin.controller.ts —
-- adding or removing a column here breaks conflict inference.
CREATE UNIQUE INDEX IF NOT EXISTS grades_student_subject_period_year_unique
  ON grades (student_id, subject, grading_period, academic_year);
