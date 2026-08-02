-- ─────────────────────────────────────────────────────────────────────────────
-- Schedule archive retention: 2 months → 6 months
-- ─────────────────────────────────────────────────────────────────────────────
-- Employees need 6 months of duty history queryable directly, so employee_schedules
-- now keeps the current month + 5 prior months in Postgres instead of 2. Older data
-- still ships to the audit-log Google Sheet and is read back via /api/schedule-archive.
--
-- This MUST stay in sync with MONTHS_KEPT_IN_DB in src/hooks/useEmployeeSchedules.ts.
-- If the frontend constant is larger than the archiver's retention, the intervening
-- months are queried from the database, found empty, and never fall back to the
-- archive — so they render blank rather than falling back gracefully.
--
-- Re-running 20260622110000_schedule_archive_cron.sql after this would reset the
-- payload to 2; that file is superseded by this one.
--
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  BEGIN PERFORM cron.unschedule('archive-schedules-monthly'); EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM cron.schedule(
    'archive-schedules-monthly',
    '0 2 1 * *',
    $q$INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by)
       VALUES (
         'archive-schedules-monthly',
         'archive-schedules',
         jsonb_build_object('__cron_job_name', 'archive-schedules-monthly', 'monthsToKeep', 6),
         'cron_job'
       );$q$
  );
END $$;

-- Verify:
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'archive-schedules-monthly';
--   -- the command should contain 'monthsToKeep', 6
