-- ============================================================
-- School Management System - Supabase PostgreSQL Schema
-- Run this in Supabase SQL Editor (https://app.supabase.com)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- SCHOOLS
-- ============================================================
CREATE TABLE IF NOT EXISTS schools (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  abbreviation TEXT UNIQUE,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#4F46E5',
  secondary_color TEXT DEFAULT '#06B6D4',
  domain TEXT,
  subscription_plan TEXT DEFAULT 'basic',
  is_active BOOLEAN DEFAULT TRUE,
  periods_per_day INT NOT NULL DEFAULT 6,
  schedule_days TEXT[] NOT NULL DEFAULT ARRAY['sunday','monday','tuesday','wednesday','thursday'],
  features JSONB DEFAULT '{"homework":true,"assignments":true,"announcements":true,"grades":true,"reports":true,"bus_tracking":true,"appointments":true,"attendance":true,"weekly_summary":true,"chat":true,"teacher_report_handoff":true}',
  features_version INTEGER NOT NULL DEFAULT 1,
  tuition_config JSONB DEFAULT '{"currency":"USD","siblingDiscount":{"enabled":false,"type":"percent","tiers":[]}}'::jsonb,
  timezone TEXT NOT NULL DEFAULT 'Asia/Baghdad',
  -- Authoritative academic year (migration 042). Readers consult this
  -- via studentEnrollments#resolveCurrentAcademicYear and fall back to
  -- the Sep calendar boundary when NULL. The year-transition wizard
  -- writes here; admin "School settings → academic year" also writes
  -- here. NULL is allowed for fresh schools.
  current_academic_year TEXT CHECK (
    current_academic_year IS NULL OR current_academic_year ~ '^\d{4}-\d{4}$'
  ),
  chat_restrictions JSONB NOT NULL DEFAULT '{"enabled":false}'::jsonb,
  -- Grading display mode. Lives OUTSIDE `features` so changing it does NOT
  -- bump features_version / force a re-login.
  grading_config JSONB NOT NULL DEFAULT '{"mode":"scale"}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Run this if the table already exists:
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{"homework":true,"assignments":true,"announcements":true,"grades":true,"reports":true,"bus_tracking":true,"appointments":true,"attendance":true,"weekly_summary":true,"chat":true,"teacher_report_handoff":true}';
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS features_version INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Baghdad';
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS chat_restrictions JSONB NOT NULL DEFAULT '{"enabled":false}'::jsonb;
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS grading_config JSONB NOT NULL DEFAULT '{"mode":"scale"}'::jsonb;

-- Trigger: auto-increment features_version whenever the features JSONB column changes
CREATE OR REPLACE FUNCTION increment_features_version()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.features IS DISTINCT FROM OLD.features THEN
    NEW.features_version := OLD.features_version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS schools_features_version_trigger ON schools;
CREATE TRIGGER schools_features_version_trigger
  BEFORE UPDATE ON schools
  FOR EACH ROW EXECUTE FUNCTION increment_features_version();

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  email TEXT,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('parent','teacher','admin','driver','supervisor','reception','accountant')),
  profile_picture TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, username)
);
-- Run this if the table already exists:
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS abbreviation TEXT UNIQUE;
-- UPDATE schools SET abbreviation = UPPER(slug) WHERE abbreviation IS NULL;

-- Employee HR fields (migration 024). Account-only roles (supervisor / admin /
-- reception / accountant) have no profile table, so their HR record lives here.
-- official_photo is the admin-uploaded professional photo, distinct from the
-- self-set app avatar (profile_picture).
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qualifications TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS official_photo TEXT;

-- ============================================================
-- BUSES
-- ============================================================
CREATE TABLE IF NOT EXISTS buses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  bus_number TEXT NOT NULL,
  plate_number TEXT,
  capacity INTEGER DEFAULT 40,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CLASSES
-- ============================================================
CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  grade_level TEXT,
  academic_year TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, name)
);

-- ============================================================
-- WEEKLY SCHEDULE — one row per (teacher, day, period)
-- ============================================================
CREATE TABLE IF NOT EXISTS schedule_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  period_index SMALLINT NOT NULL CHECK (period_index >= 1),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, teacher_id, day_of_week, period_index),
  UNIQUE(school_id, class_id, day_of_week, period_index)
);
CREATE INDEX IF NOT EXISTS idx_schedule_assignments_school ON schedule_assignments(school_id);
CREATE INDEX IF NOT EXISTS idx_schedule_assignments_teacher ON schedule_assignments(school_id, teacher_id);
CREATE INDEX IF NOT EXISTS idx_schedule_assignments_class ON schedule_assignments(school_id, class_id);

-- ============================================================
-- PARENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS parents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone_number TEXT,
  email TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  residence_type TEXT CHECK (residence_type IN ('apartment', 'house')),
  block_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TEACHERS
-- ============================================================
CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone_number TEXT,
  subject TEXT,
  emergency_contact TEXT,
  profile_picture TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Employee HR fields (migration 024). official_photo = admin-uploaded
-- professional photo, distinct from the self-set avatar (profile_picture).
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS qualifications TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS official_photo TEXT;

CREATE TABLE IF NOT EXISTS teacher_classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(teacher_id, class_id)
);

-- ============================================================
-- DRIVERS
-- ============================================================
CREATE TABLE IF NOT EXISTS drivers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone_number TEXT,
  emergency_contact TEXT,
  license_number TEXT,
  bus_id UUID REFERENCES buses(id),
  profile_picture TEXT,
  age INTEGER,
  excluded_student_ids UUID[] DEFAULT '{}',
  vehicle_type TEXT CHECK (vehicle_type IN ('bus', 'taxi')) DEFAULT 'bus',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Run this if the table already exists:
-- ALTER TABLE drivers ADD COLUMN IF NOT EXISTS excluded_student_ids UUID[] DEFAULT '{}';
-- ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_type TEXT CHECK (vehicle_type IN ('bus', 'taxi')) DEFAULT 'bus';

-- Employee HR fields (migration 024). official_photo = admin-uploaded
-- professional photo, distinct from the self-set avatar (profile_picture).
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS qualifications TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS official_photo TEXT;

-- ============================================================
-- STUDENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  date_of_birth DATE,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  parent_id UUID REFERENCES parents(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES drivers(id) ON DELETE SET NULL,
  home_address TEXT,
  home_latitude DOUBLE PRECISION,
  home_longitude DOUBLE PRECISION,
  emergency_contact TEXT,
  phone_number TEXT,
  profile_picture TEXT,
  is_graduated BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- STUDENT ENROLLMENTS — per-year academic progression
-- (see migration 030). One row per (student, academic_year). Replaces
-- the attendance-derived `classes_attended` snapshot on archived_students
-- with a first-class history of grade-level progression and outcome.
-- ============================================================
CREATE TABLE IF NOT EXISTS student_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  class_name_snapshot TEXT,                      -- frozen for resilience; NULL for on_leave
  grade_level TEXT NOT NULL,                     -- frozen; always known (paused level for on_leave)
  status TEXT NOT NULL CHECK (status IN (
    'enrolled', 'promoted', 'retained',
    'on_leave', 'withdrew', 'transferred', 'graduated'
  )),
  started_on DATE NOT NULL,
  ended_on DATE,                                 -- NULL while status='enrolled'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, academic_year)
);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_student
  ON student_enrollments(school_id, student_id, academic_year DESC);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_year_status
  ON student_enrollments(school_id, academic_year, status);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_class_year
  ON student_enrollments(school_id, class_id, academic_year)
  WHERE class_id IS NOT NULL;

-- ============================================================
-- STUDENT TRANSFERS — outgoing cross-school transfer wizard
-- (see migration 032). One row per transfer initiation. Drives the
-- consent-capture + signed-bundle-export flow that produces a JSON +
-- PDF pack the parent walks to a non-Scholify destination. Phase B
-- (Scholify↔Scholify push) will add destination_school_id +
-- destination_tenant fields once master.elkurdi.co identity DB lands.
-- ============================================================
CREATE TABLE IF NOT EXISTS student_transfers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  student_name_snapshot TEXT NOT NULL,
  destination_kind TEXT NOT NULL DEFAULT 'non_scholify'
    CHECK (destination_kind IN ('non_scholify', 'scholify')),
  destination_school_name TEXT NOT NULL,
  destination_city TEXT,
  destination_country TEXT,
  destination_contact TEXT,
  -- Migration 034: addressing for Scholify destinations (the recipient
  -- school in this same Supabase). NULL for non_scholify rows.
  destination_school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
  destination_admin_id UUID,
  destination_admin_name TEXT,
  destination_admin_role TEXT,
  destination_viewed_at TIMESTAMPTZ,
  destination_accepted_at TIMESTAMPTZ,
  destination_rejected_at TIMESTAMPTZ,
  destination_rejected_reason TEXT,
  destination_imported_student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  consent_parent_name TEXT,
  consent_text_version TEXT,
  consent_signed_at TIMESTAMPTZ,
  consent_witness_name TEXT,
  consent_witness_role TEXT,
  consent_hash TEXT,
  bundle_signature TEXT,
  bundle_sha256 TEXT,
  bundle_generated_at TIMESTAMPTZ,
  bundle_format_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending_consent'
    CHECK (status IN (
      'pending_consent', 'consented', 'bundle_generated',
      'awaiting_destination', 'destination_imported', 'destination_rejected',
      'completed', 'cancelled'
    )),
  cancelled_reason TEXT,
  completed_at TIMESTAMPTZ,
  initiated_by UUID,
  initiated_by_name TEXT,
  initiated_by_role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_student_transfers_school
  ON student_transfers(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_transfers_status
  ON student_transfers(school_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_transfers_student
  ON student_transfers(student_id) WHERE student_id IS NOT NULL;
-- Migration 034: inbox query at destination + reverse lookup by imported student.
CREATE INDEX IF NOT EXISTS idx_student_transfers_destination_inbox
  ON student_transfers(destination_school_id, status, created_at DESC)
  WHERE destination_school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_student_transfers_destination_student
  ON student_transfers(destination_imported_student_id)
  WHERE destination_imported_student_id IS NOT NULL;

-- ============================================================
-- HOMEWORK
-- ============================================================
CREATE TABLE IF NOT EXISTS homework (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  attachment_url TEXT,
  due_date DATE,
  subject TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ASSIGNMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  grade NUMERIC(5,2),
  submission_status TEXT DEFAULT 'pending' CHECK (submission_status IN ('pending','submitted','graded')),
  due_date DATE,
  subject TEXT,
  attachment_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MARK TYPES (admin-defined per school)
-- ============================================================
CREATE TABLE IF NOT EXISTS mark_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'both' CHECK (applies_to IN ('report', 'grade', 'both')),
  -- Optional "out of" value. NULL = legacy behavior (subject total is the raw
  -- sum, assumed to be a percentage). When set, a subject's percentage is
  -- sum(values) / sum(maxes) * 100 — which is also what GPA grading needs.
  max_value NUMERIC(6,2),
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Run if table already exists:
-- ALTER TABLE mark_types ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;
-- ALTER TABLE mark_types ADD COLUMN IF NOT EXISTS max_value NUMERIC(6,2);

-- ============================================================
-- GPA GRADING (per-school, optional — layered on top of scale grading)
-- grading_config.mode ∈ 'scale' (default, % only) | 'gpa' | 'both'.
-- grade_scale_bands maps a percentage to a letter + grade point.
-- ============================================================
CREATE TABLE IF NOT EXISTS grade_scale_bands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  min_percent NUMERIC(5,2) NOT NULL,   -- band applies when percentage >= this
  letter TEXT NOT NULL,                 -- "A", "B+", ...
  grade_point NUMERIC(4,2) NOT NULL,    -- 4.0, 3.3, ...
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grade_scale_bands_school ON grade_scale_bands(school_id, order_index);

-- ============================================================
-- TERMS (admin-defined per school — used as grading_period dropdown)
-- ============================================================
CREATE TABLE IF NOT EXISTS terms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, name)
);
CREATE INDEX IF NOT EXISTS idx_terms_school ON terms(school_id, order_index);

-- ============================================================
-- GRADES
-- ============================================================
CREATE TABLE IF NOT EXISTS grades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  daily_grade NUMERIC(5,2) DEFAULT 0,
  quiz_grade NUMERIC(5,2) DEFAULT 0,
  monthly_exam_grade NUMERIC(5,2) DEFAULT 0,
  term_exam_grade NUMERIC(5,2) DEFAULT 0,
  marks JSONB DEFAULT '[]',
  grading_period TEXT,
  academic_year TEXT,
  -- Release gate: teacher-entered grades are NOT visible to parents until an
  -- admin releases them. Any teacher (re)write resets is_released to false, so
  -- an edit of an already-released grade goes back through review.
  is_released BOOLEAN NOT NULL DEFAULT false,
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES users(id),
  -- Admin-only note. Written during review; visible to parents on release
  -- (only when non-empty). Teachers do not see it.
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Run if table already exists:
-- ALTER TABLE grades ADD COLUMN IF NOT EXISTS marks JSONB DEFAULT '[]';
-- ALTER TABLE grades ADD COLUMN IF NOT EXISTS is_released BOOLEAN NOT NULL DEFAULT false;
-- ALTER TABLE grades ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
-- ALTER TABLE grades ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES users(id);
-- ALTER TABLE grades ADD COLUMN IF NOT EXISTS admin_note TEXT;
-- Don't retroactively hide grades parents already see:
-- UPDATE grades SET is_released = true WHERE is_released = false;

-- ============================================================
-- REPORTS
-- ============================================================
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  attendance_notes TEXT,
  behavior_notes TEXT,
  quiz_marks NUMERIC(5,2),
  exam_marks NUMERIC(5,2),
  marks JSONB DEFAULT '[]',
  teacher_notes TEXT,
  report_date DATE DEFAULT CURRENT_DATE,
  -- Migration 041 — reports become durable year-organized history.
  -- academic_year is stamped from academicYearOf() (Sep boundary), NOT
  -- from schools.current_academic_year (which is purely informational).
  -- class_name_snapshot survives class rename/delete.
  -- teacher_name_snapshot survives teacher delete/archive.
  -- shared_with_other_teachers powers the PR 2 cross-subject handoff toggle.
  academic_year TEXT NOT NULL,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  class_name_snapshot TEXT,
  teacher_name_snapshot TEXT,
  shared_with_other_teachers BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reports_student_year
  ON reports(student_id, academic_year DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_school_year
  ON reports(school_id, academic_year);
-- Run if table already exists:
-- ALTER TABLE reports ADD COLUMN IF NOT EXISTS marks JSONB DEFAULT '[]';

-- ============================================================
-- ANNOUNCEMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  image_url TEXT,
  link_url TEXT,
  attachment_url TEXT,
  target_audience TEXT DEFAULT 'all' CHECK (target_audience IN ('all','parents','teachers','students')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Announcement social: likes, comments, comment-likes (mirrors post_* tables)
CREATE TABLE IF NOT EXISTS announcement_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_likes_announcement ON announcement_likes(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_likes_user ON announcement_likes(user_id);

CREATE TABLE IF NOT EXISTS announcement_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES announcement_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_announcement_comments_announcement ON announcement_comments(announcement_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_announcement_comments_parent ON announcement_comments(parent_id);

CREATE TABLE IF NOT EXISTS announcement_comment_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES announcement_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcement_comment_likes_comment ON announcement_comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_announcement_comment_likes_user ON announcement_comment_likes(user_id);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  notification_type TEXT DEFAULT 'general' CHECK (notification_type IN ('homework','assignment','announcement','bus','grade','grade_pending','general','system','report','appointment','post','payment_recorded','fees_reminder','salary_due_soon','salary_paid')),
  related_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BUS LOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS bus_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  bus_id UUID REFERENCES buses(id),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed DOUBLE PRECISION DEFAULT 0,
  heading DOUBLE PRECISION DEFAULT 0,
  is_driving BOOLEAN DEFAULT TRUE,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- APPOINTMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  student_ids UUID[] DEFAULT '{}',
  reason TEXT,
  message TEXT,
  requested_date DATE,
  response_message TEXT,
  scheduled_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WEEKLY SUMMARIES
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  unit TEXT,
  lesson TEXT,
  pages TEXT,
  homework_reminder TEXT,
  week_start_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WEEKLY SUMMARY PERIODS (supervisor-controlled submission windows)
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_summary_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_weekly_summary_periods_school ON weekly_summary_periods(school_id);

-- ============================================================
-- SUBJECTS (school-defined subject list)
-- ============================================================
CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,  -- legacy "primary teacher" pointer; subject_teachers is the source of truth
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, name)
);

-- Many-to-many: a subject can be taught by several teachers, a teacher can teach several subjects.
CREATE TABLE IF NOT EXISTS subject_teachers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subject_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS idx_subject_teachers_subject ON subject_teachers(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_teachers_teacher ON subject_teachers(teacher_id);

-- Backfill the join table from the legacy single-teacher column (safe to re-run).
INSERT INTO subject_teachers (school_id, subject_id, teacher_id)
SELECT school_id, id, teacher_id FROM subjects WHERE teacher_id IS NOT NULL
ON CONFLICT (subject_id, teacher_id) DO NOTHING;

-- Per-class curriculum: "teacher T teaches subject S to class C". This is the fine-grained
-- source of truth; subject_teachers / teachers.subject / subjects.teacher_id are caches
-- recomputed from it (see admin.controller helpers).
CREATE TABLE IF NOT EXISTS class_subject_teachers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(class_id, subject_id, teacher_id)
);
CREATE INDEX IF NOT EXISTS idx_cst_class ON class_subject_teachers(class_id);
CREATE INDEX IF NOT EXISTS idx_cst_teacher ON class_subject_teachers(teacher_id);
CREATE INDEX IF NOT EXISTS idx_cst_subject ON class_subject_teachers(subject_id);

-- Backfill: each existing teacher↔subject link applies to every class that teacher is on.
-- (Teachers with no teacher_classes rows get nothing here — fill them in via the Curriculum UI.)
INSERT INTO class_subject_teachers (school_id, class_id, subject_id, teacher_id)
SELECT st.school_id, tc.class_id, st.subject_id, st.teacher_id
FROM subject_teachers st
JOIN teacher_classes tc ON tc.teacher_id = st.teacher_id
ON CONFLICT (class_id, subject_id, teacher_id) DO NOTHING;

-- ============================================================
-- ATTENDANCE
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, class_id, date)
);

-- ============================================================
-- PASSWORD RESET REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  full_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  requested_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- REFRESH TOKENS (rotating; one row per issued refresh token)
-- ============================================================
-- Short-lived access JWTs (~15 min) are paired with a long-lived (7-day)
-- refresh token stored here, hashed. Every refresh ROTATES: the presented
-- token is burned and a new one is issued in the same `family_id`. If a
-- burned/revoked token is ever presented again, the whole family is
-- revoked (theft/replay detection). `school_id` is kept for cascade +
-- tenant hygiene even though lookups are by `token_hash`.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_parent ON students(parent_id);
CREATE INDEX IF NOT EXISTS idx_homework_class ON homework(class_id);
CREATE INDEX IF NOT EXISTS idx_homework_school ON homework(school_id);
CREATE INDEX IF NOT EXISTS idx_assignments_student ON assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_reports_student ON reports(student_id);
CREATE INDEX IF NOT EXISTS idx_bus_locations_driver ON bus_locations(driver_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

-- ============================================================
-- DEVICE TOKENS (Expo push notifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS device_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  language VARCHAR(10) DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, token)
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_announcements_school ON announcements(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_class ON attendance(class_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance(school_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_grades_student_subject ON grades(student_id, subject, grading_period);

-- ============================================================
-- BUS RIDE RECORDS
-- Tracks per-student per-day bus ride outcomes and cross-references
-- school attendance for discrepancy reporting.
-- ============================================================
CREATE TABLE IF NOT EXISTS bus_ride_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  rode_bus BOOLEAN NOT NULL DEFAULT TRUE,
  -- Why the student didn't ride (only set when rode_bus = false)
  exclusion_reason TEXT CHECK (exclusion_reason IN ('school_absent', 'went_home_with_parents')),
  -- Snapshot of school attendance at time of drive start (for discrepancy queries)
  school_attendance_status TEXT CHECK (school_attendance_status IN ('present', 'absent', 'late', 'excused')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, date)
);
CREATE INDEX IF NOT EXISTS idx_bus_ride_records_school_date ON bus_ride_records(school_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_bus_ride_records_student ON bus_ride_records(student_id, date DESC);

-- ============================================================
-- ARCHIVED STUDENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS archived_students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  original_student_id UUID,
  full_name TEXT NOT NULL,
  date_of_birth DATE,
  enrollment_date DATE,
  departure_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('transferred', 'withdrew', 'graduated')),
  parent_full_name TEXT,
  parent_phone TEXT,
  classes_attended JSONB DEFAULT '[]',           -- LEGACY (migration 030): attendance-derived class list, no longer populated (always []). NOT REMOVED because migration 019's tamper-evidence hash _canon_archived_student includes classes_attended::text in its canonical input — dropping the column would invalidate the integrity chain on every existing archive. Reads come from enrollment_history below.
  enrollment_history JSONB NOT NULL DEFAULT '[]', -- per-year academic progression snapshot; see migration 030. Source of truth for the archive's academic record.
  transfer_id UUID,                              -- migration 032: links back to student_transfers row when reason='transferred' was driven by the transfer wizard. Included in _canon_archived_student as of migration 045 (as.v3).
  grades JSONB DEFAULT '[]',
  payment_history JSONB DEFAULT '[]',
  reports JSONB NOT NULL DEFAULT '[]',  -- migration 041: per-year teacher reports snapshot; included in _canon_archived_student (as.v3, migration 045)
  archived_by UUID,  -- FK-less actor ref (append-only/hashed row): keeps its value when the user is deleted; text copies below stay readable
  archived_by_name TEXT,
  archived_by_role TEXT,
  original_parent_id UUID,  -- FK-less (append-only/hashed row): links back to the parent account; keeps its value if the parent is deleted
  snapshot_version INTEGER NOT NULL DEFAULT 1,  -- F10: snapshot JSONB shape version
  content_hash TEXT,  -- E-a: SHA-256 tamper-evidence (set by BEFORE INSERT trigger)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_archived_students_school ON archived_students(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archived_students_parent ON archived_students(school_id, original_parent_id) WHERE original_parent_id IS NOT NULL;

-- Atomic snapshot-insert + students-row delete (see migration 010 / 015 / 041).
-- The controller builds the JSONB; this function just commits the pair.
CREATE OR REPLACE FUNCTION archive_student_atomic(
  p_school_id UUID,
  p_student_id UUID,
  p_full_name TEXT,
  p_date_of_birth DATE,
  p_enrollment_date DATE,
  p_departure_date DATE,
  p_reason TEXT,
  p_parent_full_name TEXT,
  p_parent_phone TEXT,
  p_classes_attended JSONB,
  p_grades JSONB,
  p_payment_history JSONB,
  p_archived_by UUID,
  p_archived_by_name TEXT,
  p_archived_by_role TEXT,
  p_original_parent_id UUID,
  p_enrollment_history JSONB DEFAULT '[]'::jsonb,  -- migration 031
  p_transfer_id UUID DEFAULT NULL,                 -- migration 033
  p_reports JSONB DEFAULT '[]'::jsonb              -- migration 041
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_archive_id UUID;
BEGIN
  INSERT INTO archived_students (
    school_id, original_student_id, full_name, date_of_birth, enrollment_date,
    departure_date, reason, parent_full_name, parent_phone,
    classes_attended, enrollment_history, grades, payment_history, reports,
    archived_by, archived_by_name, archived_by_role, original_parent_id,
    transfer_id
  ) VALUES (
    p_school_id, p_student_id, p_full_name, p_date_of_birth, p_enrollment_date,
    p_departure_date, p_reason, p_parent_full_name, p_parent_phone,
    COALESCE(p_classes_attended, '[]'::jsonb),
    COALESCE(p_enrollment_history, '[]'::jsonb),
    COALESCE(p_grades, '[]'::jsonb),
    COALESCE(p_payment_history, '[]'::jsonb),
    COALESCE(p_reports, '[]'::jsonb),
    p_archived_by, p_archived_by_name, p_archived_by_role, p_original_parent_id,
    p_transfer_id
  )
  RETURNING id INTO v_archive_id;

  DELETE FROM students
   WHERE id = p_student_id AND school_id = p_school_id;

  RETURN v_archive_id;
END;
$$;

-- ============================================================
-- ARCHIVED EMPLOYEES
-- Unified snapshot for teacher / driver / supervisor / staff departures
-- (see migration 013). Controller builds the role JSONB in TS; the
-- archive_employee_atomic() function does the snapshot-insert + users-row
-- delete in one transaction (deleting users cascades the teachers/drivers
-- row, teacher_classes, bus_locations).
-- ============================================================
CREATE TABLE IF NOT EXISTS archived_employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  original_employee_id UUID,
  role TEXT NOT NULL CHECK (role IN ('teacher', 'driver', 'supervisor', 'staff', 'admin', 'reception', 'accountant')),
  full_name TEXT NOT NULL,
  date_of_birth DATE,
  age INTEGER,
  phone_number TEXT,
  email TEXT,
  emergency_contact TEXT,
  profile_picture TEXT,
  position TEXT,
  subject TEXT,
  hire_date DATE,
  departure_date DATE NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('resigned', 'terminated', 'contract_ended', 'retired', 'transferred', 'other')),
  account JSONB DEFAULT '{}',
  teaching JSONB DEFAULT '[]',
  transport JSONB DEFAULT '{}',
  employment JSONB DEFAULT '{}',
  payment_history JSONB DEFAULT '[]',
  archived_by UUID,  -- FK-less actor ref (append-only/hashed row): keeps its value when the user is deleted; text copies below stay readable
  archived_by_name TEXT,
  archived_by_role TEXT,
  snapshot_version INTEGER NOT NULL DEFAULT 1,  -- F10: snapshot JSONB shape version
  content_hash TEXT,  -- E-a: SHA-256 tamper-evidence (set by BEFORE INSERT trigger)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_archived_employees_school ON archived_employees(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archived_employees_role ON archived_employees(school_id, role);
-- Migration 024: allow reception + accountant (bare-users-row roles) to archive.
ALTER TABLE archived_employees DROP CONSTRAINT IF EXISTS archived_employees_role_check;
ALTER TABLE archived_employees ADD CONSTRAINT archived_employees_role_check
  CHECK (role IN ('teacher', 'driver', 'supervisor', 'staff', 'admin', 'reception', 'accountant'));

-- ============================================================
-- ARCHIVE BACKUPS (migration 016 / finding F4)
-- One row per backup file taken before a feature-off purge (or manual,
-- admin self-serve). The file itself lives in object storage; this is
-- the index. Retained even when the archive itself is purged.
-- ============================================================
CREATE TABLE IF NOT EXISTS archive_backups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pre_purge', 'manual')),
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  byte_size INTEGER,
  student_count INTEGER,
  employee_count INTEGER,
  -- v2 (AC-10) backups include the General Ledger. Nullable so v1 rows
  -- created before migration 044 still pass verification; the verifier
  -- skips the GL count check when these are NULL.
  journal_entry_count INTEGER,
  journal_line_count INTEGER,
  reason TEXT,
  created_by_name TEXT,
  sha256 TEXT,                                       -- E-b: checksum of the stored file
  verified_at TIMESTAMPTZ,
  verify_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verify_status IN ('unverified', 'verified', 'failed', 'missing')),
  verify_detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE archive_backups ADD COLUMN IF NOT EXISTS journal_entry_count INTEGER;
ALTER TABLE archive_backups ADD COLUMN IF NOT EXISTS journal_line_count INTEGER;
CREATE INDEX IF NOT EXISTS idx_archive_backups_school ON archive_backups(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archive_backups_verify ON archive_backups(verify_status, verified_at);

-- ============================================================
-- APPEND-ONLY ENFORCEMENT (migration 016 / finding F3)
-- archived_students / archived_employees / audit_logs are immutable.
-- The only sanctioned delete is the feature-off purge, via the
-- SECURITY DEFINER purge_school_archive() which sets a tx-local GUC the
-- trigger honors. Also run before a full school delete so the schools-FK
-- cascade doesn't trip the triggers.
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_archive_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_archive_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION '% is append-only — % is not permitted', TG_TABLE_NAME, TG_OP
    USING HINT = 'Archive/audit rows are immutable; deletion is only via the feature-off purge.';
END;
$$;

DROP TRIGGER IF EXISTS trg_archived_students_append_only ON archived_students;
CREATE TRIGGER trg_archived_students_append_only
  BEFORE UPDATE OR DELETE ON archived_students
  FOR EACH ROW EXECUTE FUNCTION prevent_archive_mutation();

DROP TRIGGER IF EXISTS trg_archived_employees_append_only ON archived_employees;
CREATE TRIGGER trg_archived_employees_append_only
  BEFORE UPDATE OR DELETE ON archived_employees
  FOR EACH ROW EXECUTE FUNCTION prevent_archive_mutation();

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_archive_mutation();

-- HD-9 (migration 045) — selective append-only on archive_backups. The
-- nightly verify sweep needs to stamp verify_status / verified_at /
-- verify_detail, so a blanket trigger would block legitimate writes.
-- Every other column is frozen post-insert; same GUC bypass for the
-- purge path so delete_school_cascade still works.
CREATE OR REPLACE FUNCTION prevent_archive_backups_core_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.allow_archive_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'archive_backups is append-only — DELETE is not permitted';
  END IF;
  IF NEW.school_id        IS DISTINCT FROM OLD.school_id
     OR NEW.kind            IS DISTINCT FROM OLD.kind
     OR NEW.storage_bucket  IS DISTINCT FROM OLD.storage_bucket
     OR NEW.storage_path    IS DISTINCT FROM OLD.storage_path
     OR NEW.byte_size       IS DISTINCT FROM OLD.byte_size
     OR NEW.student_count   IS DISTINCT FROM OLD.student_count
     OR NEW.employee_count  IS DISTINCT FROM OLD.employee_count
     OR NEW.journal_entry_count IS DISTINCT FROM OLD.journal_entry_count
     OR NEW.journal_line_count  IS DISTINCT FROM OLD.journal_line_count
     OR NEW.reason          IS DISTINCT FROM OLD.reason
     OR NEW.created_by_name IS DISTINCT FROM OLD.created_by_name
     OR NEW.sha256          IS DISTINCT FROM OLD.sha256
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'archive_backups core fields are immutable — only verify_status / verified_at / verify_detail may change after insert';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_archive_backups_append_only ON archive_backups;
CREATE TRIGGER trg_archive_backups_append_only
  BEFORE UPDATE OR DELETE ON archive_backups
  FOR EACH ROW EXECUTE FUNCTION prevent_archive_backups_core_mutation();

CREATE OR REPLACE FUNCTION purge_school_archive(p_school_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM set_config('app.allow_archive_purge', 'on', true);
  DELETE FROM archived_students  WHERE school_id = p_school_id;
  DELETE FROM archived_employees WHERE school_id = p_school_id;
  DELETE FROM students WHERE school_id = p_school_id AND is_graduated = true;
  -- audit_logs is intentionally retained on feature-off (compliance log,
  -- not "historical records"). It is only removed on full school delete.
END;
$$;

-- Full school deletion. The schools-FK cascade would otherwise hit the
-- append-only triggers on audit_logs / archived_* and fail. Setting the
-- tx-local GUC before the cascade lets those cascade-deletes through.
CREATE OR REPLACE FUNCTION delete_school_cascade(p_school_id UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM set_config('app.allow_archive_purge', 'on', true);
  DELETE FROM schools WHERE id = p_school_id;
END;
$$;

-- Rehire links (Phase 3 UI; inert until used).
ALTER TABLE teachers       ADD COLUMN IF NOT EXISTS previous_archive_id UUID REFERENCES archived_employees(id) ON DELETE SET NULL;
ALTER TABLE drivers        ADD COLUMN IF NOT EXISTS previous_archive_id UUID REFERENCES archived_employees(id) ON DELETE SET NULL;
ALTER TABLE staff_members  ADD COLUMN IF NOT EXISTS previous_archive_id UUID REFERENCES archived_employees(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION archive_employee_atomic(
  p_school_id UUID,
  p_user_id UUID,
  p_original_employee_id UUID,
  p_role TEXT,
  p_full_name TEXT,
  p_date_of_birth DATE,
  p_age INTEGER,
  p_phone_number TEXT,
  p_email TEXT,
  p_emergency_contact TEXT,
  p_profile_picture TEXT,
  p_position TEXT,
  p_subject TEXT,
  p_hire_date DATE,
  p_departure_date DATE,
  p_reason TEXT,
  p_account JSONB,
  p_teaching JSONB,
  p_transport JSONB,
  p_employment JSONB,
  p_payment_history JSONB,
  p_archived_by UUID,
  p_archived_by_name TEXT,
  p_archived_by_role TEXT
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_archive_id UUID;
BEGIN
  INSERT INTO archived_employees (
    school_id, original_employee_id, role, full_name, date_of_birth, age,
    phone_number, email, emergency_contact, profile_picture, position, subject,
    hire_date, departure_date, reason,
    account, teaching, transport, employment, payment_history,
    archived_by, archived_by_name, archived_by_role
  ) VALUES (
    p_school_id, p_original_employee_id, p_role, p_full_name, p_date_of_birth, p_age,
    p_phone_number, p_email, p_emergency_contact, p_profile_picture, p_position, p_subject,
    p_hire_date, p_departure_date, p_reason,
    COALESCE(p_account, '{}'::jsonb),
    COALESCE(p_teaching, '[]'::jsonb),
    COALESCE(p_transport, '{}'::jsonb),
    COALESCE(p_employment, '{}'::jsonb),
    COALESCE(p_payment_history, '[]'::jsonb),
    p_archived_by, p_archived_by_name, p_archived_by_role
  )
  RETURNING id INTO v_archive_id;

  DELETE FROM users
   WHERE id = p_user_id AND school_id = p_school_id;

  RETURN v_archive_id;
END;
$$;

-- ============================================================
-- ACADEMIC POSTS
-- Blog-style posts written by teachers for specific classes
-- ============================================================
CREATE TABLE IF NOT EXISTS academic_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject TEXT,
  content TEXT,
  content_type TEXT NOT NULL DEFAULT 'richtext' CHECK (content_type IN ('richtext', 'plaintext', 'file')),
  attachment_url TEXT,
  attachment_name TEXT,
  image_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_academic_posts_school ON academic_posts(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_academic_posts_teacher ON academic_posts(teacher_id);
CREATE INDEX IF NOT EXISTS idx_academic_posts_class ON academic_posts(class_id);

-- ============================================================
-- E-BOOKS
-- Digital books uploaded by admin/teachers, readable by parents
-- ============================================================
CREATE TABLE IF NOT EXISTS ebooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  subject TEXT,
  author TEXT,
  cover_url TEXT,
  file_url TEXT NOT NULL,
  description TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ebooks_school ON ebooks(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ebooks_class ON ebooks(class_id);

-- ============================================================
-- CHAT
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_role TEXT NOT NULL CHECK (staff_role IN ('teacher', 'supervisor')),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_preview TEXT,
  last_message_sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  last_message_type TEXT DEFAULT 'text',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, parent_id, staff_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_parent ON conversations(school_id, parent_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_staff ON conversations(school_id, staff_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT,
  type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'file')),
  attachment_url TEXT,
  attachment_name TEXT,
  attachment_size INTEGER,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at TIMESTAMPTZ,
  -- Audit snapshot: the content at the time of deletion. Never exposed by the
  -- regular chat API (content is nulled there); only the master portal reads it.
  deleted_content TEXT,
  deleted_attachment_url TEXT,
  deleted_attachment_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- For existing deployments
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_content TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_attachment_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_attachment_name TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversation_reads (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

-- Prior versions of edited messages, preserved for audit / legal review.
-- Rows are appended on every edit; the current content still lives on messages.content.
CREATE TABLE IF NOT EXISTS message_edits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  previous_content TEXT,
  edited_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_edits_message ON message_edits(message_id, edited_at DESC);

-- Every master-portal chat-audit view is recorded here for defensibility.
-- Written only by the master portal (local-only, MASTER_SECRET-gated).
CREATE TABLE IF NOT EXISTS chat_access_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('view', 'export')),
  reason TEXT NOT NULL,
  accessed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_access_log_school ON chat_access_log(school_id, accessed_at DESC);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
-- Append-only record of admin/accountant mutations on financial + student data.
-- Read by admins via the audit-log viewer page; never modified or deleted.
-- `changes` is a JSONB diff: { field: { old, new } } for updates; full snapshot
-- under `_row` key for create/delete (so the full record is recoverable).
-- `label` is a human-readable name (e.g. student name, plan name) snapshotted
-- so the audit trail stays meaningful even after the entity is deleted.
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'student','fee_plan','student_fee','fee_payment','staff_member','staff_salary_payment',
    'expense_category','expense_template','expense',
    'accounting_period','payment_account','fx_rate','late_fee',
    'teacher','driver','supervisor','admin'
  )),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID,  -- FK-less (append-only hash chain): keeps its value when the user is deleted; nulling it would break the chain
  actor_username TEXT,
  actor_role TEXT,
  label TEXT,
  reason TEXT,
  chain_seq BIGINT,   -- E-a: per-school hash chain
  prev_hash TEXT,
  row_hash  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_school ON audit_logs(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(school_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(school_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_chain ON audit_logs(school_id, chain_seq);

-- ============================================================
-- TAMPER-EVIDENCE (migration 019 / Phase E-a)
-- Content hashes on archive snapshots + a per-school hash chain on
-- audit_logs. Hashing is done in BEFORE INSERT triggers so it is
-- path-independent; canonicalisation lives here once and is reused by
-- verify_school_integrity(). Hash columns are themselves protected by the
-- 016 append-only triggers.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- SET search_path so `digest` (pgcrypto, in the `extensions` schema) resolves
-- regardless of the caller's path. Backend connections (PostgREST/service_role)
-- run with `public` only, so without this the hash triggers on archived_students
-- / archived_employees / audit_logs throw 42883 over the API. A function's
-- SET search_path applies during its own execution no matter who calls it, and
-- _sha is the only function that touches digest — so pinning it here covers
-- every hash path.
CREATE OR REPLACE FUNCTION _sha(t text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, extensions
AS $$ SELECT encode(digest(coalesce(t,''), 'sha256'), 'hex') $$;

-- Canonical form bumped to as.v3 in migration 045 (HD-2) to include
-- `enrollment_history` (added migration 031) and `transfer_id` (033).
CREATE OR REPLACE FUNCTION _canon_archived_student(r archived_students) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', 'as.v3',
    r.school_id::text, coalesce(r.original_student_id::text,''),
    coalesce(r.full_name,''), coalesce(r.date_of_birth::text,''),
    coalesce(r.enrollment_date::text,''), coalesce(r.departure_date::text,''),
    coalesce(r.reason,''), coalesce(r.parent_full_name,''), coalesce(r.parent_phone,''),
    coalesce(r.classes_attended::text,'[]'),
    coalesce(r.enrollment_history::text,'[]'),
    coalesce(r.grades::text,'[]'),
    coalesce(r.payment_history::text,'[]'),
    coalesce(r.reports::text,'[]'),
    coalesce(r.transfer_id::text,''),
    coalesce(r.archived_by::text,''),
    coalesce(r.archived_by_name,''), coalesce(r.archived_by_role,''),
    coalesce(r.original_parent_id::text,''), coalesce(r.snapshot_version::text,'1'),
    coalesce(r.created_at::text,''))
$$;

CREATE OR REPLACE FUNCTION _canon_archived_employee(r archived_employees) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', 'ae.v1',
    r.school_id::text, coalesce(r.original_employee_id::text,''), coalesce(r.role,''),
    coalesce(r.full_name,''), coalesce(r.date_of_birth::text,''), coalesce(r.age::text,''),
    coalesce(r.phone_number,''), coalesce(r.email,''), coalesce(r.emergency_contact,''),
    coalesce(r.profile_picture,''), coalesce(r.position,''), coalesce(r.subject,''),
    coalesce(r.hire_date::text,''), coalesce(r.departure_date::text,''), coalesce(r.reason,''),
    coalesce(r.account::text,'{}'), coalesce(r.teaching::text,'[]'),
    coalesce(r.transport::text,'{}'), coalesce(r.employment::text,'{}'),
    coalesce(r.payment_history::text,'[]'), coalesce(r.archived_by::text,''),
    coalesce(r.archived_by_name,''), coalesce(r.archived_by_role,''),
    coalesce(r.snapshot_version::text,'1'), coalesce(r.created_at::text,''))
$$;

CREATE OR REPLACE FUNCTION _canon_audit(r audit_logs) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', 'al.v1',
    r.chain_seq::text, r.school_id::text, coalesce(r.entity_type,''),
    coalesce(r.entity_id::text,''), coalesce(r.action,''),
    coalesce(r.changes::text,'{}'), coalesce(r.actor_id::text,''),
    coalesce(r.actor_username,''), coalesce(r.actor_role,''),
    coalesce(r.label,''), coalesce(r.reason,''), coalesce(r.created_at::text,''))
$$;

CREATE OR REPLACE FUNCTION hash_archived_student() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.content_hash := _sha(_canon_archived_student(NEW)); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION hash_archived_employee() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.content_hash := _sha(_canon_archived_employee(NEW)); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION hash_audit_log() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_seq BIGINT; v_prev TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('audit_chain:' || NEW.school_id::text));
  SELECT chain_seq, row_hash INTO v_seq, v_prev
    FROM audit_logs WHERE school_id = NEW.school_id ORDER BY chain_seq DESC LIMIT 1;
  NEW.chain_seq := coalesce(v_seq, 0) + 1;
  NEW.prev_hash := coalesce(v_prev, 'GENESIS');
  NEW.row_hash  := _sha(NEW.prev_hash || '|' || _canon_audit(NEW));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_archived_students_hash ON archived_students;
CREATE TRIGGER trg_archived_students_hash BEFORE INSERT ON archived_students
  FOR EACH ROW EXECUTE FUNCTION hash_archived_student();
DROP TRIGGER IF EXISTS trg_archived_employees_hash ON archived_employees;
CREATE TRIGGER trg_archived_employees_hash BEFORE INSERT ON archived_employees
  FOR EACH ROW EXECUTE FUNCTION hash_archived_employee();
DROP TRIGGER IF EXISTS trg_audit_logs_hash ON audit_logs;
CREATE TRIGGER trg_audit_logs_hash BEFORE INSERT ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION hash_audit_log();

-- Empty result = intact; one row per detected problem.
CREATE OR REPLACE FUNCTION verify_school_integrity(p_school_id UUID)
RETURNS TABLE(kind TEXT, table_name TEXT, row_id UUID, detail TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  rs archived_students%ROWTYPE;
  re archived_employees%ROWTYPE;
  ra audit_logs%ROWTYPE;
  v_prev TEXT := 'GENESIS'; v_expect BIGINT := 0;
BEGIN
  FOR rs IN SELECT * FROM archived_students WHERE school_id = p_school_id LOOP
    IF rs.content_hash IS NULL THEN
      RETURN QUERY SELECT 'unhashed','archived_students',rs.id,'no content_hash (pre-019)';
    ELSIF rs.content_hash <> _sha(_canon_archived_student(rs)) THEN
      RETURN QUERY SELECT 'content_altered','archived_students',rs.id,rs.full_name;
    END IF;
  END LOOP;
  FOR re IN SELECT * FROM archived_employees WHERE school_id = p_school_id LOOP
    IF re.content_hash IS NULL THEN
      RETURN QUERY SELECT 'unhashed','archived_employees',re.id,'no content_hash (pre-019)';
    ELSIF re.content_hash <> _sha(_canon_archived_employee(re)) THEN
      RETURN QUERY SELECT 'content_altered','archived_employees',re.id,re.full_name;
    END IF;
  END LOOP;
  FOR ra IN SELECT * FROM audit_logs WHERE school_id = p_school_id ORDER BY chain_seq LOOP
    v_expect := v_expect + 1;
    IF ra.chain_seq IS NULL OR ra.row_hash IS NULL THEN
      RETURN QUERY SELECT 'unhashed','audit_logs',ra.id,'no chain (pre-019)'; CONTINUE;
    END IF;
    IF ra.chain_seq <> v_expect THEN
      RETURN QUERY SELECT 'sequence_gap','audit_logs',ra.id,
        format('expected seq %s, got %s', v_expect, ra.chain_seq);
      v_expect := ra.chain_seq;
    END IF;
    IF ra.prev_hash <> v_prev THEN
      RETURN QUERY SELECT 'chain_broken','audit_logs',ra.id,
        format('prev_hash mismatch at seq %s', ra.chain_seq);
    END IF;
    IF ra.row_hash <> _sha(ra.prev_hash || '|' || _canon_audit(ra)) THEN
      RETURN QUERY SELECT 'content_altered','audit_logs',ra.id,
        format('row_hash mismatch at seq %s', ra.chain_seq);
    END IF;
    v_prev := ra.row_hash;
  END LOOP;
END $$;

-- ============================================================
-- DEMO SCHOOL SEED
-- ============================================================
INSERT INTO schools (id, name, slug, abbreviation, primary_color, secondary_color, is_active)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'Demo School',
  'demo',
  'DEMO',
  '#4F46E5',
  '#06B6D4',
  TRUE
) ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- LEARN: generalize academic_posts + social (likes/comments/saves) + ebook progress
-- ============================================================

-- Generalize academic_posts: support supervisor (school-wide) authors in addition to teachers.
ALTER TABLE academic_posts ADD COLUMN IF NOT EXISTS author_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE academic_posts ADD COLUMN IF NOT EXISTS author_role TEXT;
ALTER TABLE academic_posts ADD COLUMN IF NOT EXISTS body TEXT;

-- Backfill author_user_id and author_role for existing teacher rows
UPDATE academic_posts ap
SET author_user_id = t.user_id,
    author_role = 'teacher'
FROM teachers t
WHERE ap.teacher_id = t.id
  AND ap.author_user_id IS NULL;

-- Make teacher_id and class_id nullable (supervisor posts are school-wide, no class)
ALTER TABLE academic_posts ALTER COLUMN teacher_id DROP NOT NULL;
ALTER TABLE academic_posts ALTER COLUMN class_id DROP NOT NULL;

-- Enforce author_role values
DO $$ BEGIN
  ALTER TABLE academic_posts ADD CONSTRAINT academic_posts_author_role_chk
    CHECK (author_role IN ('teacher', 'supervisor'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_academic_posts_author ON academic_posts(author_user_id);

-- Post likes
CREATE TABLE IF NOT EXISTS post_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES academic_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_likes_post ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_user ON post_likes(user_id);

-- Post saves (bookmarks)
CREATE TABLE IF NOT EXISTS post_saves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES academic_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_saves_user ON post_saves(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_saves_post ON post_saves(post_id);

-- Post comments
CREATE TABLE IF NOT EXISTS post_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES academic_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES post_comments(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(post_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_post_comments_parent ON post_comments(parent_id);
-- Run this if the table already exists:
-- ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES post_comments(id) ON DELETE CASCADE;
-- CREATE INDEX IF NOT EXISTS idx_post_comments_parent ON post_comments(parent_id);

-- Likes on comments
CREATE TABLE IF NOT EXISTS post_comment_likes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  comment_id UUID NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(comment_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_comment_likes_comment ON post_comment_likes(comment_id);
CREATE INDEX IF NOT EXISTS idx_post_comment_likes_user ON post_comment_likes(user_id);

-- Ebook reading progress per student (not per parent)
CREATE TABLE IF NOT EXISTS ebook_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  ebook_id UUID NOT NULL REFERENCES ebooks(id) ON DELETE CASCADE,
  current_page INTEGER NOT NULL DEFAULT 0,
  total_pages INTEGER,
  percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, ebook_id)
);
CREATE INDEX IF NOT EXISTS idx_ebook_progress_student ON ebook_progress(student_id);
CREATE INDEX IF NOT EXISTS idx_ebook_progress_ebook ON ebook_progress(ebook_id);

-- ============================================================
-- STUDENT ACCESS LOCKS (per-student per-feature gating, admin-controlled)
-- ============================================================
CREATE TABLE IF NOT EXISTS student_access_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  reason TEXT,
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (student_id, feature)
);
CREATE INDEX IF NOT EXISTS idx_student_access_locks_student ON student_access_locks(student_id, feature);
CREATE INDEX IF NOT EXISTS idx_student_access_locks_school ON student_access_locks(school_id);

-- ============================================================
-- TUITION FEES (premium feature)
-- ============================================================
-- Tuition config column on schools — see schools table.
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS tuition_config JSONB
--   DEFAULT '{"currency":"USD","siblingDiscount":{"enabled":false,"type":"percent","tiers":[]}}'::jsonb;

CREATE TABLE IF NOT EXISTS fee_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  applies_to TEXT NOT NULL CHECK (applies_to IN ('all','classes','manual')),
  academic_year TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fee_plans_school ON fee_plans(school_id, is_active);

CREATE TABLE IF NOT EXISTS fee_plan_classes (
  fee_plan_id UUID NOT NULL REFERENCES fee_plans(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (fee_plan_id, class_id)
);

CREATE TABLE IF NOT EXISTS fee_installments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  fee_plan_id UUID NOT NULL REFERENCES fee_plans(id) ON DELETE CASCADE,
  sequence INT NOT NULL CHECK (sequence > 0),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  due_date DATE NOT NULL,
  UNIQUE (fee_plan_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_fee_installments_plan ON fee_installments(fee_plan_id, sequence);

CREATE TABLE IF NOT EXISTS student_fees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_plan_id UUID NOT NULL REFERENCES fee_plans(id) ON DELETE CASCADE,
  total_amount NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  adjustment NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_id, fee_plan_id)
);
CREATE INDEX IF NOT EXISTS idx_student_fees_student ON student_fees(student_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_school ON student_fees(school_id);
CREATE INDEX IF NOT EXISTS idx_student_fees_plan ON student_fees(fee_plan_id);

CREATE TABLE IF NOT EXISTS fee_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_fee_id UUID NOT NULL REFERENCES student_fees(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  paid_on DATE NOT NULL,
  method TEXT,
  reference TEXT,
  notes TEXT,
  -- Note explaining any portion of `amount` that wasn't tied to a specific
  -- installment (advance / misc fees). Required client-side when an
  -- unallocated amount > 0 is recorded against a plan that has installments.
  unallocated_note TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fee_payments_student_fee ON fee_payments(student_fee_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_fee_payments_school ON fee_payments(school_id);

-- One payment can be split across multiple installments. One installment can
-- receive multiple partial payments. Rows are optional — a payment with no
-- allocation rows is treated as an "unallocated" lump sum.
CREATE TABLE IF NOT EXISTS fee_payment_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  fee_payment_id UUID NOT NULL REFERENCES fee_payments(id) ON DELETE CASCADE,
  fee_installment_id UUID NOT NULL REFERENCES fee_installments(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fpa_payment ON fee_payment_allocations(fee_payment_id);
CREATE INDEX IF NOT EXISTS idx_fpa_installment ON fee_payment_allocations(fee_installment_id);
CREATE INDEX IF NOT EXISTS idx_fpa_school ON fee_payment_allocations(school_id);

-- ============================================================
-- STAFF SALARIES (premium feature, gated by school.features.tuition_fees)
-- ============================================================
-- Unified roster of paid staff. user_id is set when the row is linked to a
-- teacher account (so notifications can fire); custom employees added by the
-- accountant for record-keeping have user_id = NULL.
CREATE TABLE IF NOT EXISTS staff_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  position TEXT,
  salary_amount NUMERIC(12,2) NOT NULL CHECK (salary_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  next_payment_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  insurance_percentage NUMERIC(5,2) CHECK (insurance_percentage IS NULL OR (insurance_percentage >= 0 AND insurance_percentage <= 100)),
  insurance_paid_out BOOLEAN NOT NULL DEFAULT FALSE,
  insurance_paid_out_at DATE,
  insurance_paid_out_amount NUMERIC(12,2),
  insurance_paid_out_currency TEXT,
  insurance_paid_out_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS insurance_percentage NUMERIC(5,2) CHECK (insurance_percentage IS NULL OR (insurance_percentage >= 0 AND insurance_percentage <= 100));
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS insurance_paid_out BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS insurance_paid_out_at DATE;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS insurance_paid_out_amount NUMERIC(12,2);
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS insurance_paid_out_currency TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS insurance_paid_out_notes TEXT;
-- Employee HR fields (migration 024). official_photo = admin-uploaded
-- professional photo. emergency_contact added here for parity with teachers/drivers.
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS national_id TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS marital_status TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS employment_type TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS qualifications TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS emergency_contact TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS official_photo TEXT;
CREATE INDEX IF NOT EXISTS idx_staff_members_school ON staff_members(school_id, is_active);
CREATE INDEX IF NOT EXISTS idx_staff_members_user ON staff_members(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_members_school_user_unique ON staff_members(school_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS staff_salary_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  paid_on DATE NOT NULL,
  period_label TEXT,
  notes TEXT,
  insurance_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (insurance_amount >= 0),
  insurance_percentage NUMERIC(5,2),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS insurance_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (insurance_amount >= 0);
ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS insurance_percentage NUMERIC(5,2);
CREATE INDEX IF NOT EXISTS idx_staff_salary_payments_staff ON staff_salary_payments(staff_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_staff_salary_payments_school ON staff_salary_payments(school_id);

-- ============================================================
-- VOID / SOFT-DELETE COLUMNS
-- Replace hard DELETE on financial + staff records with reversible "void".
-- Reads must filter `voided_at IS NULL` to hide voided rows from normal views.
-- A retention cron (see below) hard-deletes after the configured window.
-- ============================================================
ALTER TABLE fee_plans              ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;
ALTER TABLE fee_plans              ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE fee_plans              ADD COLUMN IF NOT EXISTS void_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_fee_plans_voided ON fee_plans(school_id, voided_at) WHERE voided_at IS NOT NULL;

ALTER TABLE fee_payments           ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;
ALTER TABLE fee_payments           ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE fee_payments           ADD COLUMN IF NOT EXISTS void_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_fee_payments_voided ON fee_payments(school_id, voided_at) WHERE voided_at IS NOT NULL;

ALTER TABLE staff_members          ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;
ALTER TABLE staff_members          ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE staff_members          ADD COLUMN IF NOT EXISTS void_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_staff_members_voided ON staff_members(school_id, voided_at) WHERE voided_at IS NOT NULL;

ALTER TABLE staff_salary_payments  ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;
ALTER TABLE staff_salary_payments  ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE staff_salary_payments  ADD COLUMN IF NOT EXISTS void_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_staff_salary_payments_voided ON staff_salary_payments(school_id, voided_at) WHERE voided_at IS NOT NULL;

-- ============================================================
-- STUDENT RE-ENROLLMENT LINK
-- When an archived student returns, the new students row links back to the
-- archived snapshot so admins can view the previous enrollment history.
-- ============================================================
ALTER TABLE students ADD COLUMN IF NOT EXISTS previous_archive_id UUID REFERENCES archived_students(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_students_previous_archive ON students(previous_archive_id) WHERE previous_archive_id IS NOT NULL;

-- ============================================================
-- EXPENSES (premium accounting module)
-- Categories are admin-configurable per school (chart of accounts).
-- Recurring templates are reusable definitions; each "Record" click creates
-- a one-row expense entry and bumps next_due_date forward by the cadence.
-- All entries are voidable; voided rows are excluded from reads and the
-- ledger, then hard-deleted by cleanup_voided_records after 30 days.
-- ============================================================
CREATE TABLE IF NOT EXISTS expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, name)
);
CREATE INDEX IF NOT EXISTS idx_expense_categories_school ON expense_categories(school_id, is_active);

CREATE TABLE IF NOT EXISTS expense_recurring_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  cadence TEXT NOT NULL CHECK (cadence IN ('monthly','quarterly','yearly')),
  next_due_date DATE,
  vendor TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expense_templates_school ON expense_recurring_templates(school_id, is_active);
CREATE INDEX IF NOT EXISTS idx_expense_templates_category ON expense_recurring_templates(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expense_templates_next_due ON expense_recurring_templates(school_id, next_due_date) WHERE is_active AND next_due_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  template_id UUID REFERENCES expense_recurring_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  expense_date DATE NOT NULL,
  vendor TEXT,
  payment_method TEXT,
  notes TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_expenses_school_date ON expenses(school_id, expense_date DESC) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_template ON expenses(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_voided ON expenses(school_id, voided_at) WHERE voided_at IS NOT NULL;

-- ============================================================
-- VOID RETENTION CLEANUP
-- Hard-deletes voided records older than the retention window.
-- Audit log rows persist independently, so the paper trail outlives the row.
-- Runs nightly at 03:15 UTC via pg_cron. Window is 30 days; change the
-- `INTERVAL '30 days'` literal in the function body to adjust.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Mirror of migration 043 — voided parents (fee_plans, staff_members) are
-- only hard-deleted when none of their dependents are still alive. The
-- earlier version cascaded through fee_plans → student_fees → fee_payments
-- and silently wiped receipts for everyone on a voided plan.
CREATE OR REPLACE FUNCTION cleanup_voided_records() RETURNS void AS $$
BEGIN
  DELETE FROM fee_payments
   WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';

  DELETE FROM staff_salary_payments
   WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';

  DELETE FROM expenses
   WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';

  DELETE FROM fee_plans fp
   WHERE fp.voided_at IS NOT NULL
     AND fp.voided_at < NOW() - INTERVAL '30 days'
     AND NOT EXISTS (
       SELECT 1 FROM student_fees sf WHERE sf.fee_plan_id = fp.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM fee_payments fpay
         JOIN student_fees sf2 ON sf2.id = fpay.student_fee_id
        WHERE sf2.fee_plan_id = fp.id
          AND fpay.voided_at IS NULL
     );

  DELETE FROM staff_members sm
   WHERE sm.voided_at IS NOT NULL
     AND sm.voided_at < NOW() - INTERVAL '30 days'
     AND NOT EXISTS (
       SELECT 1 FROM staff_salary_payments ssp
        WHERE ssp.staff_id = sm.id
          AND ssp.voided_at IS NULL
     );
END;
$$ LANGUAGE plpgsql;

-- Drop any earlier registration so re-running this script reschedules cleanly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_voided_records') THEN
    PERFORM cron.unschedule('cleanup_voided_records');
  END IF;
END $$;

SELECT cron.schedule('cleanup_voided_records', '15 3 * * *', $$SELECT cleanup_voided_records();$$);

-- ============================================================
-- ACCOUNTING UPGRADES (mirror of migration 009)
-- Receipt numbers, currency on payments, tax/withholding, refund linkage,
-- fee-plan kind, late fees, accounting periods, payment accounts, FX rates,
-- daily cron for late-fee + recurring-expense auto-record.
-- ============================================================
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS receipt_number INT;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS receipt_year   INT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_payments_receipt
  ON fee_payments(school_id, receipt_year, receipt_number)
  WHERE receipt_number IS NOT NULL;

ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE fee_payments          ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE fee_payments          ADD COLUMN IF NOT EXISTS tax_label  TEXT;
ALTER TABLE expenses              ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE expenses              ADD COLUMN IF NOT EXISTS tax_label  TEXT;
ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS tax_label  TEXT;

ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS is_refund            BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS refund_of_payment_id UUID REFERENCES fee_payments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fee_payments_refund_of ON fee_payments(refund_of_payment_id) WHERE refund_of_payment_id IS NOT NULL;

ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tuition'
  CHECK (kind IN ('tuition','transport','lunch','uniform','exam','registration','other'));
CREATE INDEX IF NOT EXISTS idx_fee_plans_kind ON fee_plans(school_id, kind, is_active);

ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS late_fee_enabled    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS late_fee_type       TEXT CHECK (late_fee_type IS NULL OR late_fee_type IN ('fixed','percent'));
ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS late_fee_amount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (late_fee_amount >= 0);
ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS late_fee_grace_days INT NOT NULL DEFAULT 0 CHECK (late_fee_grace_days >= 0);

CREATE TABLE IF NOT EXISTS student_fee_late_fees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_fee_id UUID NOT NULL REFERENCES student_fees(id) ON DELETE CASCADE,
  fee_installment_id UUID NOT NULL REFERENCES fee_installments(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  applied_on DATE NOT NULL DEFAULT CURRENT_DATE,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_fee_id, fee_installment_id)
);
CREATE INDEX IF NOT EXISTS idx_late_fees_school ON student_fee_late_fees(school_id);
CREATE INDEX IF NOT EXISTS idx_late_fees_student_fee ON student_fee_late_fees(student_fee_id) WHERE voided_at IS NULL;

CREATE TABLE IF NOT EXISTS accounting_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  closed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  reopened_at  TIMESTAMPTZ,
  reopened_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reopen_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (period_end >= period_start),
  UNIQUE (school_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_school
  ON accounting_periods(school_id, period_start DESC) WHERE reopened_at IS NULL;

CREATE TABLE IF NOT EXISTS payment_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cash','bank','wallet','other')),
  currency TEXT NOT NULL DEFAULT 'USD',
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, name)
);
CREATE INDEX IF NOT EXISTS idx_payment_accounts_school ON payment_accounts(school_id, is_active);

ALTER TABLE fee_payments          ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL;
ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL;
ALTER TABLE expenses              ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS fx_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  from_currency TEXT NOT NULL,
  to_currency   TEXT NOT NULL,
  rate          NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, from_currency, to_currency, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_fx_rates_lookup
  ON fx_rates(school_id, from_currency, to_currency, effective_from DESC);

-- ============================================================================
-- GENERAL LEDGER (double-entry book of record) — Phase 1
-- Accountant-grade, accrual-on-revenue / cash-on-expenses. Gated by the same
-- premium flag as the rest of accounting (schools.features.tuition_fees).
--
-- Three tables:
--   chart_of_accounts — the buckets (asset/liability/equity/income/expense).
--                       Auto-seeded per school from payment_accounts, fee
--                       kinds and expense_categories (see utils/glSeed).
--   journal_entries   — immutable, hash-chained entry headers. Append-only;
--                       a correction is a REVERSING entry, never an edit.
--   journal_lines     — the debit/credit lines; sum(debit)=sum(credit) per
--                       entry is enforced by the posting layer (utils/glPosting).
--
-- The operational tables (fee_payments, expenses, staff_salary_payments) stay
-- the source documents; the GL is POSTED-TO from them. Posting co-locates with
-- logAudit() so the two never drift. Single currency per entry keeps balancing
-- trivial; multi-currency consolidation is a report-time concern via fx_rates.
-- ============================================================================

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code TEXT NOT NULL,                 -- 1xxx asset, 2xxx liability, 3xxx equity, 4xxx income, 5xxx expense
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
  subtype TEXT,                       -- optional finer bucket: 'cash','receivable','payable', ...
  currency TEXT,                      -- NULL = multi-currency; balances are always grouped by line currency
  -- Links that let the seeder + posting layer route automatically:
  payment_account_id  UUID REFERENCES payment_accounts(id)   ON DELETE SET NULL,  -- cash/bank asset accounts
  fee_kind            TEXT,                                                       -- maps to fee_plans.kind (income)
  expense_category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,  -- expense accounts
  is_system BOOLEAN NOT NULL DEFAULT FALSE,   -- system accounts (AR, cash, etc.) can't be deleted by the accountant
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, code)
);
CREATE INDEX IF NOT EXISTS idx_coa_school_type ON chart_of_accounts(school_id, type, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coa_payment_account ON chart_of_accounts(school_id, payment_account_id) WHERE payment_account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_coa_expense_category ON chart_of_accounts(school_id, expense_category_id) WHERE expense_category_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  entry_no BIGINT,                    -- per-school sequential, set by trigger (= chain_seq)
  entry_date DATE NOT NULL,
  currency TEXT NOT NULL,             -- single currency per entry
  memo TEXT,
  source TEXT NOT NULL CHECK (source IN (
    'tuition_billing','fee_payment','refund','expense','salary',
    'insurance_payout','late_fee','manual','reversal','opening'
  )),
  source_id UUID,                     -- FK-less pointer to the originating row (survives that row's deletion)
  is_reversal BOOLEAN NOT NULL DEFAULT FALSE,
  reverses_entry_id UUID REFERENCES journal_entries(id),
  posted_by UUID,  -- FK-less (append-only hash chain): keeps its value when the user is deleted; nulling it would break the chain
  lines_fingerprint TEXT,             -- sha256 of canonical lines, set by posting layer; folded into the hash chain
  -- Per-school tamper-evident hash chain (mirrors audit_logs / Phase E-a):
  chain_seq BIGINT,
  prev_hash TEXT,
  row_hash  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_journal_entries_school_date ON journal_entries(school_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_chain ON journal_entries(school_id, chain_seq);
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(school_id, source, source_id);

CREATE TABLE IF NOT EXISTS journal_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
  debit  NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency TEXT NOT NULL,
  description TEXT,
  student_id UUID,   -- FK-less drill-down dimension (append-only): keeps its value when the student is deleted/archived
  staff_id   UUID,   -- FK-less drill-down dimension (append-only): keeps its value when the staff member is deleted
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (debit > 0 OR credit > 0),
  CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(school_id, account_id);

-- ── Immutability: journal entries + lines are append-only (reuse the 016
-- guard that honours the app.allow_archive_purge GUC set by delete_school_cascade).
DROP TRIGGER IF EXISTS trg_journal_entries_append_only ON journal_entries;
CREATE TRIGGER trg_journal_entries_append_only
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION prevent_archive_mutation();
DROP TRIGGER IF EXISTS trg_journal_lines_append_only ON journal_lines;
CREATE TRIGGER trg_journal_lines_append_only
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_archive_mutation();

-- ── Hash chain on journal_entries (BEFORE INSERT, path-independent).
CREATE OR REPLACE FUNCTION _canon_journal_entry(r journal_entries) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws('|', 'je.v1',
    r.chain_seq::text, r.school_id::text, coalesce(r.entry_no::text,''),
    coalesce(r.entry_date::text,''), coalesce(r.currency,''), coalesce(r.source,''),
    coalesce(r.source_id::text,''), coalesce(r.is_reversal::text,'false'),
    coalesce(r.reverses_entry_id::text,''), coalesce(r.memo,''),
    coalesce(r.lines_fingerprint,''), coalesce(r.posted_by::text,''),
    coalesce(r.created_at::text,''))
$$;

CREATE OR REPLACE FUNCTION hash_journal_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_seq BIGINT; v_prev TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('je_chain:' || NEW.school_id::text));
  SELECT chain_seq, row_hash INTO v_seq, v_prev
    FROM journal_entries WHERE school_id = NEW.school_id ORDER BY chain_seq DESC LIMIT 1;
  NEW.chain_seq := coalesce(v_seq, 0) + 1;
  NEW.entry_no  := NEW.chain_seq;
  NEW.prev_hash := coalesce(v_prev, 'GENESIS');
  NEW.row_hash  := _sha(NEW.prev_hash || '|' || _canon_journal_entry(NEW));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journal_entries_hash ON journal_entries;
CREATE TRIGGER trg_journal_entries_hash BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION hash_journal_entry();

-- ── Atomic posting RPC. Inserts a balanced entry + its lines in ONE
-- transaction. Because journal_entries is append-only (no UPDATE/DELETE), the
-- backend can't manually roll back a half-written entry — so the whole post
-- must be transactional here: any failure (unbalanced, bad account) RAISEs and
-- aborts the tx, leaving NO orphan header and NOT advancing the hash chain.
-- The lines fingerprint is computed DB-side (single source of truth) and folded
-- into the entry's row_hash by the BEFORE INSERT trigger above.
-- p_lines: [{account_id, debit, credit, description, student_id, staff_id}]
CREATE OR REPLACE FUNCTION gl_post_entry(
  p_school_id UUID,
  p_entry_date DATE,
  p_currency TEXT,
  p_source TEXT,
  p_source_id UUID,
  p_memo TEXT,
  p_posted_by UUID,
  p_is_reversal BOOLEAN,
  p_reverses_entry_id UUID,
  p_lines JSONB
) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_entry_id UUID;
  v_total_debit  NUMERIC(14,2);
  v_total_credit NUMERIC(14,2);
  v_fp TEXT;
BEGIN
  SELECT coalesce(sum(round(coalesce((x->>'debit')::numeric,0),2)),0),
         coalesce(sum(round(coalesce((x->>'credit')::numeric,0),2)),0)
    INTO v_total_debit, v_total_credit
    FROM jsonb_array_elements(p_lines) x;

  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'GL entry unbalanced: debit % <> credit %', v_total_debit, v_total_credit;
  END IF;
  IF v_total_debit = 0 THEN
    RAISE EXCEPTION 'GL entry has zero total';
  END IF;

  -- Canonical lines fingerprint: sorted "account:debit:credit:currency".
  SELECT _sha(string_agg(line_canon, '|' ORDER BY line_canon)) INTO v_fp
    FROM (
      SELECT concat_ws(':', x->>'account_id',
               to_char(round(coalesce((x->>'debit')::numeric,0),2),  'FM999999999990.00'),
               to_char(round(coalesce((x->>'credit')::numeric,0),2), 'FM999999999990.00'),
               p_currency) AS line_canon
      FROM jsonb_array_elements(p_lines) x
    ) s;

  INSERT INTO journal_entries (school_id, entry_date, currency, memo, source, source_id,
                               is_reversal, reverses_entry_id, posted_by, lines_fingerprint)
  VALUES (p_school_id, p_entry_date, p_currency, p_memo, p_source, p_source_id,
          coalesce(p_is_reversal, false), p_reverses_entry_id, p_posted_by, v_fp)
  RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (school_id, entry_id, account_id, debit, credit, currency,
                             description, student_id, staff_id)
  SELECT p_school_id, v_entry_id, (x->>'account_id')::uuid,
         round(coalesce((x->>'debit')::numeric,0),2),
         round(coalesce((x->>'credit')::numeric,0),2),
         p_currency,
         nullif(x->>'description',''),
         nullif(x->>'student_id','')::uuid,
         nullif(x->>'staff_id','')::uuid
  FROM jsonb_array_elements(p_lines) x;

  RETURN v_entry_id;
END $$;

-- ============================================================================
-- RLS PHASE 2 — denormalize school_id onto child tables + write all tenant
-- isolation policies. Policies are CREATED but RLS is intentionally NOT
-- enabled here; flipping enforcement on happens table-by-table in Phase 4
-- once the backend has been switched to req.db. Idempotent (safe to re-run).
--
-- If Supabase's SQL editor prompts "Enable RLS for new tables", choose NO.
-- ============================================================================

-- ── 1. Denormalize school_id onto the 5 child tables that lack it ─────────

-- teacher_classes ← teachers.school_id
ALTER TABLE teacher_classes ADD COLUMN IF NOT EXISTS school_id UUID
  REFERENCES schools(id) ON DELETE CASCADE;
UPDATE teacher_classes tc SET school_id = t.school_id
  FROM teachers t WHERE tc.teacher_id = t.id AND tc.school_id IS NULL;
ALTER TABLE teacher_classes ALTER COLUMN school_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_teacher_classes_school ON teacher_classes(school_id);
CREATE OR REPLACE FUNCTION teacher_classes_set_school_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    SELECT school_id INTO NEW.school_id FROM teachers WHERE id = NEW.teacher_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_teacher_classes_set_school_id ON teacher_classes;
CREATE TRIGGER trg_teacher_classes_set_school_id
  BEFORE INSERT ON teacher_classes
  FOR EACH ROW EXECUTE FUNCTION teacher_classes_set_school_id();

-- messages ← conversations.school_id
ALTER TABLE messages ADD COLUMN IF NOT EXISTS school_id UUID
  REFERENCES schools(id) ON DELETE CASCADE;
UPDATE messages m SET school_id = c.school_id
  FROM conversations c WHERE m.conversation_id = c.id AND m.school_id IS NULL;
ALTER TABLE messages ALTER COLUMN school_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_school ON messages(school_id);
CREATE OR REPLACE FUNCTION messages_set_school_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    SELECT school_id INTO NEW.school_id FROM conversations WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_messages_set_school_id ON messages;
CREATE TRIGGER trg_messages_set_school_id
  BEFORE INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_set_school_id();

-- conversation_reads ← conversations.school_id
ALTER TABLE conversation_reads ADD COLUMN IF NOT EXISTS school_id UUID
  REFERENCES schools(id) ON DELETE CASCADE;
UPDATE conversation_reads cr SET school_id = c.school_id
  FROM conversations c WHERE cr.conversation_id = c.id AND cr.school_id IS NULL;
ALTER TABLE conversation_reads ALTER COLUMN school_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_reads_school ON conversation_reads(school_id);
CREATE OR REPLACE FUNCTION conversation_reads_set_school_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    SELECT school_id INTO NEW.school_id FROM conversations WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_conversation_reads_set_school_id ON conversation_reads;
CREATE TRIGGER trg_conversation_reads_set_school_id
  BEFORE INSERT ON conversation_reads
  FOR EACH ROW EXECUTE FUNCTION conversation_reads_set_school_id();

-- message_edits ← messages.school_id (must run AFTER messages has it)
ALTER TABLE message_edits ADD COLUMN IF NOT EXISTS school_id UUID
  REFERENCES schools(id) ON DELETE CASCADE;
UPDATE message_edits me SET school_id = m.school_id
  FROM messages m WHERE me.message_id = m.id AND me.school_id IS NULL;
ALTER TABLE message_edits ALTER COLUMN school_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_edits_school ON message_edits(school_id);
CREATE OR REPLACE FUNCTION message_edits_set_school_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    SELECT school_id INTO NEW.school_id FROM messages WHERE id = NEW.message_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_message_edits_set_school_id ON message_edits;
CREATE TRIGGER trg_message_edits_set_school_id
  BEFORE INSERT ON message_edits
  FOR EACH ROW EXECUTE FUNCTION message_edits_set_school_id();

-- fee_plan_classes ← fee_plans.school_id
ALTER TABLE fee_plan_classes ADD COLUMN IF NOT EXISTS school_id UUID
  REFERENCES schools(id) ON DELETE CASCADE;
UPDATE fee_plan_classes fpc SET school_id = fp.school_id
  FROM fee_plans fp WHERE fpc.fee_plan_id = fp.id AND fpc.school_id IS NULL;
ALTER TABLE fee_plan_classes ALTER COLUMN school_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fee_plan_classes_school ON fee_plan_classes(school_id);
CREATE OR REPLACE FUNCTION fee_plan_classes_set_school_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    SELECT school_id INTO NEW.school_id FROM fee_plans WHERE id = NEW.fee_plan_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_fee_plan_classes_set_school_id ON fee_plan_classes;
CREATE TRIGGER trg_fee_plan_classes_set_school_id
  BEFORE INSERT ON fee_plan_classes
  FOR EACH ROW EXECUTE FUNCTION fee_plan_classes_set_school_id();

-- ── 2. Grants on the `authenticated` role ────────────────────────────────
-- PostgREST switches into this role when a JWT signs role:'authenticated'.
-- It does NOT have BYPASSRLS, which is the whole point. Re-applied
-- explicitly here so the script reproduces on a restored database (see
-- the cross-project restore notes — grants must be reattached).
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- ── 3. Tenant-isolation helper + policies (created, NOT enabled) ─────────

-- Read the school_id claim out of the JWT PostgREST forwards. STABLE so
-- the planner can fold it into row filters / index lookups.
CREATE OR REPLACE FUNCTION app_current_school_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::jsonb ->> 'school_id',
    ''
  )::uuid
$$;

-- Special policy for `schools` itself: the tenant *is* the row.
DROP POLICY IF EXISTS tenant_isolation ON schools;
CREATE POLICY tenant_isolation ON schools
  USING      (id = app_current_school_id())
  WITH CHECK (id = app_current_school_id());

-- Standard policy on every other table: school_id must match the JWT claim.
-- One macro applies to all 67 tables (59 originally-scoped + 5 newly
-- denormalized + 3 general-ledger). DROP-IF-EXISTS makes the whole block re-runnable.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'users','buses','classes','schedule_assignments','parents','teachers','drivers',
    'students','homework','assignments','mark_types','terms','grades','reports',
    'announcements','announcement_likes','announcement_comments','announcement_comment_likes',
    'notifications','bus_locations','appointments','weekly_summaries','weekly_summary_periods',
    'subjects','subject_teachers','class_subject_teachers','attendance',
    'password_reset_requests','refresh_tokens','device_tokens','bus_ride_records',
    'archived_students','archived_employees','archive_backups','academic_posts','ebooks',
    'conversations','chat_access_log','audit_logs','post_likes','post_saves','post_comments',
    'post_comment_likes','ebook_progress','student_access_locks','fee_plans',
    'fee_installments','student_fees','fee_payments','fee_payment_allocations',
    'staff_members','staff_salary_payments','expense_categories',
    'expense_recurring_templates','expenses','student_fee_late_fees','accounting_periods',
    'payment_accounts','fx_rates',
    -- newly denormalized in section 1 above:
    'teacher_classes','messages','conversation_reads','message_edits','fee_plan_classes',
    'chart_of_accounts','journal_entries','journal_lines'
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
  END LOOP;
END $$;

-- (No ENABLE ROW LEVEL SECURITY here — Phase 4 owns that, table by table.)

-- ============================================================================
-- RLS PHASE 4 — uniformly ENABLE + FORCE row-level security on every table.
--
-- Idempotent. Some tables already have RLS on (from earlier "Enable RLS &
-- run query" clicks in the Supabase editor); this block applies ENABLE +
-- FORCE consistently across all 68 tables.
--
-- After this runs, any query made under the `authenticated` Postgres role
-- (the role PostgREST switches into when our minted JWT carries
-- role:'authenticated') is filtered by the tenant_isolation policy created
-- in Phase 2. The service_role client (adminDb) still BYPASSRLS by design
-- — the elevated controllers (admin/accounting/auth/utils) continue
-- working unchanged. FORCE ensures even the table owner obeys policies
-- (defence in depth against direct ad-hoc table-owner connections).
--
-- ORDER OF OPERATIONS (must follow exactly):
--   1. Phase 3 backend changes are deployed (req.db plumbing live).
--   2. Run THIS block in Supabase SQL editor.
--   3. Verify with the queries below (expect 68 / 68 / 68).
--   4. Set SUPABASE_ANON_KEY + SUPABASE_JWT_SECRET in Railway env vars.
--   5. Railway redeploys → tenant controllers now talk to the DB as the
--      `authenticated` role → policies physically enforce per-school
--      isolation.
-- ============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'schools',
    'users','buses','classes','schedule_assignments','parents','teachers','drivers',
    'students','homework','assignments','mark_types','terms','grades','reports',
    'announcements','announcement_likes','announcement_comments','announcement_comment_likes',
    'notifications','bus_locations','appointments','weekly_summaries','weekly_summary_periods',
    'subjects','subject_teachers','class_subject_teachers','attendance',
    'password_reset_requests','refresh_tokens','device_tokens','bus_ride_records',
    'archived_students','archived_employees','archive_backups','academic_posts','ebooks',
    'conversations','chat_access_log','audit_logs','post_likes','post_saves','post_comments',
    'post_comment_likes','ebook_progress','student_access_locks','fee_plans',
    'fee_installments','student_fees','fee_payments','fee_payment_allocations',
    'staff_members','staff_salary_payments','expense_categories',
    'expense_recurring_templates','expenses','student_fee_late_fees','accounting_periods',
    'payment_accounts','fx_rates',
    'teacher_classes','messages','conversation_reads','message_edits','fee_plan_classes',
    'chart_of_accounts','journal_entries','journal_lines'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',  t);
  END LOOP;
END $$;

-- Verification (run separately; expect 68 / 68 / 68) ─────────────────────────
--   SELECT count(*) FROM pg_class
--    WHERE relkind='r' AND relrowsecurity = true
--      AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');
--
--   SELECT count(*) FROM pg_class
--    WHERE relkind='r' AND relforcerowsecurity = true
--      AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');
--
--   SELECT count(*) FROM pg_policies
--    WHERE policyname='tenant_isolation' AND schemaname='public';
--
-- Rollback for a single table (if it misbehaves):
--   ALTER TABLE <table> NO FORCE ROW LEVEL SECURITY;
--   ALTER TABLE <table> DISABLE ROW LEVEL SECURITY;
