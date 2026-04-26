-- ============================================================
-- Migration 004 — Admin-managed terms (grading periods)
-- Safe to run multiple times.
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
