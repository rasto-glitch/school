-- Migration 046 — extend audit_logs.entity_type to cover chart-of-accounts
-- and journal-entry mutations (HD-4 from HISTORICAL_DATA_AUDIT.md).
--
-- The constraint was last updated in migration 041 to add 'report'. The
-- accountant-side controllers (closePeriod, payment-account / FX-rate
-- CRUD, etc.) already write to audit_logs — but every glaccounting.*
-- controller did NOT. With this migration the entity_type CHECK accepts
-- two new values; the controllers in this PR then call logAudit() with
-- them.

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
    -- HD-4 — accountant chart + manual journal entries
    'chart_of_account','journal_entry'
  )
);
