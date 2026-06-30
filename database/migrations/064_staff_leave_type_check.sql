-- ============================================================
-- Migration 064 — constrain staff_leave.leave_type.
--   Phase 1 (migration 063) created staff_leave.leave_type as a free-text
--   column (DEFAULT 'other'). Phase 4 adds the admin leave-management UI,
--   which writes a fixed vocabulary — pin it down at the DB so a bad/legacy
--   value can never reach the board's on-leave logic. Mirrors the closed
--   enums on staff_attendance.status / audit_logs.entity_type.
--
--   Vocabulary: sick | vacation | personal | unpaid | official | other.
--   ('official' = school-sanctioned duty leave, e.g. training/conference.)
-- Safe to run multiple times (idempotent: DROP IF EXISTS then ADD).
-- ============================================================

-- Heal any pre-existing rows that fall outside the vocabulary before the
-- constraint is (re)applied, so the ADD can never fail on legacy data.
UPDATE staff_leave
  SET leave_type = 'other'
  WHERE leave_type IS NULL
     OR leave_type NOT IN ('sick','vacation','personal','unpaid','official','other');

ALTER TABLE staff_leave DROP CONSTRAINT IF EXISTS staff_leave_type_check;
ALTER TABLE staff_leave ADD CONSTRAINT staff_leave_type_check
  CHECK (leave_type IN ('sick','vacation','personal','unpaid','official','other'));
