-- Snapshot tuition payment history into archived_students at archive time.
-- Until now, archiving cascaded a hard delete on students which destroyed
-- all student_fees and fee_payments rows. This column captures a frozen
-- copy at the moment of archiving so the accountant portal can still
-- present a payment record after the student is gone.
ALTER TABLE archived_students
  ADD COLUMN IF NOT EXISTS payment_history JSONB DEFAULT '[]'::jsonb;
