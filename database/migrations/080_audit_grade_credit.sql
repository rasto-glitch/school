-- ============================================================
-- Migration 080 — audit_logs entity_type: add 'grade_credit'
--
-- Credit-mark allocations (migration 079, CREDIT_MARKS_PLAN.md) are audited
-- rows — who granted how much support to whom, per round/subject. The
-- audit_logs CHECK constraint predates them, so the best-effort logAudit()
-- writes were silently rejected (caught during E2E verification). Same
-- widen-the-check pattern as migrations 015/028/029/…/067. Idempotent.
-- ============================================================

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
    'admin_clearance',
    'grade_filing_window',
    'staff_attendance','staff_leave',
    'report_card',
    'student_health',
    -- Migration 080 — credit marks (نمرەی هاوکاری)
    'grade_credit'
  )
);
