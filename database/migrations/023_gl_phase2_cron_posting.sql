-- ============================================================================
-- 023 — General Ledger Phase 2: post GL entries from the SQL cron functions
-- ============================================================================
-- Late fees and recurring expenses are materialized by pg_cron SQL functions
-- (migration 009), bypassing the TypeScript controllers entirely. So their GL
-- entries must be posted from inside those functions — otherwise the nightly
-- run would leave the books out of sync.
--
-- Both post via gl_post_entry() (Phase 1) and resolve accounts by code:
--   late fee          → Dr Accounts Receivable (1100) / Cr Late Fee Income (4100)
--   recurring expense → Dr Expense(category | 5090 fallback) / Cr Cash (1000)
--
-- Posting is SKIPPED when the school has no seeded chart of accounts (a school
-- that isn't using the GL yet). The late fee / expense still records; only the
-- GL entry is skipped. Re-runnable (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION apply_late_fees() RETURNS void AS $$
DECLARE
  r RECORD;
  v_ar  uuid;
  v_inc uuid;
BEGIN
  -- Insert the overdue late fees (unchanged set-based logic) and loop over the
  -- freshly-created rows to post each one to the GL.
  FOR r IN
    WITH ins AS (
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
        )
      RETURNING id, school_id, student_fee_id, amount
    )
    SELECT i.id, i.school_id, i.amount, sf2.student_id, fp2.currency
    FROM ins i
    JOIN student_fees sf2 ON sf2.id = i.student_fee_id
    JOIN fee_plans    fp2 ON fp2.id = sf2.fee_plan_id
  LOOP
    IF r.amount IS NULL OR r.amount <= 0 THEN CONTINUE; END IF;
    SELECT id INTO v_ar  FROM chart_of_accounts WHERE school_id = r.school_id AND code = '1100' AND is_active;
    SELECT id INTO v_inc FROM chart_of_accounts WHERE school_id = r.school_id AND code = '4100' AND is_active;
    IF v_ar IS NOT NULL AND v_inc IS NOT NULL THEN
      PERFORM gl_post_entry(
        r.school_id, CURRENT_DATE, COALESCE(r.currency, 'USD'), 'late_fee', r.id,
        'Late fee', NULL, false, NULL,
        jsonb_build_array(
          jsonb_build_object('account_id', v_ar,  'debit', r.amount, 'credit', 0, 'student_id', r.student_id),
          jsonb_build_object('account_id', v_inc, 'debit', 0, 'credit', r.amount, 'student_id', r.student_id)
        ));
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auto_record_recurring_expenses() RETURNS void AS $$
DECLARE
  r RECORD;
  v_expense_id uuid;
  v_exp_acct   uuid;
  v_cash       uuid;
BEGIN
  LOOP
    SELECT * INTO r FROM expense_recurring_templates
    WHERE is_active AND next_due_date IS NOT NULL AND next_due_date <= CURRENT_DATE
    ORDER BY next_due_date LIMIT 1;
    EXIT WHEN NOT FOUND;

    INSERT INTO expenses (school_id, category_id, template_id, name, amount, currency, expense_date, vendor, notes)
    VALUES (r.school_id, r.category_id, r.id, r.name, r.amount, r.currency, r.next_due_date, r.vendor, r.notes)
    RETURNING id INTO v_expense_id;

    -- GL: Dr Expense(category, or 5090 fallback) / Cr Cash (1000). Auto-record
    -- has no payment account, so it always hits the default cash account.
    IF r.amount IS NOT NULL AND r.amount > 0 THEN
      SELECT id INTO v_exp_acct FROM chart_of_accounts
        WHERE school_id = r.school_id AND expense_category_id = r.category_id AND is_active LIMIT 1;
      IF v_exp_acct IS NULL THEN
        SELECT id INTO v_exp_acct FROM chart_of_accounts WHERE school_id = r.school_id AND code = '5090' AND is_active;
      END IF;
      SELECT id INTO v_cash FROM chart_of_accounts WHERE school_id = r.school_id AND code = '1000' AND is_active;
      IF v_exp_acct IS NOT NULL AND v_cash IS NOT NULL THEN
        PERFORM gl_post_entry(
          r.school_id, r.next_due_date, COALESCE(r.currency, 'USD'), 'expense', v_expense_id,
          r.name, NULL, false, NULL,
          jsonb_build_array(
            jsonb_build_object('account_id', v_exp_acct, 'debit', r.amount, 'credit', 0),
            jsonb_build_object('account_id', v_cash,     'debit', 0, 'credit', r.amount)
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
