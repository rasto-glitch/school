-- 028_employee_documents.sql
-- Wave 1 of the employee legal-compliance records system.
-- See memory/employee-records-plan.md for the locked decisions and the full
-- two-wave plan. This migration ships:
--
--   1. employee_documents               polymorphic per-employee document
--                                       store (ID scans, passports, signed
--                                       contracts, health certificates,...).
--   2. school_document_categories       per-school category overrides /
--                                       additions on top of the seed catalog
--                                       compiled into the backend.
--   3. users.is_hr_officer              sub-role flag; high-sensitivity
--                                       categories require this to read.
--   4. audit_logs widening              new entity_type values + new action
--                                       values for document/profile events.
--   5. notify_expiring_employee_docs()  daily 06:00 UTC pg_cron job that
--                                       inserts a digest notification for
--                                       each admin of schools with documents
--                                       expiring in the next 30 days.
--
-- Storage prerequisite (RUN BY THE OPERATOR IN SUPABASE STUDIO):
--   Create a NEW PRIVATE bucket named `employee-documents`.
--     - Public: OFF
--     - File size limit: 10 MB (matches backend enforcement)
--     - Allowed MIME types: image/jpeg, image/png, image/webp,
--                           application/pdf
--   The backend reads via signed URLs only — never publicUrl. Do NOT reuse
--   the existing public `homework-attachments` bucket: passport scans
--   sitting in a public bucket are a real legal-compliance issue and were
--   flagged in PENTEST_FINDINGS H-2.

-- ── employee_documents ─────────────────────────────────────────────────────
-- One row per uploaded file. owner_type names the table owner_id points at:
--   'teachers'           → teachers.id
--   'drivers'            → drivers.id
--   'staff_members'      → staff_members.id
--   'users'              → users.id   (supervisor/admin/reception/accountant)
--   'archived_employees' → archived_employees.id   (Wave 2 wires the rewrite
--                          on archive; in Wave 1 docs cascade with the parent
--                          row via FK-less ON DELETE rules — see the archive
--                          notes at the bottom of the file)
--
-- sensitivity drives access control (low|medium|high). The backend's category
-- catalog assigns a sensitivity to each seed category; a school override row
-- in school_document_categories can change it.
--
-- scan_status defaults to 'skipped' in Wave 1 (no ClamAV worker yet). Wave 2
-- adds the worker that flips it pending → clean / infected. Reads of
-- 'infected' rows are blocked at the signed-URL endpoint.
--
-- voided_at is the soft-delete column, matching the staff_members /
-- fee_payments pattern. The retention cron added in 024 doesn't touch this
-- table — document retention is a Wave 2 / Wave 3 decision and depends on
-- per-school policy.

CREATE TABLE IF NOT EXISTS employee_documents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  owner_type      TEXT NOT NULL,
  owner_id        UUID NOT NULL,
  category        TEXT NOT NULL,
  sensitivity     TEXT NOT NULL DEFAULT 'medium',
  storage_bucket  TEXT NOT NULL,
  storage_path    TEXT NOT NULL,
  filename        TEXT NOT NULL,
  mime_type       TEXT NOT NULL,
  byte_size       INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  scan_status     TEXT NOT NULL DEFAULT 'skipped',
  document_number TEXT,
  issued_on       DATE,
  expires_on      DATE,
  notes           TEXT,
  uploaded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at       TIMESTAMPTZ,
  voided_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason     TEXT,
  CONSTRAINT employee_documents_owner_type_check CHECK (
    owner_type IN ('users','teachers','drivers','staff_members','archived_employees')
  ),
  CONSTRAINT employee_documents_sensitivity_check CHECK (
    sensitivity IN ('low','medium','high')
  ),
  CONSTRAINT employee_documents_scan_status_check CHECK (
    scan_status IN ('pending','clean','infected','skipped')
  ),
  CONSTRAINT employee_documents_byte_size_check CHECK (
    byte_size >= 0 AND byte_size <= 10485760
  )
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_owner
  ON employee_documents(school_id, owner_type, owner_id)
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_documents_expiring
  ON employee_documents(school_id, expires_on)
  WHERE expires_on IS NOT NULL AND voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_documents_category
  ON employee_documents(school_id, category)
  WHERE voided_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_documents_voided
  ON employee_documents(school_id, voided_at)
  WHERE voided_at IS NOT NULL;

-- ── school_document_categories ─────────────────────────────────────────────
-- Per-school catalog of document categories. The backend ships with a seed
-- catalog (backend/src/utils/employeeDocs.ts → DOCUMENT_CATEGORIES). A row
-- in this table either:
--   • overrides a seed category's label / sensitivity / requires_expiry, or
--   • adds a brand-new category specific to this school
--     (e.g. 'food_safety_certification' for a school that runs a canteen).
--
-- The category text is free-form; the backend merges seed + per-school rows
-- when serving the picker. Inactive rows are hidden from new uploads but
-- existing documents under that category keep working.

CREATE TABLE IF NOT EXISTS school_document_categories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,
  label           TEXT NOT NULL,
  sensitivity     TEXT NOT NULL DEFAULT 'medium',
  requires_expiry BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT school_document_categories_sensitivity_check CHECK (
    sensitivity IN ('low','medium','high')
  ),
  UNIQUE (school_id, category)
);

CREATE INDEX IF NOT EXISTS idx_school_document_categories_school
  ON school_document_categories(school_id, is_active);

-- ── users.is_hr_officer ────────────────────────────────────────────────────
-- Sub-role flag layered on the admin role. Only users with role='admin'
-- should ever carry this flag — the backend enforces that on promotion.
-- High-sensitivity document categories (identity, right-to-work, health,
-- background) require both admin role AND is_hr_officer=true to read.
-- Wave 1 ships the column; the promote/demote UI lands in Wave 2.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_hr_officer BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_hr_officer
  ON users(school_id) WHERE is_hr_officer = TRUE;

-- ── audit_logs widening ────────────────────────────────────────────────────
-- New entity_type values for document + profile events. New action values
-- for read (signed-URL issue) and export (JSON / PDF download).
-- Document context — doc id, ttl seconds, sha256, etc. — lands in the
-- existing `changes` JSONB column under a `_meta` key so we don't have to
-- add new columns.

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check CHECK (
  entity_type IN (
    'student','fee_plan','student_fee','fee_payment','staff_member','staff_salary_payment',
    'expense_category','expense_template','expense',
    'accounting_period','payment_account','fx_rate','late_fee',
    'teacher','driver','supervisor','admin','reception','accountant',
    -- Wave 1 additions:
    'employee_document','employee_profile'
  )
);

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_action_check CHECK (
  action IN ('create','update','delete','read','export')
);

-- ── notify_expiring_employee_docs() ────────────────────────────────────────
-- Daily 06:00 UTC: for every document expiring in the next 30 days (not
-- voided, not infected), insert one notification per admin of the owning
-- school. Idempotent within a day via the (related_id, user_id, DATE)
-- uniqueness check — running the cron twice the same day won't double up.
--
-- This is intentionally a DB function, not a Node cron, so the digest still
-- fires if the backend is down for a few hours during the cron window.

CREATE OR REPLACE FUNCTION notify_expiring_employee_docs() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  doc_row RECORD;
  admin_row RECORD;
  category_label TEXT;
  msg TEXT;
BEGIN
  FOR doc_row IN
    SELECT id, school_id, category, document_number, expires_on, owner_type, owner_id
      FROM employee_documents
     WHERE voided_at IS NULL
       AND scan_status <> 'infected'
       AND expires_on IS NOT NULL
       AND expires_on BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
  LOOP
    -- Resolve a human-friendly category label: school override wins,
    -- otherwise fall back to the raw category key (backend localises it).
    SELECT label INTO category_label
      FROM school_document_categories
     WHERE school_id = doc_row.school_id AND category = doc_row.category;
    IF category_label IS NULL THEN category_label := doc_row.category; END IF;

    msg := 'A ' || category_label || ' expires on ' || doc_row.expires_on::text;
    IF doc_row.document_number IS NOT NULL THEN
      msg := msg || ' (#' || doc_row.document_number || ')';
    END IF;

    FOR admin_row IN
      SELECT u.id AS user_id
        FROM users u
       WHERE u.school_id = doc_row.school_id
         AND u.role = 'admin'
         AND u.is_active = TRUE
    LOOP
      -- Idempotency: skip if we already inserted this exact notification
      -- (same doc, same user) within the last 24 hours.
      IF NOT EXISTS (
        SELECT 1 FROM notifications
         WHERE user_id = admin_row.user_id
           AND related_id = doc_row.id
           AND notification_type = 'employee_doc_expiring'
           AND created_at > NOW() - INTERVAL '24 hours'
      ) THEN
        INSERT INTO notifications (
          school_id, user_id, title, message, notification_type, related_id
        ) VALUES (
          doc_row.school_id, admin_row.user_id,
          'Employee document expiring soon',
          msg,
          'employee_doc_expiring',
          doc_row.id
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Schedule daily at 06:00 UTC. (If pg_cron is already installed for the
-- existing apply_late_fees / cleanup_voided_records jobs, this just adds
-- another entry; the CREATE EXTENSION is harmless if it already exists.)
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Drop any prior schedule so re-running the migration replaces it.
SELECT cron.unschedule('notify_expiring_employee_docs')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify_expiring_employee_docs');
SELECT cron.schedule(
  'notify_expiring_employee_docs',
  '0 6 * * *',
  $$SELECT notify_expiring_employee_docs();$$
);

-- ── Archive coverage (Wave 1 note) ─────────────────────────────────────────
-- When an employee row is hard-deleted (teachers / drivers / staff_members
-- via ON DELETE CASCADE through users), this migration does NOT cascade
-- employee_documents — the rows survive and become orphaned (owner_id no
-- longer resolves). Wave 2's archive flow rewrites owner_type to
-- 'archived_employees' + owner_id to the archive row's id BEFORE the parent
-- is deleted, so legitimate archives never produce orphans.
--
-- For Wave 1 we accept the orphan risk: the existing employee deletion path
-- (admin.controller.ts → deleteTeacher / deleteDriver / staff.deleteStaff)
-- goes through archiveEmployee*() helpers that snapshot HR fields, so an
-- admin won't delete a documented employee without going through the
-- archive path. The Wave 2 migration adds an explicit BEFORE DELETE trigger
-- on the four owner tables that rewrites employee_documents pointers, then
-- this safety net is no longer needed.
