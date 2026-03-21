-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase Scheduled Sync: Schema additions
-- Part 1.2 — Extend api_call_logs
-- Part 1.3 — Create sync_jobs table
-- Part 1.4 — Seed sync_jobs
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.2  Add job_name and records_affected to api_call_logs
ALTER TABLE public.api_call_logs
  ADD COLUMN IF NOT EXISTS job_name         text,
  ADD COLUMN IF NOT EXISTS records_affected integer;

-- 1.3  sync_jobs — registry of every scheduled Edge Function call
CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  job_name            text        NOT NULL UNIQUE,
  edge_function_name  text        NOT NULL,
  cron_schedule       text        NOT NULL,
  is_active           boolean     NOT NULL DEFAULT true,
  last_run_at         timestamptz,
  last_run_status     text,                          -- 'success' | 'error'
  payload             jsonb       DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_jobs_pkey PRIMARY KEY (id)
);

-- RLS: authenticated users can read; service role can write
ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read sync_jobs" ON public.sync_jobs;
CREATE POLICY "Authenticated read sync_jobs" ON public.sync_jobs
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Service role write sync_jobs" ON public.sync_jobs;
CREATE POLICY "Service role write sync_jobs" ON public.sync_jobs
  FOR ALL USING (auth.role() = 'service_role');

-- 1.4  Seed sync_jobs — one row per logical job
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, payload) VALUES
  ('sync-leave-records',   'sync-leave-records',  '0 */2 * * *',  '{"source":"google_sheets"}'),
  ('expire-records',       'expire-records',       '0 18   * * *', '{}'),

  -- Morning roster (IST → UTC): shifts fetched 18:00–23:00 IST are for TOMORROW
  ('roster-morning-18h', 'sync-roster', '30 12 * * *', '{"shift":"Morning"}'),
  ('roster-morning-20h', 'sync-roster', '30 14 * * *', '{"shift":"Morning"}'),
  ('roster-morning-21h', 'sync-roster', '30 15 * * *', '{"shift":"Morning"}'),
  ('roster-morning-22h', 'sync-roster', '30 16 * * *', '{"shift":"Morning"}'),
  ('roster-morning-23h', 'sync-roster', '30 17 * * *', '{"shift":"Morning"}'),
  ('roster-morning-00h', 'sync-roster', '30 18 * * *', '{"shift":"Morning"}'),
  ('roster-morning-01h', 'sync-roster', '30 19 * * *', '{"shift":"Morning"}'),
  ('roster-morning-06h', 'sync-roster', '30 00 * * *', '{"shift":"Morning"}'),

  -- Afternoon roster: IST 08–12 → UTC 02:30–06:30
  ('roster-afternoon-08h', 'sync-roster', '30 02 * * *', '{"shift":"Afternoon"}'),
  ('roster-afternoon-09h', 'sync-roster', '30 03 * * *', '{"shift":"Afternoon"}'),
  ('roster-afternoon-10h', 'sync-roster', '30 04 * * *', '{"shift":"Afternoon"}'),
  ('roster-afternoon-11h', 'sync-roster', '30 05 * * *', '{"shift":"Afternoon"}'),
  ('roster-afternoon-12h', 'sync-roster', '30 06 * * *', '{"shift":"Afternoon"}'),

  -- Night roster: IST 13–18 → UTC 07:30–12:30
  ('roster-night-13h', 'sync-roster', '30 07 * * *', '{"shift":"Night"}'),
  ('roster-night-14h', 'sync-roster', '30 08 * * *', '{"shift":"Night"}'),
  ('roster-night-15h', 'sync-roster', '30 09 * * *', '{"shift":"Night"}'),
  ('roster-night-16h', 'sync-roster', '30 10 * * *', '{"shift":"Night"}'),
  ('roster-night-17h', 'sync-roster', '30 11 * * *', '{"shift":"Night"}'),
  ('roster-night-18h', 'sync-roster', '30 12 * * *', '{"shift":"Night"}')
ON CONFLICT (job_name) DO NOTHING;
