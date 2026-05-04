-- ─────────────────────────────────────────────────────────────────────────────
-- Register process-cron-queue without depending on app.settings.* GUCs.
--
-- Supabase SQL Editor/manual migration runs may not expose
-- app.settings.supabase_url or app.settings.service_role_key. The
-- process-cron-queue function is configured with verify_jwt=false, so this cron
-- entry can call it without embedding a service-role key.
-- ─────────────────────────────────────────────────────────────────────────────

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
        headers              := jsonb_build_object('Content-Type', 'application/json'),
        body                 := '{}'::jsonb,
        timeout_milliseconds := 90000
      );$q$,
      base || '/process-cron-queue'
    )
  );
END $$;

INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES ('process-cron-queue', 'process-cron-queue', '* * * * *', true, '{}')
ON CONFLICT (job_name) DO UPDATE SET
  edge_function_name = EXCLUDED.edge_function_name,
  cron_schedule      = EXCLUDED.cron_schedule,
  is_active          = true,
  payload            = EXCLUDED.payload,
  updated_at         = now();
