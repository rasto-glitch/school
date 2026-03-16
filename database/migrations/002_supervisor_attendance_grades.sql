-- ============================================================
-- Migration 002 — Supervisor role, attendance table, grades columns
-- Safe to run multiple times (all statements are idempotent)
-- ============================================================

-- 1. Expand users.role CHECK to include 'supervisor'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('parent','teacher','admin','driver','supervisor'));

-- 2. Add missing columns to grades table
ALTER TABLE grades ADD COLUMN IF NOT EXISTS term_exam_grade NUMERIC(5,2) DEFAULT 0;
ALTER TABLE grades ADD COLUMN IF NOT EXISTS academic_year TEXT;

-- 3. Create attendance table
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present','absent','late')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(student_id, class_id, date)
);

-- 4. Indexes for attendance and grades
CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_class ON attendance(class_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_school_date ON attendance(school_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_grades_student_subject ON grades(student_id, subject, grading_period);
