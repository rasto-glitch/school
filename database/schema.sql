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
  schedule_url TEXT,
  features JSONB DEFAULT '{"homework":true,"assignments":true,"announcements":true,"grades":true,"reports":true,"bus_tracking":true,"appointments":true,"attendance":true,"weekly_summary":true,"chat":true}',
  features_version INTEGER NOT NULL DEFAULT 1,
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
  role TEXT NOT NULL CHECK (role IN ('parent','teacher','admin','driver','supervisor','reception')),
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
  student_id UUID REFERENCES students(id),
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
-- GRADES
-- ============================================================
CREATE TABLE IF NOT EXISTS grades (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
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
  notification_type TEXT DEFAULT 'general' CHECK (notification_type IN ('homework','assignment','announcement','bus','grade','general','system','report','appointment')),
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
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, name)
);

-- ============================================================
-- ATTENDANCE
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_archived_students_school ON archived_students(school_id, created_at DESC);

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS conversation_reads (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

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
