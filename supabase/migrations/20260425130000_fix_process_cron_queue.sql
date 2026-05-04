-- ─────────────────────────────────────────────────────────────────────────────
-- Fix process-cron-queue: recover stuck jobs + add auth headers.
--
-- Root cause: The process-cron-queue edge function called
-- claim_next_queue_job() via Supabase JS `.rpc()` without `.maybeSingle()`.
-- PostgREST wraps composite-type returns in an array, so `data` was always
-- `[{…}]` or `[]` (both truthy). The code treated the array as a QueueJob
-- object, making all properties `undefined` — jobs were claimed (set to
-- "running") but never actually processed.
--
-- This migration:
--   1. Resets stuck "running" entries back to "pending" for retry.
--   2. Re-registers process-cron-queue with Authorization headers so the
--      Supabase API gateway reliably accepts the call.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Reset stuck "running" jobs back to "pending" so they get retried
--    by the now-fixed process-cron-queue edge function.
UPDATE public.cron_job_queue
SET    status     = 'pending',
       started_at = NULL
WHERE  status = 'running';

-- 2. Re-register process-cron-queue with auth headers.
--    The URL is hardcoded at registration time (format %L), but the
--    Authorization key uses current_setting() INSIDE the cron command so
--    it is evaluated at EXECUTION time (every minute), not registration time.
DO $$
DECLARE
  base text := coalesce(
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'https://ilkrqlxrqaelflslbdnx.supabase.co'
  ) || '/functions/v1';
BEGIN
  BEGIN
    PERFORM cron.unschedule('process-cron-queue');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'process-cron-queue',
    '* * * * *',
    format(
      $q$SELECT net.http_post(
        url                  := %L,
        headers              := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(
            current_setting('supabase.service_role_key', true),
            current_setting('app.settings.service_role_key', true),
            ''
          )
        ),
        body                 := '{}'::jsonb,
        timeout_milliseconds := 90000
      );$q$,
      base || '/process-cron-queue'
    )
  );

  RAISE NOTICE 'Re-registered process-cron-queue with Authorization header';
END $$;

-- 3. Ensure sync_jobs entry is up to date.
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES ('process-cron-queue', 'process-cron-queue', '* * * * *', true, '{}')
ON CONFLICT (job_name) DO UPDATE SET
  edge_function_name = EXCLUDED.edge_function_name,
  cron_schedule      = EXCLUDED.cron_schedule,
  is_active          = true,
  payload            = EXCLUDED.payload,
  updated_at         = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- After running this migration:
--   1. Deploy the fixed edge function:
--        supabase functions deploy process-cron-queue
--   2. Verify the cron job is registered:
--        SELECT jobname, schedule, command FROM cron.job
--        WHERE jobname = 'process-cron-queue';
--   3. Check stuck jobs were reset:
--        SELECT status, count(*) FROM cron_job_queue GROUP BY status;
-- ─────────────────────────────────────────────────────────────────────────────
