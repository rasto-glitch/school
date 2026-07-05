-- ============================================================
-- Migration 074 — student health records: deletion-on-departure is POLICY
--
-- Decision (2026-07-02, follow-up to the functional audit): when a student
-- leaves the school by ANY path — withdraw-archive, transfer-archive, or an
-- outright delete — their clinic records (student_health_profiles +
-- student_health_visits) are intentionally DESTROYED, not archived. The
-- ON DELETE CASCADE on both tables' student_id FKs (migration 067) is the
-- mechanism; this migration exists to record that the cascade is a chosen
-- medical-privacy / data-minimisation posture, not an oversight.
-- (Graduated students remain live in `students`, so their records persist
-- until the row is eventually archived/deleted — consistent with the rule.)
--
-- If retention is ever wanted: capture both tables into the archive snapshot
-- in admin.controller#buildStudentArchiveSnapshot (keeping *_ct fields
-- ENCRYPTED — never decrypt into the snapshot), add a health JSONB column to
-- archived_students, extend archive_student_atomic, and bump
-- _canon_archived_student to as.v5. No such work is planned for now.
--
-- No schema changes — comments only.
-- ============================================================

COMMENT ON TABLE student_health_profiles IS
  'Clinic-internal medical profile. POLICY (migration 074): destroyed via ON DELETE CASCADE when the student row is deleted (archive/transfer/delete) — deliberate medical-privacy choice, do not "fix" by archiving without an explicit product decision.';

COMMENT ON TABLE student_health_visits IS
  'Clinic nurse-visit log. POLICY (migration 074): destroyed via ON DELETE CASCADE when the student row is deleted (archive/transfer/delete) — deliberate medical-privacy choice, do not "fix" by archiving without an explicit product decision.';
