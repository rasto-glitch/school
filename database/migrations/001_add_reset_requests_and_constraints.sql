-- ============================================================
-- Migration 001 — Run this if you already have the schema deployed
-- Safe to run multiple times (all statements are idempotent)
-- ============================================================

-- 1. Add password_reset_requests table
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  full_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  requested_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Add unique constraint on classes(school_id, name) if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'classes_school_id_name_key'
      AND conrelid = 'classes'::regclass
  ) THEN
    ALTER TABLE classes ADD CONSTRAINT classes_school_id_name_key UNIQUE (school_id, name);
  END IF;
END $$;

-- 3. Expand notification_type CHECK to include 'system'
--    Drop and recreate the constraint (safe — existing data uses valid types)
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_notification_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_notification_type_check
  CHECK (notification_type IN ('homework','assignment','announcement','bus','grade','general','system'));
