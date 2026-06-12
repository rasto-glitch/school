-- Migration 049 — Metrics feature foundation.
--
-- Pre-feature scaffolding for the upcoming student & teacher metrics
-- dashboards. The feature itself (writer endpoints, dashboard reads,
-- nightly rollup jobs, materialized metrics tables, UI) is shelved
-- until the WhatsApp-OTP work ships. This migration installs the
-- pieces that are EXPENSIVE to add later — either because they're
-- on populated tables (grades, reports) or because their absence
-- would mean historical data can't be interpreted at metric time.
--
-- Locked design decisions captured here:
--   - school-wide grade scale (single max per school) with per-row
--     snapshot so mid-year scale changes don't break historicals
--   - reports get a generated year_month bucket column now (future
--     UPSERT enforcement of one-per-(student, subject, month) is
--     deferred until the feature ships, because enforcing the UNIQUE
--     constraint today would break teachers who legitimately post
--     multiple reports per month without giving them the UPSERT UX
--     that replaces the duplicate-post error)
--   - behavior tags get a per-school dictionary + an array column on
--     reports (NULL/empty until schools configure their vocabulary;
--     polarity field drives metrics without needing an LLM)
--   - homework_submissions / assignment_completions tables are
--     created empty with v2-ready columns (parent uploads proof +
--     teacher verifies) baked in so v2 ships without a follow-up
--     migration
--   - supporting indexes for the future teacher metric queries are
--     added now so the rollup job doesn't full-scan
--
-- Things intentionally NOT done in this migration (deferred to the
-- feature build):
--   - UNIQUE constraint on reports(school_id, student_id, subject,
--     year_month). Breaks current teacher workflow; ships with the
--     UPSERT UX in the feature build.
--   - assignments.submission_status column is NOT dropped. Keep the
--     dead column so existing reads (mobile AssignmentDetail etc.)
--     don't break. Feature build will switch readers to the new
--     assignment_completions table and the column becomes ignorable.
--   - student_monthly_metrics / teacher_monthly_metrics materialized
--     tables. Empty tables are cheap to add then; nothing to
--     materialize until the completion tables have data.
--   - audit_logs entity_type CHECK extension. The new entity types
--     (homework_submission, assignment_completion, report_behavior_tag)
--     ship in their own small migration alongside the feature
--     controllers so the list stays in sync with what's actually
--     emitted.
--
-- Access-control note for the future feature build:
--   Teacher performance metrics are admin-only. Supervisors do NOT
--   get access. The role gate when endpoints are added is
--     role === 'admin'
--   (HR is currently expressed through the admin role; if an explicit
--   'hr' role is added later, extend the gate.)
--
-- Idempotent: safe to re-run.

-- ============================================================
-- 1. Grade scale infrastructure
-- ============================================================

-- Per-school configured maximum. Default 100 — most KRG schools use
-- /100. Schools using a different scale (e.g. /20) should set this
-- via the future admin settings UI before the metrics feature ships,
-- otherwise their historical grades will be interpreted on /100.
ALTER TABLE schools
  ADD COLUMN IF NOT EXISTS grade_scale_max NUMERIC(5,2) DEFAULT 100;

COMMENT ON COLUMN schools.grade_scale_max IS
  'School-wide raw-to-percentage normalisation factor used by the metrics rollup. A grade row''s percentage equals (grade_value / grade_scale_snapshot) * 100 — using the snapshot, not this live value, so mid-year scale changes do not corrupt historical interpretation.';

-- Snapshotted per grade row at write time. If a school changes its
-- scale mid-year, this column preserves what scale each grade was
-- entered against, so historicals stay interpretable.
ALTER TABLE grades
  ADD COLUMN IF NOT EXISTS grade_scale_snapshot NUMERIC(5,2);

COMMENT ON COLUMN grades.grade_scale_snapshot IS
  'Frozen copy of schools.grade_scale_max at the moment the row was inserted. Read this — not the schools setting — when normalising for metrics.';

-- Backfill existing rows from the school's current setting. Demo data
-- only as of migration date, so this is a small set.
UPDATE grades g
SET grade_scale_snapshot = s.grade_scale_max
FROM schools s
WHERE g.school_id = s.id AND g.grade_scale_snapshot IS NULL;

-- Auto-populate on insert. Trigger fires BEFORE INSERT so the column
-- is set on the row that lands.
CREATE OR REPLACE FUNCTION populate_grade_scale_snapshot()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.grade_scale_snapshot IS NULL THEN
    SELECT grade_scale_max INTO NEW.grade_scale_snapshot
    FROM schools WHERE id = NEW.school_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_grades_scale_snapshot ON grades;
CREATE TRIGGER trg_grades_scale_snapshot
  BEFORE INSERT ON grades
  FOR EACH ROW
  EXECUTE FUNCTION populate_grade_scale_snapshot();

-- ============================================================
-- 2. Reports — monthly bucket column (no UNIQUE constraint yet)
-- ============================================================

-- Generated column derived from report_date. Lets the future UPSERT
-- pattern (one report per student-subject-month) bucket cleanly
-- without on-the-fly date math, and gives us an indexable key now.
--
-- IMMUTABLE expression required by Postgres for generated columns —
-- TO_CHAR(date, format) is STABLE (consults datestyle / lc_time) and
-- gets rejected as "generation expression is not immutable". Composing
-- the YYYY-MM string from EXTRACT + LPAD + || keeps every function
-- IMMUTABLE and produces the same '2026-06' shape.
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS year_month TEXT
  GENERATED ALWAYS AS (
    LPAD(EXTRACT(YEAR  FROM report_date)::text, 4, '0') || '-' ||
    LPAD(EXTRACT(MONTH FROM report_date)::text, 2, '0')
  ) STORED;

-- Student-side metric lookups (parent dashboard, student rollup).
CREATE INDEX IF NOT EXISTS idx_reports_student_yearmonth
  ON reports(school_id, student_id, subject, year_month);

-- Teacher-side metric lookups (teacher performance rollup —
-- "how many reports did teacher X post in YYYY-MM?").
CREATE INDEX IF NOT EXISTS idx_reports_teacher_yearmonth
  ON reports(school_id, teacher_id, year_month)
  WHERE teacher_id IS NOT NULL;

-- ============================================================
-- 3. Behavior tags — per-school dictionary + per-report applied tags
-- ============================================================

-- School-managed vocabulary of behavior labels with polarity. Empty
-- until schools configure it via the future admin UI. Polarity drives
-- the metrics (positive / neutral / negative counts) so sentiment
-- analysis is not required.
CREATE TABLE IF NOT EXISTS report_behavior_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code TEXT NOT NULL,                              -- stable internal key, e.g. 'distracted'
  label_en TEXT NOT NULL,
  label_ar TEXT,
  label_ku TEXT,
  polarity TEXT NOT NULL CHECK (polarity IN ('positive', 'neutral', 'negative')),
  order_index INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, code)
);
CREATE INDEX IF NOT EXISTS idx_report_behavior_tags_school
  ON report_behavior_tags(school_id, is_active, order_index);

COMMENT ON TABLE report_behavior_tags IS
  'School-defined behaviour-tag vocabulary applied to reports.behavior_tag_codes. Empty until the metrics feature ships and admins configure their school''s vocabulary.';

-- Per-report applied tag codes. Optional — defaults to empty array.
-- Teachers will pick tags from the school's dictionary when the
-- feature ships; existing reports get the empty default.
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS behavior_tag_codes TEXT[] DEFAULT '{}';

COMMENT ON COLUMN reports.behavior_tag_codes IS
  'Codes from report_behavior_tags applied to this report. NULL/empty until the metrics feature is enabled and teachers begin tagging.';

-- ============================================================
-- 4. Completion tables (empty until feature ships)
-- ============================================================

-- Per-student per-homework completion record.
--   v1 actor: teacher only marks 'completed'.
--   v2 actors: parent submits → teacher verifies. The columns needed
--   for v2 (verified_at, verified_by_user_id, attachment_url) are
--   added now so v2 ships without a follow-up schema migration.
--
-- The status CHECK constraint already lists all four v1+v2 values so
-- v2 can write 'submitted_by_parent' / 'verified_by_teacher' without
-- altering the constraint.
--
-- Absence of a row implies 'pending' for that (homework, student)
-- pair. The future writer is free to choose eager (insert N pending
-- rows at homework-post time) vs. lazy (insert only when marked)
-- fan-out — both are compatible with this schema.
CREATE TABLE IF NOT EXISTS homework_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  homework_id UUID NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'submitted_by_parent', 'verified_by_teacher')),
  marked_at TIMESTAMPTZ,
  marked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  marked_by_role TEXT,                             -- 'teacher' in v1; 'teacher' or 'parent' in v2
  verified_at TIMESTAMPTZ,                         -- v2: set when teacher verifies parent submission
  verified_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  attachment_url TEXT,                             -- v2: parent's photo / PDF of finished work
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(homework_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_homework_submissions_lookup
  ON homework_submissions(school_id, student_id, status);
CREATE INDEX IF NOT EXISTS idx_homework_submissions_homework
  ON homework_submissions(homework_id);

-- Same shape for assignments. The existing assignments.submission_status
-- column is intentionally NOT dropped — current readers (mobile
-- AssignmentDetail etc.) still resolve it. The feature build switches
-- readers to this table and submission_status becomes dead but harmless.
CREATE TABLE IF NOT EXISTS assignment_completions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'submitted_by_parent', 'verified_by_teacher')),
  marked_at TIMESTAMPTZ,
  marked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  marked_by_role TEXT,
  verified_at TIMESTAMPTZ,
  verified_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  attachment_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_assignment_completions_lookup
  ON assignment_completions(school_id, student_id, status);
CREATE INDEX IF NOT EXISTS idx_assignment_completions_assignment
  ON assignment_completions(assignment_id);

-- ============================================================
-- 5. Supporting indexes for future teacher-performance rollups
-- ============================================================
-- The teacher rollup query shape is "for teacher X in YYYY-MM, count
-- weekly summaries / reports / grade entries / homework / assignments
-- posted". Each of those reads from a different table; without these
-- indexes the rollup full-scans.

CREATE INDEX IF NOT EXISTS idx_weekly_summaries_teacher_week
  ON weekly_summaries(school_id, teacher_id, week_start_date);

CREATE INDEX IF NOT EXISTS idx_homework_teacher_created
  ON homework(school_id, teacher_id, created_at);

CREATE INDEX IF NOT EXISTS idx_assignments_teacher_created
  ON assignments(school_id, teacher_id, created_at);

CREATE INDEX IF NOT EXISTS idx_grades_teacher_created
  ON grades(school_id, teacher_id, created_at);

-- ============================================================
-- 6. Row-level security on the new tables
-- ============================================================
-- Match the rest of the schema: tenant_isolation policy filtering by
-- school_id = app_current_school_id() (the JWT claim), ENABLE + FORCE
-- RLS on each new table. The function app_current_school_id() is
-- defined in schema.sql section "RLS Phase 2 — tenant_isolation
-- helper" and exists in production.
--
-- Idempotent — DROP POLICY IF EXISTS before CREATE, and ENABLE/FORCE
-- are no-ops if already on. Safe to re-run.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'homework_submissions',
    'assignment_completions',
    'report_behavior_tags'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I ' ||
      '  USING      (school_id = app_current_school_id()) ' ||
      '  WITH CHECK (school_id = app_current_school_id())',
      t
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',  t);
  END LOOP;
END $$;

-- Verification (run separately; expect 3 / 3):
--   SELECT count(*) FROM pg_policies
--    WHERE policyname='tenant_isolation' AND schemaname='public'
--      AND tablename IN ('homework_submissions','assignment_completions','report_behavior_tags');
--   SELECT count(*) FROM pg_class
--    WHERE relkind='r' AND relforcerowsecurity = true
--      AND relname IN ('homework_submissions','assignment_completions','report_behavior_tags');
