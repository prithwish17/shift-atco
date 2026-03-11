-- 1. Create api_call_logs table for persistent API call tracking
CREATE TABLE IF NOT EXISTS public.api_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'POST',
  status TEXT NOT NULL,               -- 'success' | 'error'
  message TEXT,
  duration_ms INTEGER,
  triggered_by TEXT DEFAULT 'unknown', -- 'cron_job' | user email | 'manual'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for quick admin dashboard queries (most recent first)
CREATE INDEX IF NOT EXISTS idx_api_call_logs_created_at
  ON public.api_call_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_call_logs_endpoint
  ON public.api_call_logs(endpoint);

-- RLS: admins can read, service role can write
ALTER TABLE public.api_call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read api_call_logs" ON public.api_call_logs
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role write api_call_logs" ON public.api_call_logs
  FOR INSERT WITH CHECK (true);

-- 2. Fix cron schedule: 19:00 IST = 13:30 UTC
-- Remove old job
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

-- Schedule at 13:30 UTC = 19:00 IST
SELECT cron.schedule(
  'daily_fetch_schedule_1330',
  '30 13 * * *',
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
