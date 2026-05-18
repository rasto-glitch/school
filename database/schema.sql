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
  features JSONB DEFAULT '{"homework":true,"assignments":true,"announcements":true,"grades":true,"reports":true,"bus_tracking":true,"appointments":true,"attendance":true,"weekly_summary":true,"chat":true}',
  features_version INTEGER NOT NULL DEFAULT 1,
  tuition_config JSONB DEFAULT '{"currency":"USD","siblingDiscount":{"enabled":false,"type":"percent","tiers":[]}}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Run this if the table already exists:
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{"homework":true,"assignments":true,"announcements":true,"grades":true,"reports":true,"bus_tracking":true,"appointments":true,"attendance":true,"weekly_summary":true,"chat":true}';
-- ALTER TABLE schools ADD COLUMN IF NOT EXISTS features_version INTEGER NOT NULL DEFAULT 1;

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
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Run if table already exists:
-- ALTER TABLE mark_types ADD COLUMN IF NOT EXISTS order_index INTEGER DEFAULT 0;

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Run if table already exists:
-- ALTER TABLE grades ADD COLUMN IF NOT EXISTS marks JSONB DEFAULT '[]';

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);
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
  notification_type TEXT DEFAULT 'general' CHECK (notification_type IN ('homework','assignment','announcement','bus','grade','general','system','report','appointment','post','payment_recorded','fees_reminder','salary_due_soon','salary_paid')),
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
  reason TEXT NOT NULL CHECK (reason IN ('transferred', 'withdrew')),
  parent_full_name TEXT,
  parent_phone TEXT,
  classes_attended JSONB DEFAULT '[]',
  grades JSONB DEFAULT '[]',
  payment_history JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_archived_students_school ON archived_students(school_id, created_at DESC);

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
  role TEXT NOT NULL CHECK (role IN ('teacher', 'driver', 'supervisor', 'staff', 'admin')),
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_archived_employees_school ON archived_employees(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_archived_employees_role ON archived_employees(school_id, role);

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
  p_payment_history JSONB
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
    account, teaching, transport, employment, payment_history
  ) VALUES (
    p_school_id, p_original_employee_id, p_role, p_full_name, p_date_of_birth, p_age,
    p_phone_number, p_email, p_emergency_contact, p_profile_picture, p_position, p_subject,
    p_hire_date, p_departure_date, p_reason,
    COALESCE(p_account, '{}'::jsonb),
    COALESCE(p_teaching, '[]'::jsonb),
    COALESCE(p_transport, '{}'::jsonb),
    COALESCE(p_employment, '{}'::jsonb),
    COALESCE(p_payment_history, '[]'::jsonb)
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
    'accounting_period','payment_account','fx_rate','late_fee'
  )),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_username TEXT,
  actor_role TEXT,
  label TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_school ON audit_logs(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(school_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(school_id, actor_id, created_at DESC);

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

CREATE OR REPLACE FUNCTION cleanup_voided_records() RETURNS void AS $$
BEGIN
  DELETE FROM fee_payments         WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';
  DELETE FROM fee_plans            WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';
  DELETE FROM staff_salary_payments WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';
  DELETE FROM staff_members        WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';
  DELETE FROM expenses             WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';
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
