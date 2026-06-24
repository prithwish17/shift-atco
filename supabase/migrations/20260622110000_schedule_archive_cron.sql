-- ─────────────────────────────────────────────────────────────────────────────
-- Monthly schedule archive — runs the archive-schedules edge function on the 1st
-- ─────────────────────────────────────────────────────────────────────────────
-- Keeps employee_schedules to the last 2 months in Postgres; everything older is
-- shipped to the audit-log Google Sheet (app_settings.supervisor_audit_log_webapp_url)
-- and then deleted. Retrieval is via GET /api/schedule-archive.
--
-- Uses the existing queue pattern: cron inserts a row into cron_job_queue, which
-- process-cron-queue drains and invokes the edge function (no service key in SQL).
--
-- 02:00 UTC on day 1 = 07:30 IST on the 1st of each month.
-- Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- Seed sync_jobs so the admin UI shows this job + last-run status.
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES ('archive-schedules-monthly', 'archive-schedules', '0 2 1 * *', true, '{}')
ON CONFLICT (job_name) DO UPDATE SET
  edge_function_name = EXCLUDED.edge_function_name,
  cron_schedule      = EXCLUDED.cron_schedule,
  is_active          = true,
  payload            = EXCLUDED.payload,
  updated_at         = now();

-- Register the pg_cron job as a queue insert.
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
         jsonb_build_object('__cron_job_name', 'archive-schedules-monthly', 'monthsToKeep', 2),
         'cron_job'
       );$q$
  );
END $$;

-- Verify:
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'archive-schedules-monthly';
--   SELECT job_name, cron_schedule, is_active FROM sync_jobs WHERE job_name = 'archive-schedules-monthly';
--
-- Run once now (drains via the queue on the next process-cron-queue tick):
--   INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by, priority)
--   VALUES ('archive-schedules-monthly', 'archive-schedules',
--           jsonb_build_object('__cron_job_name','archive-schedules-monthly','monthsToKeep',2), 'manual', 10);
