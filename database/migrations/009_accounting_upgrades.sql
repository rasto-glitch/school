-- ============================================================
-- 009 — Accounting upgrades
--   * Receipt numbers (legal/audit)
--   * Currency on fee_payments (was implicit default)
--   * Tax/withholding fields on payments + expenses + salaries
--   * Refund linkage
--   * Fee-plan KIND (tuition/transport/lunch/uniform/exam/registration/other)
--   * Late-fee config + applied-late-fee rows
--   * Accounting periods (period close / edit lock)
--   * Payment accounts (cash drawers / bank tills)
--   * FX rates (multi-currency rollup)
--   * audit_logs entity_type union expanded
--   * Daily cron: late-fee apply + recurring-expense auto-record
-- ============================================================

-- 1. Receipt numbering — sequential per (school, calendar year)
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS receipt_number INT;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS receipt_year   INT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_fee_payments_receipt
  ON fee_payments(school_id, receipt_year, receipt_number)
  WHERE receipt_number IS NOT NULL;

-- 2. Currency on fee_payments (multi-currency reporting was previously a lie)
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS currency TEXT;

-- 3. Tax / withholding columns
ALTER TABLE fee_payments         ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE fee_payments         ADD COLUMN IF NOT EXISTS tax_label  TEXT;
ALTER TABLE expenses             ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE expenses             ADD COLUMN IF NOT EXISTS tax_label  TEXT;
ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0);
ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS tax_label  TEXT;

-- 4. Refund linkage. A refund row stores a positive `amount` with is_refund=true;
--    the ledger flips its sign and "refund_of_payment_id" cross-links to the
--    original payment. Both rows remain visible — the refund does NOT void the
--    original (history matters for receipts).
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS is_refund BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS refund_of_payment_id UUID REFERENCES fee_payments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fee_payments_refund_of ON fee_payments(refund_of_payment_id) WHERE refund_of_payment_id IS NOT NULL;

-- 5. Fee-plan KIND. Lets schools model transport, lunch, exam, uniform etc.
--    as first-class fee plans instead of bolting them onto "tuition".
ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'tuition'
  CHECK (kind IN ('tuition','transport','lunch','uniform','exam','registration','other'));
CREATE INDEX IF NOT EXISTS idx_fee_plans_kind ON fee_plans(school_id, kind, is_active);

-- 6. Late-fee config on fee_plans + applied-late-fee rows
ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS late_fee_enabled    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS late_fee_type       TEXT CHECK (late_fee_type IS NULL OR late_fee_type IN ('fixed','percent'));
ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS late_fee_amount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (late_fee_amount >= 0);
ALTER TABLE fee_plans ADD COLUMN IF NOT EXISTS late_fee_grace_days INT NOT NULL DEFAULT 0 CHECK (late_fee_grace_days >= 0);

CREATE TABLE IF NOT EXISTS student_fee_late_fees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_fee_id UUID NOT NULL REFERENCES student_fees(id) ON DELETE CASCADE,
  fee_installment_id UUID NOT NULL REFERENCES fee_installments(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  applied_on DATE NOT NULL DEFAULT CURRENT_DATE,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (student_fee_id, fee_installment_id)
);
CREATE INDEX IF NOT EXISTS idx_late_fees_school ON student_fee_late_fees(school_id);
CREATE INDEX IF NOT EXISTS idx_late_fees_student_fee ON student_fee_late_fees(student_fee_id) WHERE voided_at IS NULL;

-- 7. Accounting periods (period close / edit lock). A closed period blocks
--    create/update/delete on any financial row whose date falls inside it.
--    Reopening is allowed but recorded with reason.
CREATE TABLE IF NOT EXISTS accounting_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  closed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  reopened_at  TIMESTAMPTZ,
  reopened_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reopen_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (period_end >= period_start),
  UNIQUE (school_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_school
  ON accounting_periods(school_id, period_start DESC) WHERE reopened_at IS NULL;

-- 8. Payment accounts (cash drawers / bank tills / wallets). Optional FK on
--    every cash-touching row so the school can answer "how much is in the
--    safe right now".
CREATE TABLE IF NOT EXISTS payment_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cash','bank','wallet','other')),
  currency TEXT NOT NULL DEFAULT 'USD',
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, name)
);
CREATE INDEX IF NOT EXISTS idx_payment_accounts_school ON payment_accounts(school_id, is_active);

ALTER TABLE fee_payments          ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL;
ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL;
ALTER TABLE expenses              ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL;

-- 9. FX rates — school-defined. Used by reports that opt-in to a single-
--    currency rollup. 1 unit of from_currency = `rate` units of to_currency.
CREATE TABLE IF NOT EXISTS fx_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  from_currency TEXT NOT NULL,
  to_currency   TEXT NOT NULL,
  rate          NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (school_id, from_currency, to_currency, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_fx_rates_lookup
  ON fx_rates(school_id, from_currency, to_currency, effective_from DESC);

-- 10. Backfills

-- 10a. Currency on fee_payments — pull from school tuition_config
UPDATE fee_payments fp SET currency = COALESCE(
  (SELECT (s.tuition_config->>'currency')::text FROM schools s WHERE s.id = fp.school_id),
  'USD'
) WHERE currency IS NULL;
ALTER TABLE fee_payments ALTER COLUMN currency SET DEFAULT 'USD';
ALTER TABLE fee_payments ALTER COLUMN currency SET NOT NULL;

-- 10b. Receipt numbers — sequential per (school, year-of-paid_on), oldest first
WITH ranked AS (
  SELECT id,
         school_id,
         EXTRACT(YEAR FROM paid_on)::INT AS yr,
         ROW_NUMBER() OVER (
           PARTITION BY school_id, EXTRACT(YEAR FROM paid_on)
           ORDER BY paid_on, created_at, id
         ) AS seq
  FROM fee_payments
  WHERE receipt_number IS NULL
)
UPDATE fee_payments fp
SET receipt_number = ranked.seq, receipt_year = ranked.yr
FROM ranked
WHERE fp.id = ranked.id;

-- 11. Extend audit_logs entity_type to cover new entities
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entity_type_check;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_entity_type_check
  CHECK (entity_type IN (
    'student','fee_plan','student_fee','fee_payment','staff_member','staff_salary_payment',
    'expense_category','expense_template','expense',
    'accounting_period','payment_account','fx_rate','late_fee'
  ));

-- 12. Daily cron functions

-- Auto-apply late fees for overdue installments based on each plan's late-fee config.
-- A late fee is applied once per (student_fee, installment) — idempotent on re-run.
CREATE OR REPLACE FUNCTION apply_late_fees() RETURNS void AS $$
BEGIN
  INSERT INTO student_fee_late_fees (school_id, student_fee_id, fee_installment_id, amount, applied_on)
  SELECT
    sf.school_id, sf.id, fi.id,
    CASE
      WHEN fp.late_fee_type = 'fixed'   THEN fp.late_fee_amount
      WHEN fp.late_fee_type = 'percent' THEN ROUND(fi.amount * fp.late_fee_amount / 100, 2)
      ELSE 0
    END AS amount,
    CURRENT_DATE
  FROM student_fees sf
  JOIN fee_plans        fp ON fp.id = sf.fee_plan_id
  JOIN fee_installments fi ON fi.fee_plan_id = sf.fee_plan_id
  WHERE fp.late_fee_enabled
    AND fp.voided_at IS NULL
    AND (fi.due_date + (fp.late_fee_grace_days || ' days')::INTERVAL)::DATE < CURRENT_DATE
    AND NOT EXISTS (
      SELECT 1 FROM student_fee_late_fees x
      WHERE x.student_fee_id = sf.id AND x.fee_installment_id = fi.id
    );
END;
$$ LANGUAGE plpgsql;

-- Auto-record recurring expenses on/after their next_due_date, then roll the
-- template's next_due_date forward by its cadence. Loops in case multiple
-- periods have passed without the cron running.
CREATE OR REPLACE FUNCTION auto_record_recurring_expenses() RETURNS void AS $$
DECLARE r RECORD;
BEGIN
  LOOP
    SELECT * INTO r FROM expense_recurring_templates
    WHERE is_active AND next_due_date IS NOT NULL AND next_due_date <= CURRENT_DATE
    ORDER BY next_due_date LIMIT 1;
    EXIT WHEN NOT FOUND;

    INSERT INTO expenses (school_id, category_id, template_id, name, amount, currency, expense_date, vendor, notes)
    VALUES (r.school_id, r.category_id, r.id, r.name, r.amount, r.currency, r.next_due_date, r.vendor, r.notes);

    UPDATE expense_recurring_templates
    SET next_due_date = CASE r.cadence
      WHEN 'monthly'   THEN (r.next_due_date + INTERVAL '1 month')::DATE
      WHEN 'quarterly' THEN (r.next_due_date + INTERVAL '3 months')::DATE
      WHEN 'yearly'    THEN (r.next_due_date + INTERVAL '1 year')::DATE
    END
    WHERE id = r.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Schedule both daily (pg_cron). 02:00 UTC late-fee; 02:05 UTC recurring-expense.
DO $$ BEGIN
  PERFORM cron.unschedule('apply_late_fees_daily');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('apply_late_fees_daily', '0 2 * * *', $$SELECT apply_late_fees()$$);

DO $$ BEGIN
  PERFORM cron.unschedule('record_recurring_expenses_daily');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('record_recurring_expenses_daily', '5 2 * * *', $$SELECT auto_record_recurring_expenses()$$);
