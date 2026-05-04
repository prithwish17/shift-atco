-- ─────────────────────────────────────────────────────────────────────────────
-- Working Hours Cache
--
-- Pre-computed working hours data refreshed 6x daily via cron.
-- Frontend reads from this table for instant page loads (~5ms vs ~2s live).
--
-- Components:
--   1. working_hours_cache table
--   2. refresh_working_hours_cache() function
--   3. 6 queue-based cron jobs (10 AM – 8 PM IST, every 2 hours)
--   4. manage_cron_job() update to include refresh-working-hours in queue list
--   5. sync_jobs seed for admin UI
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Cache table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.working_hours_cache (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  month             text        NOT NULL,             -- e.g. '2026-04'
  employee_code     text        NOT NULL,
  employee_name     text,
  current_shift     text,
  total_hours       integer     DEFAULT 0,
  days_worked       integer     DEFAULT 0,
  avg_per_day       numeric(4,1) DEFAULT 0,
  peak_7d_hours     integer     DEFAULT 0,
  peak_15d_hours    integer     DEFAULT 0,
  peak_30d_hours    integer     DEFAULT 0,
  peak_7d_breached  boolean     DEFAULT false,
  peak_15d_breached boolean     DEFAULT false,
  peak_30d_breached boolean     DEFAULT false,
  daily_schedule    jsonb       DEFAULT '[]'::jsonb,
  computed_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT whc_month_employee UNIQUE (month, employee_code)
);

-- Fast lookup by month (primary read pattern)
CREATE INDEX IF NOT EXISTS idx_whc_month
  ON public.working_hours_cache (month);

-- Admin/debug: most recent computations
CREATE INDEX IF NOT EXISTS idx_whc_computed
  ON public.working_hours_cache (computed_at DESC);

-- ── 2. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.working_hours_cache ENABLE ROW LEVEL SECURITY;

-- Supervisors and admins can read cached data
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'working_hours_cache'
      AND policyname = 'Authenticated read working_hours_cache'
  ) THEN
    CREATE POLICY "Authenticated read working_hours_cache"
      ON public.working_hours_cache FOR SELECT
      USING (auth.role() = 'authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'working_hours_cache'
      AND policyname = 'Service role full access working_hours_cache'
  ) THEN
    CREATE POLICY "Service role full access working_hours_cache"
      ON public.working_hours_cache FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- ── 3. refresh_working_hours_cache() ──────────────────────────────────────────
--
-- Calls the existing get_working_hours_summary(p_month) and upserts results
-- into working_hours_cache. Returns a summary JSON.

CREATE OR REPLACE FUNCTION public.refresh_working_hours_cache(p_month TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_now   timestamptz := now();
  rec     record;
BEGIN
  -- Call the existing RPC and upsert each row
  FOR rec IN
    SELECT * FROM public.get_working_hours_summary(p_month)
  LOOP
    INSERT INTO public.working_hours_cache (
      month, employee_code, employee_name, current_shift,
      total_hours, days_worked, avg_per_day,
      peak_7d_hours, peak_15d_hours, peak_30d_hours,
      peak_7d_breached, peak_15d_breached, peak_30d_breached,
      daily_schedule, computed_at
    ) VALUES (
      p_month, rec.employee_code, rec.employee_name, rec.current_shift,
      rec.total_hours, rec.days_worked, rec.avg_per_day,
      rec.peak_7d_hours, rec.peak_15d_hours, rec.peak_30d_hours,
      rec.peak_7d_breached, rec.peak_15d_breached, rec.peak_30d_breached,
      rec.daily_schedule, v_now
    )
    ON CONFLICT (month, employee_code) DO UPDATE SET
      employee_name     = EXCLUDED.employee_name,
      current_shift     = EXCLUDED.current_shift,
      total_hours       = EXCLUDED.total_hours,
      days_worked       = EXCLUDED.days_worked,
      avg_per_day       = EXCLUDED.avg_per_day,
      peak_7d_hours     = EXCLUDED.peak_7d_hours,
      peak_15d_hours    = EXCLUDED.peak_15d_hours,
      peak_30d_hours    = EXCLUDED.peak_30d_hours,
      peak_7d_breached  = EXCLUDED.peak_7d_breached,
      peak_15d_breached = EXCLUDED.peak_15d_breached,
      peak_30d_breached = EXCLUDED.peak_30d_breached,
      daily_schedule    = EXCLUDED.daily_schedule,
      computed_at       = EXCLUDED.computed_at;

    v_count := v_count + 1;
  END LOOP;

  -- Remove cache entries for employees no longer in the RPC result
  -- (e.g. employee was hidden since last refresh)
  DELETE FROM public.working_hours_cache
  WHERE month = p_month
    AND employee_code NOT IN (
      SELECT whs.employee_code
      FROM public.get_working_hours_summary(p_month) whs
    );

  RETURN jsonb_build_object(
    'month',          p_month,
    'rows_refreshed', v_count,
    'computed_at',    v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_working_hours_cache(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_working_hours_cache(TEXT) TO service_role;

-- ── 4. Register 6 cron jobs (queue-based) ─────────────────────────────────────
--
-- IST → UTC conversion (IST = UTC + 5:30):
--   10:00 IST = 04:30 UTC
--   12:00 IST = 06:30 UTC
--   14:00 IST = 08:30 UTC
--   16:00 IST = 10:30 UTC
--   18:00 IST = 12:30 UTC
--   20:00 IST = 14:30 UTC

-- Seed into sync_jobs first
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES
  ('working-hours-cache-10h', 'refresh-working-hours', '30 4  * * *', true, '{}'),
  ('working-hours-cache-12h', 'refresh-working-hours', '30 6  * * *', true, '{}'),
  ('working-hours-cache-14h', 'refresh-working-hours', '30 8  * * *', true, '{}'),
  ('working-hours-cache-16h', 'refresh-working-hours', '30 10 * * *', true, '{}'),
  ('working-hours-cache-18h', 'refresh-working-hours', '30 12 * * *', true, '{}'),
  ('working-hours-cache-20h', 'refresh-working-hours', '30 14 * * *', true, '{}')
ON CONFLICT (job_name) DO UPDATE SET
  edge_function_name = EXCLUDED.edge_function_name,
  cron_schedule      = EXCLUDED.cron_schedule,
  is_active          = true,
  payload            = EXCLUDED.payload,
  updated_at         = now();

-- Register pg_cron jobs as queue inserts
DO $$
DECLARE
  jobs text[][] := ARRAY[
    ARRAY['working-hours-cache-10h', '30 4  * * *', 'refresh-working-hours', '{}'],
    ARRAY['working-hours-cache-12h', '30 6  * * *', 'refresh-working-hours', '{}'],
    ARRAY['working-hours-cache-14h', '30 8  * * *', 'refresh-working-hours', '{}'],
    ARRAY['working-hours-cache-16h', '30 10 * * *', 'refresh-working-hours', '{}'],
    ARRAY['working-hours-cache-18h', '30 12 * * *', 'refresh-working-hours', '{}'],
    ARRAY['working-hours-cache-20h', '30 14 * * *', 'refresh-working-hours', '{}']
  ];
  j text[];
BEGIN
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    -- Unschedule if exists (idempotent)
    BEGIN
      PERFORM cron.unschedule(j[1]);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- Register as queue insert (no service_role_key needed)
    PERFORM cron.schedule(
      j[1],
      j[2],
      format(
        $q$INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by)
        VALUES (%L, %L, (%L::jsonb || jsonb_build_object('__cron_job_name', %L)), 'cron_job');$q$,
        j[1], j[3], j[4], j[1]
      )
    );

    RAISE NOTICE 'Registered % as queue-based cron job', j[1];
  END LOOP;
END $$;

-- ── 5. Update manage_cron_job() — add refresh-working-hours to queue list ─────
--
-- The existing function has a v_use_queue check that determines whether a job
-- should use the queue pattern or direct HTTP. We need to add our new function.

CREATE OR REPLACE FUNCTION public.manage_cron_job(
  p_action          text,
  p_job_name        text,
  p_cron_schedule   text    DEFAULT NULL,
  p_edge_function   text    DEFAULT NULL,
  p_payload         jsonb   DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net
AS $$
DECLARE
  v_base      text;
  v_skey      text;
  v_url       text;
  v_edge_fn   text;
  v_use_queue boolean;
  v_queue_id  uuid;
BEGIN
  IF p_action NOT IN ('schedule', 'unschedule', 'reschedule', 'trigger') THEN
    RAISE EXCEPTION 'Invalid action: %. Must be schedule, unschedule, reschedule, or trigger.', p_action;
  END IF;

  IF p_job_name IS NULL OR p_job_name = '' THEN
    RAISE EXCEPTION 'job_name is required';
  END IF;

  IF p_edge_function IS NULL OR p_edge_function = '' THEN
    SELECT edge_function_name INTO v_edge_fn
    FROM public.sync_jobs
    WHERE job_name = p_job_name
    LIMIT 1;

    IF v_edge_fn IS NULL THEN
      RAISE EXCEPTION 'edge_function is required for new jobs not yet in sync_jobs';
    END IF;
    p_edge_function := v_edge_fn;
  END IF;

  -- Queue-based edge functions (added refresh-working-hours)
  v_use_queue := p_edge_function IN (
    'fetch-schedule',
    'fetch-leave-data',
    'sync-roster',
    'fetch-training-data',
    'fetch-elpa-data',
    'fetch-medical-data',
    'fetch-rating-data',
    'fetch-el-data',
    'refresh-working-hours'
  );

  IF p_action = 'trigger' THEN
    INSERT INTO public.cron_job_queue (
      job_name,
      edge_function_name,
      payload,
      triggered_by,
      priority
    )
    VALUES (
      p_job_name,
      p_edge_function,
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('__cron_job_name', p_job_name),
      'manual',
      10
    )
    RETURNING id INTO v_queue_id;

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'trigger',
      'job_name', p_job_name,
      'queue_id', v_queue_id
    );
  END IF;

  IF p_action = 'unschedule' THEN
    BEGIN
      PERFORM cron.unschedule(p_job_name);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    UPDATE public.sync_jobs
    SET is_active = false, updated_at = now()
    WHERE job_name = p_job_name;

    RETURN jsonb_build_object('ok', true, 'action', 'unschedule', 'job_name', p_job_name);
  END IF;

  IF p_cron_schedule IS NULL OR p_cron_schedule = '' THEN
    RAISE EXCEPTION 'cron_schedule is required for % action', p_action;
  END IF;

  IF p_action IN ('schedule', 'reschedule') THEN
    BEGIN
      PERFORM cron.unschedule(p_job_name);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  IF v_use_queue THEN
    PERFORM cron.schedule(
      p_job_name,
      p_cron_schedule,
      format(
        $q$INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by)
        VALUES (%L, %L, (%L::jsonb || jsonb_build_object('__cron_job_name', %L)), 'cron_job');$q$,
        p_job_name,
        p_edge_function,
        coalesce(p_payload, '{}'::jsonb)::text,
        p_job_name
      )
    );
  ELSE
    v_base := current_setting('app.settings.supabase_url', true) || '/functions/v1';
    v_skey := coalesce(
      current_setting('app.settings.service_role_key', true),
      current_setting('supabase.service_role_key', true)
    );

    IF v_base IS NULL OR v_base = '/functions/v1' THEN
      RAISE EXCEPTION 'app.settings.supabase_url not configured';
    END IF;
    IF v_skey IS NULL OR v_skey = '' THEN
      RAISE EXCEPTION 'service_role_key not configured (tried app.settings.service_role_key and supabase.service_role_key)';
    END IF;

    v_url := v_base || '/' || p_edge_function;

    PERFORM cron.schedule(
      p_job_name,
      p_cron_schedule,
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
        v_url,
        v_skey,
        v_skey,
        coalesce(p_payload, '{}'::jsonb)::text
      )
    );
  END IF;

  INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload, updated_at)
  VALUES (p_job_name, p_edge_function, p_cron_schedule, true, coalesce(p_payload, '{}'::jsonb), now())
  ON CONFLICT (job_name) DO UPDATE SET
    cron_schedule      = EXCLUDED.cron_schedule,
    edge_function_name = EXCLUDED.edge_function_name,
    is_active          = true,
    payload            = EXCLUDED.payload,
    updated_at         = now();

  RETURN jsonb_build_object(
    'ok', true,
    'action', p_action,
    'job_name', p_job_name,
    'cron_schedule', p_cron_schedule,
    'edge_function', p_edge_function,
    'queued', v_use_queue
  );
END;
$$;

REVOKE ALL ON FUNCTION public.manage_cron_job(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_cron_job(text, text, text, text, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--
--   -- Check table exists:
--   SELECT * FROM working_hours_cache LIMIT 1;
--
--   -- Check sync_jobs entries:
--   SELECT job_name, cron_schedule, is_active
--   FROM sync_jobs WHERE job_name LIKE 'working-hours-cache%';
--
--   -- Check pg_cron registration:
--   SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'working-hours-cache%';
--
--   -- Test refresh function:
--   SELECT refresh_working_hours_cache('2026-04');
--
--   -- Verify cache was populated:
--   SELECT month, employee_code, total_hours, computed_at
--   FROM working_hours_cache WHERE month = '2026-04' LIMIT 5;
-- ─────────────────────────────────────────────────────────────────────────────
