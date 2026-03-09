-- Fix schedule cron job to target the current Supabase project URL
-- instead of a hardcoded project domain.
-- This migration is defensive across different pg_cron schema placements.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
DECLARE
  project_url text := current_setting('app.settings.supabase_url', true);
  service_role_key text := current_setting('app.settings.service_role_key', true);
  cron_schema text;
  job_id bigint;
  command_sql text;
BEGIN
  IF project_url IS NULL OR project_url = '' THEN
    RAISE WARNING 'Skipping schedule cron setup: app.settings.supabase_url is not available.';
    RETURN;
  END IF;

  IF service_role_key IS NULL OR service_role_key = '' THEN
    RAISE WARNING 'Skipping schedule cron setup: app.settings.service_role_key is not available.';
    RETURN;
  END IF;

  IF to_regclass('cron.job') IS NOT NULL THEN
    cron_schema := 'cron';
  ELSIF to_regclass('extensions.job') IS NOT NULL THEN
    cron_schema := 'extensions';
  ELSE
    RAISE EXCEPTION 'pg_cron job table not found (expected cron.job or extensions.job)';
  END IF;

  EXECUTE format(
    'SELECT jobid FROM %I.job WHERE jobname = $1',
    cron_schema
  )
  INTO job_id
  USING 'daily_fetch_schedule_1830';

  IF job_id IS NOT NULL THEN
    EXECUTE format('SELECT %I.unschedule($1)', cron_schema) USING job_id;
  END IF;

  command_sql := format(
    $cmd$
    SELECT net.http_post(
      url := %L,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', current_setting('app.settings.service_role_key'),
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      ),
      body := '{}'::jsonb
    );
    $cmd$,
    project_url || '/functions/v1/fetch-schedule'
  );

  EXECUTE format(
    'SELECT %I.schedule($1, $2, $3)',
    cron_schema
  )
  USING 'daily_fetch_schedule_1830', '30 18 * * *', command_sql;
END $$;
