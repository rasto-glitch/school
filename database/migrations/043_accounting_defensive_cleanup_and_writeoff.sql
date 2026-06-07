-- Migration 043 — PR A defensive accounting fixes.
--
-- Closes AC-1, AC-3, AC-4, AC-5 from ACCOUNTANT_AUDIT.md.
--
-- 1) Safer cleanup_voided_records — refuses to hard-delete a voided
--    fee_plan or staff_member that still has dependents (payments,
--    student_fees, salary slips). The original cleanup cascaded through
--    fee_plans → fee_installments → student_fees → fee_payments → late
--    fees, which would silently wipe receipts for everyone on a voided
--    plan after 30 days. Now the parent only goes if every child row is
--    also disposable.
--
-- 2) Timezone-aware apply_late_fees — used to call CURRENT_DATE (UTC),
--    which meant schools in Baghdad got late fees a day off from their
--    own calendar. Now resolves the school's timezone.
--
-- 3) Adds a 5060 "Bad Debt Expense" account to the system chart so the
--    backend's archive-time AR writeoff posting has a target. Existing
--    schools that have already seeded their chart get the row backfilled
--    here; the seeder (utils/glSeed.ts) is updated in the same PR so new
--    schools get it on first seed.
--
-- AC-2 / AC-6 / AC-7 ship in PR B (the feature pass).
--
-- DEMO-DATA NOTE: Scholify currently has only demo data, so we don't
-- need backfill for the existing voided rows.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Safer cleanup_voided_records
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cleanup_voided_records() RETURNS void AS $$
BEGIN
  -- Leaf rows — no children worth preserving. Allocations cascade with
  -- fee_payments; salary slips have no children. Safe to delete directly.
  DELETE FROM fee_payments
   WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';

  DELETE FROM staff_salary_payments
   WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';

  DELETE FROM expenses
   WHERE voided_at IS NOT NULL AND voided_at < NOW() - INTERVAL '30 days';

  -- Parent rows — only hard-delete when there is nothing still riding on
  -- them. student_fees does not have a voided_at column, so any
  -- student_fee row is treated as a live dependent that protects the
  -- plan. A fee_plan with a non-voided fee_payment also stays put: that
  -- payment is the receipt the parent / auditor will want to reprint.
  DELETE FROM fee_plans fp
   WHERE fp.voided_at IS NOT NULL
     AND fp.voided_at < NOW() - INTERVAL '30 days'
     AND NOT EXISTS (
       SELECT 1 FROM student_fees sf WHERE sf.fee_plan_id = fp.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM fee_payments fpay
         JOIN student_fees sf2 ON sf2.id = fpay.student_fee_id
        WHERE sf2.fee_plan_id = fp.id
          AND fpay.voided_at IS NULL
     );

  -- Same shape for staff_members: keep the row if any salary slip is
  -- still alive, so the GL's salary entries always have an operational
  -- counterpart available for receipt regen / lookup.
  DELETE FROM staff_members sm
   WHERE sm.voided_at IS NOT NULL
     AND sm.voided_at < NOW() - INTERVAL '30 days'
     AND NOT EXISTS (
       SELECT 1 FROM staff_salary_payments ssp
        WHERE ssp.staff_id = sm.id
          AND ssp.voided_at IS NULL
     );
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Timezone-aware apply_late_fees
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apply_late_fees() RETURNS void AS $$
DECLARE
  r RECORD;
  v_ar  uuid;
  v_inc uuid;
BEGIN
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
        (NOW() AT TIME ZONE COALESCE(s.timezone, 'Asia/Baghdad'))::date
      FROM student_fees sf
      JOIN fee_plans        fp ON fp.id = sf.fee_plan_id
      JOIN fee_installments fi ON fi.fee_plan_id = sf.fee_plan_id
      JOIN schools          s  ON s.id = sf.school_id
      WHERE fp.late_fee_enabled
        AND fp.voided_at IS NULL
        AND (fi.due_date + (fp.late_fee_grace_days || ' days')::INTERVAL)::DATE
            < (NOW() AT TIME ZONE COALESCE(s.timezone, 'Asia/Baghdad'))::date
        AND NOT EXISTS (
          SELECT 1 FROM student_fee_late_fees x
          WHERE x.student_fee_id = sf.id AND x.fee_installment_id = fi.id
        )
      RETURNING id, school_id, student_fee_id, amount, applied_on
    )
    SELECT i.id, i.school_id, i.amount, i.applied_on, sf2.student_id, fp2.currency
    FROM ins i
    JOIN student_fees sf2 ON sf2.id = i.student_fee_id
    JOIN fee_plans    fp2 ON fp2.id = sf2.fee_plan_id
  LOOP
    IF r.amount IS NULL OR r.amount <= 0 THEN CONTINUE; END IF;
    SELECT id INTO v_ar  FROM chart_of_accounts WHERE school_id = r.school_id AND code = '1100' AND is_active;
    SELECT id INTO v_inc FROM chart_of_accounts WHERE school_id = r.school_id AND code = '4100' AND is_active;
    IF v_ar IS NOT NULL AND v_inc IS NOT NULL THEN
      PERFORM gl_post_entry(
        r.school_id, r.applied_on, COALESCE(r.currency, 'USD'), 'late_fee', r.id,
        'Late fee', NULL, false, NULL,
        jsonb_build_array(
          jsonb_build_object('account_id', v_ar,  'debit', r.amount, 'credit', 0, 'student_id', r.student_id),
          jsonb_build_object('account_id', v_inc, 'debit', 0, 'credit', r.amount, 'student_id', r.student_id)
        ));
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Backfill 5060 Bad Debt Expense on already-seeded charts
--    The seeder file (utils/glSeed.ts) gets the same entry so new
--    schools pick it up on first seed.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO chart_of_accounts (school_id, code, name, type, is_system, is_active)
SELECT s.id, '5060', 'Bad Debt Expense', 'expense', TRUE, TRUE
  FROM schools s
 WHERE EXISTS (
         SELECT 1 FROM chart_of_accounts c
          WHERE c.school_id = s.id
       )
   AND NOT EXISTS (
         SELECT 1 FROM chart_of_accounts c
          WHERE c.school_id = s.id AND c.code = '5060'
       );
