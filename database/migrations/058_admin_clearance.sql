-- Migration 058 — admin capability/clearance model (Phase A foundation).
--
-- Today every admin is all-powerful: the auth layer is flat role-based
-- (authorize('admin')), and the ONLY sub-clearance that exists is
-- users.is_hr_officer (migration 028). This migration introduces a
-- capability-based clearance model layered on the admin role:
--
--   * users.is_owner          — the top tier. Owners hold every capability
--                               implicitly (incl. read-only finance) and are
--                               the only tier that can grant the Owner bit or
--                               IT/finance/audit/settings capabilities.
--   * users.admin_capabilities — the explicit per-admin grant list. A text[]
--                               of capability keys (see the 12-key enum in
--                               src/constants/clearance.ts). Owners ignore
--                               this list (they have everything); non-owners
--                               are gated by it.
--
-- HARD RULE enforced in the app (auth.controller login()): an admin with
-- is_owner=false AND an empty admin_capabilities array cannot log in — they
-- are "pending clearance". That two-step (create → grant) falls out for
-- free from these defaults.
--
-- MIGRATION SAFETY: every EXISTING admin is backfilled to is_owner=true with
-- all 12 capabilities, so nothing breaks — the whole estate keeps working
-- exactly as before, and operators choose later who to down-tier. The old
-- is_hr_officer flag is preserved (Phase B retires it); HR-officer admins are
-- already covered because Owners hold hr.read/hr.manage implicitly.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_capabilities TEXT[] NOT NULL DEFAULT '{}';

-- Fast lookup of "who are the owners in this school?" (last-owner guard,
-- clearance panel). Partial index — only owner rows are interesting.
CREATE INDEX IF NOT EXISTS idx_users_owner
  ON users(school_id) WHERE is_owner = TRUE;

-- ── Backfill existing admins → full Owner ──────────────────────────────────
-- Every current admin becomes an Owner with the complete capability set, so
-- no existing access is lost on deploy. New admins created after this
-- migration start pending (is_owner=false, empty caps) unless the granter
-- assigns scope at creation.
UPDATE users
SET is_owner = TRUE,
    admin_capabilities = ARRAY[
      'enrollment.read','students.manage','staff.manage','academics.oversee',
      'transfers.manage','accounts.manage','finance.read','hr.read','hr.manage',
      'audit.read','settings.manage','announcements.moderate'
    ]
WHERE role = 'admin';

-- ── Widen audit_logs.entity_type ───────────────────────────────────────────
-- New entity_type 'admin_clearance' for clearance grant/revoke + owner.set
-- events (logged with action='update' and a label of clearance.grant /
-- clearance.revoke / owner.set). Last set in migration 046.
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check CHECK (
  entity_type IN (
    'student','fee_plan','student_fee','fee_payment','staff_member','staff_salary_payment',
    'expense_category','expense_template','expense',
    'accounting_period','payment_account','fx_rate','late_fee',
    'teacher','driver','supervisor','admin','reception','accountant',
    'employee_document','employee_profile',
    'employee_extended_profile','employee_emergency_contact',
    'school_policy','employee_acknowledgement','employee_action',
    'hr_officer',
    'archived_employee','archived_student',
    'class','student_transfer','attendance',
    'user_account','user_mfa','trusted_device','user_session',
    'report',
    'chart_of_account','journal_entry',
    -- Phase A — admin capability/clearance grants
    'admin_clearance'
  )
);
