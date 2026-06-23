-- Migration 057 — cross-currency tuition (fee) payments + expenses.
--
-- Mirrors migration 056 (staff salary FX) for the inflow + expense side. A fee
-- paid in one currency (e.g. IQD) into a drawer in another (e.g. USD), or an
-- expense paid out of a different-currency drawer, now converts at the
-- configured fx_rate. amount/currency stay the fee/expense denomination;
-- paid_* capture the real cash that moved through the drawer.
--   • amount / currency      → the fee/expense as recorded (unchanged meaning)
--   • paid_amount / paid_currency → the cash into/out of the drawer
--   • exchange_rate          → 1 unit of `currency` = `exchange_rate` of paid_currency

ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS paid_amount   NUMERIC(14,2);
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS paid_currency TEXT;
ALTER TABLE fee_payments ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8);

ALTER TABLE expenses     ADD COLUMN IF NOT EXISTS paid_amount   NUMERIC(14,2);
ALTER TABLE expenses     ADD COLUMN IF NOT EXISTS paid_currency TEXT;
ALTER TABLE expenses     ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,8);

-- Backfill existing rows: no conversion happened (paid == recorded at rate 1).
UPDATE fee_payments
   SET paid_amount = amount, paid_currency = currency, exchange_rate = 1
 WHERE paid_amount IS NULL;

UPDATE expenses
   SET paid_amount = amount, paid_currency = currency, exchange_rate = 1
 WHERE paid_amount IS NULL;
