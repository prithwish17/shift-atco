-- ─────────────────────────────────────────────────────────────────────────────
-- Register cron jobs for the notification/email delivery system.
--
-- Uses format() to embed the service_role_key into the command at
-- schedule time, avoiding the runtime error:
--   "unrecognized configuration parameter app.settings.service_role_key"
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  base text := 'https://ilkrqlxrqaelflslbdnx.supabase.co/functions/v1';
  skey text := coalesce(
    current_setting('app.settings.service_role_key', true),
    current_setting('supabase.service_role_key', true)
  );

  jobs text[][] := ARRAY[
    -- name,                        cron (UTC),      function,                       payload
    ARRAY['process-notification-queue', '*/2 * * * *',  'process-notification-queue', '{}'],
    ARRAY['check-duty-changes',         '0 3 * * *',    'check-duty-changes',         '{}'],
    ARRAY['check-ope-reminders',        '5 18 * * *',   'check-ope-reminders',        '{}'],
    ARRAY['check-compoff-expiry',       '15 18 * * *',  'check-compoff-expiry',       '{}'],
    ARRAY['check-license-expiry',       '30 18 * * *',  'check-license-expiry',       '{}']
  ];

  j text[];
BEGIN
  IF skey IS NULL OR skey = '' THEN
    RAISE WARNING 'Skipping cron setup: service_role_key not available';
    RETURN;
  END IF;

  -- Unschedule if they already exist
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      PERFORM cron.unschedule(j[1]);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;

  -- Register with key embedded at schedule time (not resolved at runtime)
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
    RAISE NOTICE 'Registered cron job: %', j[1];
  END LOOP;
END $$;
