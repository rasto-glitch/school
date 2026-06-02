-- 037_audit_user_account.sql
-- Extends the audit_logs.entity_type CHECK to include 'user_account'.
-- Used by self-service auth writes (email change + account recovery) so
-- those high-sensitivity events show up in the admin audit feed instead
-- of being silently swallowed by the best-effort logAudit wrapper.
--
-- Builds on the constraint as last set in migration 029.

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check CHECK (
  entity_type IN (
    'student','fee_plan','student_fee','fee_payment','staff_member','staff_salary_payment',
    'expense_category','expense_template','expense',
    'accounting_period','payment_account','fx_rate','late_fee',
    'teacher','driver','supervisor','admin','reception','accountant',
    -- Wave 1
    'employee_document','employee_profile',
    -- Wave 2
    'employee_extended_profile','employee_emergency_contact',
    'school_policy','employee_acknowledgement','employee_action',
    'hr_officer',
    -- Self-service auth (migration 036 OTP + recovery flow)
    'user_account'
  )
);
