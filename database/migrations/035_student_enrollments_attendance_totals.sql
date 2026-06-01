-- Migration 035 — student_enrollments.attendance_totals
--
-- Phase B of the attendance-history work. Each per-year enrollment row
-- now carries a frozen summary of how the student attended that year:
--   { present: int, absent: int, late: int, excused: int }
--
-- Lifecycle (locked design):
--   * Computed and written when the row closes (status transitions out
--     of 'enrolled' — promoted / retained / on_leave / withdrew /
--     transferred / graduated). Set in closeEnrollmentForYear and
--     closeCurrentEnrollment (utils/studentEnrollments.ts).
--   * Recomputed when a supervisor edits attendance on a date that
--     falls within a closed year (rare, but supervisor overrides past
--     locked-day records — see Phase A audit-logged path).
--   * Gated by the archive feature: archive-OFF schools never set this
--     column. Aligned with the rest of "history" living behind archive.
--   * Snapshotted into archived_students.enrollment_history when the
--     student is archived, so the numbers survive student cascade.
--
-- The column is nullable on purpose: NULL means "no aggregate yet"
-- (active row, or archive-off school). An object with all zeros means
-- "year was closed but no daily attendance was taken".

ALTER TABLE student_enrollments
  ADD COLUMN IF NOT EXISTS attendance_totals JSONB;

COMMENT ON COLUMN student_enrollments.attendance_totals IS
  'Frozen per-year attendance summary { present, absent, late, excused }. NULL while the row is open or for archive-off schools. Written at close, recomputed on supervisor override of a past-day record.';
