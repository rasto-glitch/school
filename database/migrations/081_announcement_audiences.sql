-- 081: rework announcement audiences.
--
-- 'students' was never a real audience — students don't log in; their parents
-- represent them (the parent feed already treated 'students' as parent-visible).
-- Fold existing rows into 'parents' and drop the value. New audiences:
--   admins      → admin + reception accounts (front desk works under admin)
--   supervisors → supervisor accounts
--   staff       → generic staff + accountant accounts
-- Visibility per role lives in getAnnouncements (admin.controller.ts); the
-- notification fan-out map lives in createAnnouncement.
--
-- Idempotent: safe to re-run.

BEGIN;

UPDATE announcements SET target_audience = 'parents' WHERE target_audience = 'students';

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_target_audience_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_target_audience_check
  CHECK (target_audience IN ('all', 'parents', 'teachers', 'admins', 'supervisors', 'staff'));

COMMIT;
