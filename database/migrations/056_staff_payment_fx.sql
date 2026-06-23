-- Migration 056 — cross-currency staff salary payments.
--
-- A salary can be recorded in the staff member's currency (e.g. IQD) but paid
-- from a cash drawer denominated in another currency (e.g. USD). We now convert
-- at the configured fx_rate and record what actually leaves the drawer:
--   • amount / currency      → the salary as entered (unchanged meaning)
--   • paid_amount / paid_currency → the cash that actually left the drawer
--   • exchange_rate          → 1 unit of `currency` = `exchange_rate` of paid_currency
--
-- The drawer-balance calc (accounting.controller) and the GL cash posting use
-- paid_amount/paid_currency so a USD drawer is decremented in USD, not IQD.

ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS paid_amount   NUMERIC(14,2);
ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS paid_currency TEXT;
ALTER TABLE staff_salary_payments ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8);

-- Backfill existing rows: no conversion happened, so paid == recorded at rate 1.
UPDATE staff_salary_payments
   SET paid_amount   = amount,
       paid_currency = currency,
       exchange_rate = 1
 WHERE paid_amount IS NULL;
