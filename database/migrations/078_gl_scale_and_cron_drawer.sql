-- ============================================================================
-- Migration 078 — GL reports at scale + recurring-expense cron drawer/period fix
-- (2026-07-02 functional audit, LOW pile items 1 + 2)
--
-- Part A — gl_aggregate_lines(): the trial balance / P&L / balance sheet used
-- to fetch EVERY journal_lines row through PostgREST and sum in JS. PostgREST
-- caps a response (~1000 rows) and silently drops the rest, so the reports go
-- quietly wrong once a school accumulates real GL volume. Aggregate in SQL —
-- the result set is bounded by (currencies × chart accounts), never by volume.
--
-- Part B — expense_recurring_templates.payment_account_id + a reworked
-- auto_record_recurring_expenses() (replaces migration 023's version):
--   1. Templates can now name the drawer the money leaves. The nightly run
--      posts Cr <drawer's cash account> instead of the phantom system Cash
--      (1000) — the same class of bug audit M-5 removed from insurance
--      payouts — and stamps payment_account_id + paid_* on the expense row so
--      the drawer display balance finally sees nightly expenses.
--   2. Cross-currency templates convert at the latest fx_rate effective on or
--      before the posting date (direct pair, else inverse), mirroring
--      utils/fx.ts resolveDrawerAmount. If the template has no drawer, or no
--      rate exists for the pair, the function falls back to the legacy
--      behavior (post in template currency, Cr 1000, no drawer stamp) — the
--      expense still records, nothing is corrupted, and configuring the
--      template/rate upgrades the next run.
--   3. Period-close: entries used to post on next_due_date, which lands
--      INSIDE a closed accounting period when the cron catches up on an
--      overdue template. The posting date now clamps past closed periods
--      (greatest of due date / CURRENT_DATE / last closed period_end + 1);
--      the original due date is kept in the expense notes.
-- apply_late_fees() is untouched: it posts on CURRENT_DATE, which is
-- realistically never inside a closed period.
-- ============================================================================

-- Part A ─ SQL-side aggregation for the GL reports
CREATE OR REPLACE FUNCTION gl_aggregate_lines(
  p_school_id UUID,
  p_start DATE DEFAULT NULL,
  p_end   DATE DEFAULT NULL
) RETURNS TABLE (
  currency   TEXT,
  account_id UUID,
  code       TEXT,
  name       TEXT,
  type       TEXT,
  debit      NUMERIC,
  credit     NUMERIC
)
LANGUAGE sql STABLE AS $$
  SELECT jl.currency, jl.account_id, coa.code, coa.name, coa.type,
         COALESCE(SUM(jl.debit), 0)  AS debit,
         COALESCE(SUM(jl.credit), 0) AS credit
  FROM journal_lines jl
  JOIN chart_of_accounts coa ON coa.id = jl.account_id
  JOIN journal_entries  je  ON je.id  = jl.entry_id
  WHERE jl.school_id = p_school_id
    AND (p_start IS NULL OR je.entry_date >= p_start)
    AND (p_end   IS NULL OR je.entry_date <= p_end)
  GROUP BY jl.currency, jl.account_id, coa.code, coa.name, coa.type
$$;

-- Part B ─ template drawer + reworked nightly poster
ALTER TABLE expense_recurring_templates
  ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES payment_accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION auto_record_recurring_expenses() RETURNS void AS $$
DECLARE
  r RECORD;
  v_expense_id  uuid;
  v_exp_acct    uuid;
  v_cash        uuid;
  v_drawer_ccy  text;
  v_rate        numeric;
  v_paid_amount numeric;
  v_paid_ccy    text;
  v_post_date   date;
  v_closed_end  date;
  v_note        text;
BEGIN
  LOOP
    SELECT * INTO r FROM expense_recurring_templates
    WHERE is_active AND next_due_date IS NOT NULL AND next_due_date <= CURRENT_DATE
    ORDER BY next_due_date LIMIT 1;
    EXIT WHEN NOT FOUND;

    -- Period clamp: never post into a closed (not-reopened) period. Take the
    -- latest closed period_end that would swallow the due date and step past
    -- it (also never post in the future beyond today unless forced by the
    -- clamp itself).
    v_post_date := r.next_due_date;
    SELECT MAX(period_end) INTO v_closed_end
      FROM accounting_periods
      WHERE school_id = r.school_id AND reopened_at IS NULL
        AND period_start <= v_post_date AND period_end >= v_post_date;
    IF v_closed_end IS NOT NULL THEN
      v_post_date := GREATEST(CURRENT_DATE, v_closed_end + 1);
      v_note := COALESCE(r.notes || ' · ', '') ||
        'Auto-recorded for ' || r.next_due_date::text || ' (period closed; posted ' || v_post_date::text || ')';
    ELSE
      v_note := r.notes;
    END IF;

    -- Drawer resolution: template drawer → its cash account + currency.
    v_cash := NULL; v_drawer_ccy := NULL; v_rate := NULL;
    IF r.payment_account_id IS NOT NULL THEN
      SELECT upper(pa.currency) INTO v_drawer_ccy
        FROM payment_accounts pa
        WHERE pa.id = r.payment_account_id AND pa.school_id = r.school_id AND pa.is_active;
      IF v_drawer_ccy IS NOT NULL THEN
        SELECT id INTO v_cash FROM chart_of_accounts
          WHERE school_id = r.school_id AND payment_account_id = r.payment_account_id AND is_active
          LIMIT 1;
      END IF;
    END IF;

    -- FX: template currency → drawer currency at the posting date (mirrors
    -- utils/fx.ts: direct pair first, else 1/inverse; NULL when unconfigured).
    IF v_cash IS NOT NULL THEN
      IF upper(COALESCE(r.currency, 'USD')) = v_drawer_ccy THEN
        v_rate := 1;
      ELSE
        SELECT rate INTO v_rate FROM fx_rates
          WHERE school_id = r.school_id AND upper(from_currency) = upper(COALESCE(r.currency, 'USD'))
            AND upper(to_currency) = v_drawer_ccy AND effective_from <= v_post_date
          ORDER BY effective_from DESC LIMIT 1;
        IF v_rate IS NULL THEN
          SELECT 1 / rate INTO v_rate FROM fx_rates
            WHERE school_id = r.school_id AND upper(from_currency) = v_drawer_ccy
              AND upper(to_currency) = upper(COALESCE(r.currency, 'USD'))
              AND rate <> 0 AND effective_from <= v_post_date
            ORDER BY effective_from DESC LIMIT 1;
        END IF;
      END IF;
    END IF;

    -- No drawer, no linked cash account, or no rate → legacy fallback
    -- (template currency, phantom 1000, no drawer stamp).
    IF v_cash IS NULL OR v_rate IS NULL THEN
      v_cash := NULL;
      v_paid_amount := r.amount;
      v_paid_ccy := upper(COALESCE(r.currency, 'USD'));
      v_rate := 1;
      INSERT INTO expenses (school_id, category_id, template_id, name, amount, currency, expense_date, vendor, notes,
                            paid_amount, paid_currency, exchange_rate)
      VALUES (r.school_id, r.category_id, r.id, r.name, r.amount, r.currency, v_post_date, r.vendor, v_note,
              v_paid_amount, v_paid_ccy, 1)
      RETURNING id INTO v_expense_id;
    ELSE
      v_paid_amount := round(r.amount * v_rate, 2);
      v_paid_ccy := v_drawer_ccy;
      INSERT INTO expenses (school_id, category_id, template_id, name, amount, currency, expense_date, vendor, notes,
                            payment_account_id, paid_amount, paid_currency, exchange_rate)
      VALUES (r.school_id, r.category_id, r.id, r.name, r.amount, r.currency, v_post_date, r.vendor, v_note,
              r.payment_account_id, v_paid_amount, v_paid_ccy, v_rate)
      RETURNING id INTO v_expense_id;
    END IF;

    -- GL: Dr Expense(category | 5090) / Cr drawer cash (or 1000 fallback),
    -- posted in the currency of the cash that actually moves.
    IF r.amount IS NOT NULL AND r.amount > 0 THEN
      SELECT id INTO v_exp_acct FROM chart_of_accounts
        WHERE school_id = r.school_id AND expense_category_id = r.category_id AND is_active LIMIT 1;
      IF v_exp_acct IS NULL THEN
        SELECT id INTO v_exp_acct FROM chart_of_accounts WHERE school_id = r.school_id AND code = '5090' AND is_active;
      END IF;
      IF v_cash IS NULL THEN
        SELECT id INTO v_cash FROM chart_of_accounts WHERE school_id = r.school_id AND code = '1000' AND is_active;
      END IF;
      IF v_exp_acct IS NOT NULL AND v_cash IS NOT NULL THEN
        PERFORM gl_post_entry(
          r.school_id, v_post_date, v_paid_ccy, 'expense', v_expense_id,
          r.name, NULL, false, NULL,
          jsonb_build_array(
            jsonb_build_object('account_id', v_exp_acct, 'debit', v_paid_amount, 'credit', 0),
            jsonb_build_object('account_id', v_cash,     'debit', 0, 'credit', v_paid_amount)
          ));
      END IF;
    END IF;

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
