-- Schedule daily fetch-schedule invocation at 18:30 UTC.
-- Note: pg_cron on Supabase runs in UTC unless project cron timezone is configured otherwise.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Ensure idempotency: remove any prior job with the same name
DO $$
DECLARE
  job_id bigint;
BEGIN
  SELECT jobid INTO job_id
  FROM cron.job
  WHERE jobname = 'daily_fetch_schedule_1830';

  IF job_id IS NOT NULL THEN
    PERFORM cron.unschedule(job_id);
  END IF;
END $$;

SELECT cron.schedule(
  'daily_fetch_schedule_1830',
  '30 18 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ilkrqlxrqaelflslbdnx.supabase.co/functions/v1/fetch-schedule',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', current_setting('app.settings.service_role_key'),
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
