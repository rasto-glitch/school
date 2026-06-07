-- Migration 042 — make schools.current_academic_year authoritative.
--
-- BACKGROUND
-- ----------
-- HD-4 from the 2026-06 historical-data audit: the column existed and the
-- year-transition wizard wrote to it, but every reader derived "the
-- current academic year" from the September calendar boundary via
-- studentEnrollments#academicYearOf() instead. The wizard's "advance
-- year" step was therefore decorative — flipping schools.current_academic_year
-- didn't change a single writer's behaviour.
--
-- This migration codifies the column (it lived in the live DB without a
-- formal declaration before) and pairs with a backend change in this PR
-- that introduces resolveCurrentAcademicYear(schoolId), which consults
-- the column first and falls back to the Sep boundary when the column
-- is NULL or malformed. The year-transition wizard now actually drives
-- the year readers use.
--
-- That also lets a school override the boundary entirely — useful for
-- schools whose academic year doesn't run Sep→Aug (some schools in the
-- region start in October).
--
-- DEMO-DATA NOTE
-- --------------
-- Per project state (Scholify currently holds only demo data): the
-- backfill just stamps the calendar-derived value into any NULL row.
-- No data-preservation logic needed.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Declare the column (idempotent — it already exists in the live DB
--    but wasn't in schema.sql).
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS current_academic_year TEXT;

-- Soft-validate the shape. We use a CHECK that allows NULL so the column
-- stays nullable for fresh schools that haven't run the wizard yet —
-- resolveCurrentAcademicYear() handles that by falling back to the Sep
-- boundary.
ALTER TABLE schools DROP CONSTRAINT IF EXISTS schools_current_academic_year_shape;
ALTER TABLE schools ADD CONSTRAINT schools_current_academic_year_shape CHECK (
  current_academic_year IS NULL OR current_academic_year ~ '^\d{4}-\d{4}$'
);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Backfill — stamp the September-boundary value on any school that
--    hasn't been through the year-transition wizard yet.
-- ─────────────────────────────────────────────────────────────────────

UPDATE schools
SET current_academic_year = (
  CASE
    WHEN extract(month FROM now() AT TIME ZONE COALESCE(timezone, 'Asia/Baghdad')) >= 9
      THEN format(
        '%s-%s',
        extract(year FROM now() AT TIME ZONE COALESCE(timezone, 'Asia/Baghdad'))::int,
        extract(year FROM now() AT TIME ZONE COALESCE(timezone, 'Asia/Baghdad'))::int + 1
      )
    ELSE format(
      '%s-%s',
      extract(year FROM now() AT TIME ZONE COALESCE(timezone, 'Asia/Baghdad'))::int - 1,
      extract(year FROM now() AT TIME ZONE COALESCE(timezone, 'Asia/Baghdad'))::int
    )
  END
)
WHERE current_academic_year IS NULL;
