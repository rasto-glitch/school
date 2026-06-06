-- 040_audit_user_session.sql
-- Adds 'user_session' to the audit_logs entity_type CHECK so we can log
-- session lifecycle events: successful logins (including which factor
-- path was used — password, MFA, or trusted device), and user-initiated
-- session revocations from the new sessions list UI.

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
    'user_account',
    'user_mfa',
    'trusted_device',
    -- Login + session events (migration 040)
    'user_session'
  )
);
