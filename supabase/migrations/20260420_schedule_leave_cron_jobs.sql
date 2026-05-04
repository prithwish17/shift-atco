-- ─────────────────────────────────────────────────────────────────────────────
-- Register recurring schedule-sync and leave-sync cron jobs.
--
-- Schedule Sync: every 2 hours, 10:00–20:00 IST  (= 04:30–14:30 UTC)
-- Leave Sync:    every 4 hours, 10:00–18:00 IST  (= 04:30–12:30 UTC)
--
-- Replaces the old single-run fetch-schedule job (30 13 * * *).
-- Uses pg_cron + pg_net. Timeout: 60 seconds.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Seed sync_jobs rows so they appear in admin UI
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, payload) VALUES
  -- Schedule sync: every 2h during 10:00–20:00 IST
  ('schedule-sync-10h',  'fetch-schedule',  '30 4  * * *', '{}'),
  ('schedule-sync-12h',  'fetch-schedule',  '30 6  * * *', '{}'),
  ('schedule-sync-14h',  'fetch-schedule',  '30 8  * * *', '{}'),
  ('schedule-sync-16h',  'fetch-schedule',  '30 10 * * *', '{}'),
  ('schedule-sync-18h',  'fetch-schedule',  '30 12 * * *', '{}'),
  ('schedule-sync-20h',  'fetch-schedule',  '30 14 * * *', '{}'),

  -- Leave sync: every 4h during 10:00–18:00 IST
  ('leave-sync-10h',     'fetch-leave-data', '30 4  * * *', '{}'),
  ('leave-sync-14h',     'fetch-leave-data', '30 8  * * *', '{}'),
  ('leave-sync-18h',     'fetch-leave-data', '30 12 * * *', '{}')
ON CONFLICT (job_name) DO NOTHING;

-- 2. Register pg_cron jobs via pg_net
DO $$
DECLARE
  base text := current_setting('app.settings.supabase_url', true)
                || '/functions/v1';
  skey text := current_setting('app.settings.service_role_key', true);

  jobs text[][] := ARRAY[
    -- Schedule sync: every 2h, 10:00–20:00 IST (UTC: 04:30–14:30)
    ARRAY['schedule-sync-10h',  '30 4  * * *',  'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-12h',  '30 6  * * *',  'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-14h',  '30 8  * * *',  'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-16h',  '30 10 * * *',  'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-18h',  '30 12 * * *',  'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-20h',  '30 14 * * *',  'fetch-schedule',   '{}'],

    -- Leave sync: every 4h, 10:00–18:00 IST (UTC: 04:30–12:30)
    ARRAY['leave-sync-10h',     '30 4  * * *',  'fetch-leave-data', '{}'],
    ARRAY['leave-sync-14h',     '30 8  * * *',  'fetch-leave-data', '{}'],
    ARRAY['leave-sync-18h',     '30 12 * * *',  'fetch-leave-data', '{}']
  ];

  j text[];
BEGIN
  IF base IS NULL OR base = '/functions/v1' THEN
    RAISE WARNING 'Skipping cron setup: app.settings.supabase_url not available';
    RETURN;
  END IF;
  IF skey IS NULL OR skey = '' THEN
    RAISE WARNING 'Skipping cron setup: app.settings.service_role_key not available';
    RETURN;
  END IF;

  -- Unschedule the old single-run fetch-schedule job
  BEGIN
    PERFORM cron.unschedule('fetch-schedule');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Unschedule any existing jobs with same names before re-registering
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      PERFORM cron.unschedule(j[1]);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- Register all jobs with 60s timeout
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    PERFORM cron.schedule(
      j[1], j[2],
      format(
        $q$SELECT net.http_post(
          url                  := %L,
          headers              := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey',        current_setting('app.settings.service_role_key'),
            'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
          ),
          body                 := %L::jsonb,
          timeout_milliseconds := 60000
        );$q$,
        base || '/' || j[3],
        j[4]
      )
    );
    RAISE NOTICE 'Registered cron job: %', j[1];
  END LOOP;
END $$;

-- Also deactivate the old fetch-schedule row in sync_jobs
UPDATE public.sync_jobs SET is_active = false WHERE job_name = 'fetch-schedule';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--   SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
--   SELECT job_name, cron_schedule, is_active FROM sync_jobs ORDER BY job_name;
-- ─────────────────────────────────────────────────────────────────────────────
