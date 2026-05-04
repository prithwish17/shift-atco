-- ─────────────────────────────────────────────────────────────────────────────
-- Fix schedule-sync and leave-sync cron job registration.
--
-- ROOT CAUSE: The previous migration (20260420_schedule_leave_cron_jobs.sql)
-- silently returned without registering jobs in pg_cron when
-- app.settings.supabase_url was NULL at migration time. The sync_jobs rows
-- were inserted but pg_cron never got the commands — so jobs appeared in the
-- admin UI but never actually ran.
--
-- SECOND ROOT CAUSE: Even if jobs were registered, the SQL command template
-- used current_setting('app.settings.service_role_key') at pg_cron RUNTIME
-- (inside a background worker where that setting does not exist), causing
-- every cron-triggered HTTP call to fail silently.
--
-- FIX: Use format(%L, skey, skey) to EMBED the key at schedule time, matching
-- the pattern used by the working notification migration (20260327).
--
-- ALSO: Stagger times to avoid three jobs firing at the same second:
--   schedule-sync: :32 past the hour
--   leave-sync:    :35 past the hour
--   (roster jobs remain unchanged at :30)
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  base text := current_setting('app.settings.supabase_url', true) || '/functions/v1';
  skey text := coalesce(
    current_setting('app.settings.service_role_key', true),
    current_setting('supabase.service_role_key', true)
  );

  -- [job_name, cron_utc, edge_function, payload]
  jobs text[][] := ARRAY[
    -- Schedule sync: every 2h, 10:00–20:00 IST (UTC: 04:32–14:32)
    -- Staggered to :32 to avoid collision with roster jobs at :30
    ARRAY['schedule-sync-10h', '32 4  * * *', 'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-12h', '32 6  * * *', 'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-14h', '32 8  * * *', 'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-16h', '32 10 * * *', 'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-18h', '32 12 * * *', 'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-20h', '32 14 * * *', 'fetch-schedule',   '{}'],

    -- Leave sync: every 4h, 10:00–18:00 IST (UTC: 04:35–12:35)
    -- Staggered to :35 to avoid collision with schedule-sync at :32
    ARRAY['leave-sync-10h',    '35 4  * * *', 'fetch-leave-data', '{}'],
    ARRAY['leave-sync-14h',    '35 8  * * *', 'fetch-leave-data', '{}'],
    ARRAY['leave-sync-18h',    '35 12 * * *', 'fetch-leave-data', '{}']
  ];

  j text[];
BEGIN
  IF base IS NULL OR base = '/functions/v1' THEN
    RAISE EXCEPTION 'Cannot register cron jobs: app.settings.supabase_url is not configured. '
      'This setting must be available before running this migration.';
  END IF;

  IF skey IS NULL OR skey = '' THEN
    RAISE EXCEPTION 'Cannot register cron jobs: service_role_key is not available. '
      'Ensure app.settings.service_role_key or supabase.service_role_key is set.';
  END IF;

  -- Unschedule existing versions (old :30 schedule AND any previous attempts)
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      PERFORM cron.unschedule(j[1]);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  -- Also remove the old single-run job if it still exists
  BEGIN PERFORM cron.unschedule('fetch-schedule'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('daily_fetch_schedule_1330'); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM cron.unschedule('daily_fetch_schedule_1830'); EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Register all jobs with embedded service_role_key (not runtime current_setting)
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    PERFORM cron.schedule(
      j[1], j[2],
      format(
        $q$SELECT net.http_post(
          url                  := %L,
          headers              := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey',        %L,
            'Authorization', 'Bearer ' || %L
          ),
          body                 := %L::jsonb,
          timeout_milliseconds := 60000
        );$q$,
        base || '/' || j[3],
        skey, skey,
        j[4]
      )
    );

    -- Sync the updated schedule back to sync_jobs so admin UI stays accurate
    UPDATE public.sync_jobs
    SET cron_schedule = j[2],
        is_active     = true,
        updated_at    = now()
    WHERE job_name = j[1];

    RAISE NOTICE 'Registered cron job: % → %', j[1], j[2];
  END LOOP;

  RAISE NOTICE 'Successfully registered % cron jobs with embedded service_role_key.', array_length(jobs, 1);
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--
-- Check jobs exist in pg_cron:
--   SELECT jobname, schedule, active
--   FROM cron.job
--   WHERE jobname LIKE 'schedule-sync%' OR jobname LIKE 'leave-sync%'
--   ORDER BY jobname;
--
-- Check command does NOT contain current_setting (embedded key instead):
--   SELECT jobname, command
--   FROM cron.job
--   WHERE jobname = 'schedule-sync-10h';
--
-- After next cron cycle, verify entries appear:
--   SELECT job_name, triggered_by, status, created_at
--   FROM api_call_logs
--   WHERE endpoint = 'fetch-schedule'
--   ORDER BY created_at DESC LIMIT 5;
-- ─────────────────────────────────────────────────────────────────────────────
