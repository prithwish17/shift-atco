-- ─────────────────────────────────────────────────────────────────────────────
-- Register all 23 scheduled sync cron jobs via pg_cron + pg_net.
-- Run ONCE in Dashboard → SQL Editor after deploying the Edge Functions.
--
-- REQUIRED: Replace <YOUR-ANON-KEY> below with your project's anon/public key.
--           Find it in: Dashboard → Settings → API → Project API keys → anon key
--           The base URL uses the existing project reference (ilkrqlxrqaelflslbdnx).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  base text := 'https://ilkrqlxrqaelflslbdnx.supabase.co/functions/v1';
  akey text := '<YOUR-ANON-KEY>';   -- ← replace before running

  jobs text[][] := ARRAY[
    -- name, cron (UTC), function, payload
    ARRAY['sync-leave-records',    '0 */2 * * *',  'sync-leave-records',  '{"source":"google_sheets"}'],
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
    ARRAY['roster-night-18h',      '30 12 * * *',   'sync-roster',  '{"shift":"Night"}']
  ];

  j text[];
BEGIN
  -- Unschedule existing jobs with the same names before re-registering
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      PERFORM cron.unschedule(j[1]);
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- job may not exist yet, ignore
    END;
  END LOOP;

  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    PERFORM cron.schedule(
      j[1], j[2],
      format(
        $q$SELECT net.http_post(
          url     := %L,
          headers := ('{"Authorization":"Bearer %s","Content-Type":"application/json"}')::jsonb,
          body    := '%s'::jsonb
        );$q$,
        base || '/' || j[3],
        akey,
        j[4]
      )
    );
    RAISE NOTICE 'Registered cron job: %', j[1];
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification queries (run separately after the block above):
--
-- SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- SELECT job_name, status, message, records_affected, duration_ms, created_at
--   FROM api_call_logs ORDER BY created_at DESC LIMIT 30;
-- SELECT job_name, last_run_at, last_run_status, cron_schedule
--   FROM sync_jobs ORDER BY job_name;
-- ─────────────────────────────────────────────────────────────────────────────
