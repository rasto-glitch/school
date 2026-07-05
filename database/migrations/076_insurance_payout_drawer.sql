-- ============================================================
-- Migration 076 — insurance payout through a real drawer, in drawer currency
-- (2026-07-02 functional audit M-5 + M-6 — "Part 2" of the insurance flow)
--
-- The payout of withheld staff insurance used to be GL-posted as
-- Dr Insurance Payable / Cr the phantom system Cash account (code 1000),
-- in the salary-entered currency — no drawer involved at all. So:
--   • M-5: the drawer that physically handed over the cash showed no
--     outflow (account 1000 drifted negative instead), and the drawer
--     display balance kept counting the paid-out cash forever.
--   • M-6: the payable was credited in DRAWER currency at salary time
--     but debited in SALARY currency at payout — across currencies the
--     liability never cleared in either book.
--
-- The payout now picks a drawer, converts at the payout-date rate
-- (product decision: always today's rate, never the withholding-day
-- rate; small FX residue on the payable is accepted when rates moved)
-- and posts entirely in the drawer's currency. The payout is a field
-- update on staff_members (not a separate row), so these columns freeze
-- the drawer view of the payout there, mirroring migration 056's
-- paid_* columns on staff_salary_payments:
--   • insurance_paid_out_account_id                  → drawer the cash left
--   • insurance_paid_out_paid_amount/_paid_currency  → cash that left it
--   • insurance_paid_out_exchange_rate → 1 payout-ccy = rate drawer-ccy
-- The drawer-balance calc (accounting.controller) subtracts
-- insurance_paid_out_paid_amount per account.
--
-- No backfill: pre-076 payouts involved no drawer (GL credited account
-- 1000), so a NULL account_id correctly keeps them out of every drawer's
-- balance. Reversing and re-recording an old payout upgrades it.
-- ============================================================

ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS insurance_paid_out_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS insurance_paid_out_paid_amount NUMERIC(14,2);
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS insurance_paid_out_paid_currency TEXT;
ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS insurance_paid_out_exchange_rate NUMERIC(18,8);
