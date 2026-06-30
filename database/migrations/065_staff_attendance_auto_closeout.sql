-- ============================================================
-- Migration 065 — Staff attendance auto-closeout (Phase 6).
--   Employees who forget to check out leave a row stuck at status='open'
--   forever. This nightly-ish sweep closes any open punch once its work-day
--   has ended in the SCHOOL'S OWN timezone, marking it auto_closed + flagged
--   so it surfaces in the admin Review queue (the P4 mgmt page) for a manual
--   checkout-time correction.
--
--   Cadence: HOURLY via pg_cron (not a fixed UTC time) because "end of day"
--   is per-school — each school's tz + staff_attendance_config.schedule.endTime
--   differ, so the job wakes every hour and closes whichever schools have just
--   passed their local end-of-day. (The Node setInterval schedulers are
--   explicitly "daily-ish, not wall-clock-aligned" — wrong for end-of-day —
--   so pg_cron is the right mechanism here, matching apply_late_fees etc.)
--
--   check_out_at is intentionally left NULL: no real checkout happened, so the
--   board/Review show "—" and the admin fills the true time via a correction.
-- Safe to run multiple times (CREATE OR REPLACE + re-scheduled idempotently).
-- ============================================================

CREATE OR REPLACE FUNCTION staff_attendance_auto_closeout() RETURNS void AS $$
BEGIN
  UPDATE staff_attendance sa
     SET status = 'auto_closed',
         flagged = TRUE,
         flag_reason = 'auto_closed'
    FROM schools s
   WHERE sa.status = 'open'
     AND s.id = sa.school_id
     -- Past this work_date's end-of-day in the school's OWN timezone. endTime
     -- comes from the school's config (default 15:00 if unset/blank). A row
     -- from a previous work_date trivially satisfies this (its day is long
     -- over), so stale multi-day-open punches get swept too.
     AND (NOW() AT TIME ZONE COALESCE(NULLIF(s.timezone, ''), 'Asia/Baghdad'))
         >= (sa.work_date
             + COALESCE(NULLIF(s.staff_attendance_config->'schedule'->>'endTime', ''), '15:00')::time)
     -- Never auto-close a punch in its first hour — guards the rare check-in
     -- that lands just after the configured end-of-day.
     AND sa.check_in_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- Schedule hourly (minute 0). Harmless if pg_cron is already installed for the
-- apply_late_fees / cleanup_voided_records / notify_expiring jobs.
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Drop any prior registration so re-running this migration reschedules cleanly.
SELECT cron.unschedule('staff_attendance_auto_closeout')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'staff_attendance_auto_closeout');
SELECT cron.schedule(
  'staff_attendance_auto_closeout',
  '0 * * * *',
  $$SELECT staff_attendance_auto_closeout();$$
);
