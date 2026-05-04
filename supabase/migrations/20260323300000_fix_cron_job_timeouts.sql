-- ─────────────────────────────────────────────────────────────────────────────
-- Fix cron job timeouts for all scheduled sync jobs.
--
-- Problem: The previous registration used net.http_post without specifying
-- timeout_milliseconds. The pg_net default is 2000ms (2 seconds), which is
-- far too short for edge functions that call Google Apps Script (5-30s)
-- plus perform DB operations.
--
-- Solution: Re-register all cron jobs with timeout_milliseconds := 60000
-- (60 seconds) to give edge functions enough time to complete.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  base text := current_setting('app.settings.supabase_url', true)
                || '/functions/v1';
  skey text := current_setting('app.settings.service_role_key', true);

  jobs text[][] := ARRAY[
    -- name, cron (UTC), function, payload
    ARRAY['fetch-schedule',        '30 13 * * *',   'fetch-schedule',      '{}'],
    ARRAY['sync-leave-records',    '0 */2 * * *',   'sync-leave-records',  '{"source":"google_sheets"}'],
    ARRAY['expire-records',        '0 18   * * *',  'expire-records',      '{}'],

    -- Morning roster (30-min past the hour, UTC equivalents of IST times)
    ARRAY['roster-morning-18h',    '30 12 * * *',   'sync-roster',  '{"shift":"Morning"}'],
    ARRAY['roster-morning-20h',    '30 14 * * *',   'sync-roster',  '{"shift":"Morning"}'],
    ARRAY['roster-morning-21h',    '30 15 * * *',   'sync-roster',  '{"shift":"Morning"}'],
    ARRAY['roster-morning-22h',    '30 16 * * *',   'sync-roster',  '{"shift":"Morning"}'],
    ARRAY['roster-morning-23h',    '30 17 * * *',   'sync-roster',  '{"shift":"Morning"}'],
    ARRAY['roster-morning-00h',    '30 18 * * *',   'sync-roster',  '{"shift":"Morning"}'],
    ARRAY['roster-morning-01h',    '30 19 * * *',   'sync-roster',  '{"shift":"Morning"}'],
    ARRAY['roster-morning-06h',    '30 00 * * *',   'sync-roster',  '{"shift":"Morning"}'],

    -- Afternoon roster
    ARRAY['roster-afternoon-08h',  '30 02 * * *',   'sync-roster',  '{"shift":"Afternoon"}'],
    ARRAY['roster-afternoon-09h',  '30 03 * * *',   'sync-roster',  '{"shift":"Afternoon"}'],
    ARRAY['roster-afternoon-10h',  '30 04 * * *',   'sync-roster',  '{"shift":"Afternoon"}'],
    ARRAY['roster-afternoon-11h',  '30 05 * * *',   'sync-roster',  '{"shift":"Afternoon"}'],
    ARRAY['roster-afternoon-12h',  '30 06 * * *',   'sync-roster',  '{"shift":"Afternoon"}'],

    -- Night roster
    ARRAY['roster-night-13h',      '30 07 * * *',   'sync-roster',  '{"shift":"Night"}'],
    ARRAY['roster-night-14h',      '30 08 * * *',   'sync-roster',  '{"shift":"Night"}'],
    ARRAY['roster-night-15h',      '30 09 * * *',   'sync-roster',  '{"shift":"Night"}'],
    ARRAY['roster-night-16h',      '30 10 * * *',   'sync-roster',  '{"shift":"Night"}'],
    ARRAY['roster-night-17h',      '30 11 * * *',   'sync-roster',  '{"shift":"Night"}'],
    ARRAY['roster-night-19h',      '30 13 * * *',   'sync-roster',  '{"shift":"Night"}'],
    ARRAY['roster-night-20h',      '30 14 * * *',   'sync-roster',  '{"shift":"Night"}'],
    ARRAY['roster-night-21h',      '30 15 * * *',   'sync-roster',  '{"shift":"Night"}'],
    ARRAY['roster-night-22h',      '30 16 * * *',   'sync-roster',  '{"shift":"Night"}'],
    ARRAY['roster-night-23h',      '30 17 * * *',   'sync-roster',  '{"shift":"Night"}']
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

  -- Unschedule existing jobs before re-registering with correct timeout
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      PERFORM cron.unschedule(j[1]);
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- job may not exist yet, ignore
    END;
  END LOOP;

  -- Also clean up the legacy job from the old migration (20260309)
  BEGIN
    PERFORM cron.unschedule('daily_fetch_schedule_1330');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Re-register all jobs WITH timeout_milliseconds := 60000 (60 seconds)
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
    RAISE NOTICE 'Re-registered cron job with 60s timeout: %', j[1];
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify after running:
--   SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- ─────────────────────────────────────────────────────────────────────────────
