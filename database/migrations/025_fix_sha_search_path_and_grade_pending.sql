-- Migration 025 — two unrelated production fixes
--
-- 1. ARCHIVE / AUDIT HASHING (blocker)
--    The tamper-evidence hash triggers (migration 019) call _sha(), which
--    calls digest() from pgcrypto. pgcrypto lives in the `extensions` schema,
--    but _sha referenced digest UNQUALIFIED with no pinned search_path. It
--    resolved in the SQL editor (path includes extensions) but FAILED over the
--    backend connection (PostgREST/service_role, path = public only):
--        ERROR 42883: function digest(unknown, unknown) does not exist
--    This aborted every archived_students / archived_employees / audit_logs
--    insert through the API — surfacing as a 500 "Invalid request" on student
--    archive, and silently dropping backend audit-log writes (logAudit is
--    best-effort). 019's backfill never caught it because an empty
--    archived_students table meant _sha was never actually executed during the
--    migration.
--
--    A function's SET search_path applies during its own execution regardless
--    of caller, and _sha is the only function that touches digest, so pinning
--    _sha alone repairs all three hash paths.
--
-- 2. NOTIFICATIONS CHECK CONSTRAINT
--    The grade release gate notifies admins with notification_type
--    'grade_pending', which was never added to notifications_notification_type_check.
--    Every such insert violated the constraint (swallowed by the .catch(),
--    so grades still saved — only the admin alert was lost).

-- ── 1 ──────────────────────────────────────────────────────────────────
ALTER FUNCTION _sha(text) SET search_path = public, extensions;

-- ── 2 ──────────────────────────────────────────────────────────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_notification_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check
  CHECK (notification_type IN (
    'homework','assignment','announcement','bus','grade','grade_pending',
    'general','system','report','appointment','post',
    'payment_recorded','fees_reminder','salary_due_soon','salary_paid'
  ));
