-- ─────────────────────────────────────────────────────────────────────────────
-- Register notification cron jobs via pg_cron + pg_net.
-- Run after deploying the check-ope-reminders, check-compoff-expiry,
-- and check-license-expiry Edge Functions.
--
-- Timing (UTC → IST):
--   check-ope-reminders    at 18:05 UTC = 23:35 IST (daily)
--   check-compoff-expiry   at 18:15 UTC = 23:45 IST (daily)
--   check-license-expiry   at 18:30 UTC = 00:00 IST (daily)
-- All run after expire-records (18:00 UTC) finishes.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  base text := 'https://ilkrqlxrqaelflslbdnx.supabase.co/functions/v1';
  skey text := coalesce(
    current_setting('app.settings.service_role_key', true),
    current_setting('supabase.service_role_key', true)
  );

  jobs text[][] := ARRAY[
    ARRAY['check-ope-reminders',    '5 18 * * *',   'check-ope-reminders',    '{}'],
    ARRAY['check-compoff-expiry',   '15 18 * * *',  'check-compoff-expiry',   '{}'],
    ARRAY['check-license-expiry',   '30 18 * * *',  'check-license-expiry',   '{}']
  ];

  j text[];
BEGIN
  IF skey IS NULL OR skey = '' THEN
    RAISE WARNING 'Skipping cron setup: service_role_key not available';
    RETURN;
  END IF;

  -- Unschedule existing jobs before re-registering
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      PERFORM cron.unschedule(j[1]);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

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
    RAISE NOTICE 'Registered notification cron job: %', j[1];
  END LOOP;
END $$;
