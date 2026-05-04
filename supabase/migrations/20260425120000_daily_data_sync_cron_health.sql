-- ─────────────────────────────────────────────────────────────────────────────
-- Daily data sync jobs + queue-aware cron management + health diagnostics.
--
-- Adds once-daily queued syncs for Training, ELPA, Medical, Rating, Leave, and EL
-- data. Also updates manage_cron_job() so admin reschedules/toggles preserve the
-- queue architecture for sync jobs instead of recreating direct HTTP cron jobs.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0. Ensure queue infrastructure exists. Some production projects may have the
-- sync_jobs/roster cron migrations applied without the queue migration.
CREATE TABLE IF NOT EXISTS public.cron_job_queue (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name           text        NOT NULL,
  edge_function_name text        NOT NULL,
  payload            jsonb       NOT NULL DEFAULT '{}',
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  priority           integer     NOT NULL DEFAULT 0,
  queued_at          timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  error_message      text,
  triggered_by       text        NOT NULL DEFAULT 'cron_job',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_job_queue_pending
  ON public.cron_job_queue (status, priority DESC, queued_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_cron_job_queue_created
  ON public.cron_job_queue (created_at DESC);

ALTER TABLE public.cron_job_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cron_job_queue'
      AND policyname = 'Admins can view queue'
  ) THEN
    CREATE POLICY "Admins can view queue"
      ON public.cron_job_queue FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = auth.uid()
            AND role IN ('admin', 'wso')
            AND approved = true
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cron_job_queue'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access"
      ON public.cron_job_queue FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.claim_next_queue_job()
RETURNS public.cron_job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cron_job_queue;
BEGIN
  UPDATE public.cron_job_queue
  SET    status     = 'running',
         started_at = now()
  WHERE  id = (
    SELECT id
    FROM   public.cron_job_queue
    WHERE  status = 'pending'
    ORDER  BY priority DESC, queued_at ASC
    LIMIT  1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_queue_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_next_queue_job() TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_stale_queue_jobs(p_timeout_minutes integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.cron_job_queue
  SET    status        = 'failed',
         completed_at  = now(),
         error_message = format(
           'Job timed out: was running for more than %s minutes without completing',
           p_timeout_minutes
         )
  WHERE  status     = 'running'
    AND  started_at < now() - (p_timeout_minutes || ' minutes')::interval;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_queue_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_queue_jobs(integer) TO service_role;

-- 1. Seed daily jobs into sync_jobs.
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES
  ('training-sync-daily', 'fetch-training-data', '30 17 * * *', true, '{}'),
  ('elpa-sync-daily',     'fetch-elpa-data',     '35 17 * * *', true, '{}'),
  ('medical-sync-daily',  'fetch-medical-data',  '40 17 * * *', true, '{}'),
  ('rating-sync-daily',   'fetch-rating-data',   '45 17 * * *', true, '{}'),
  ('leave-sync-daily',    'fetch-leave-data',    '50 17 * * *', true, '{}'),
  ('el-sync-daily',       'fetch-el-data',       '55 17 * * *', true, '{}')
ON CONFLICT (job_name) DO UPDATE SET
  edge_function_name = EXCLUDED.edge_function_name,
  cron_schedule      = EXCLUDED.cron_schedule,
  is_active          = true,
  payload            = EXCLUDED.payload,
  updated_at         = now();

-- 2. Register daily jobs as queue inserts.
DO $$
DECLARE
  jobs text[][] := ARRAY[
    ARRAY['training-sync-daily', '30 17 * * *', 'fetch-training-data', '{}'],
    ARRAY['elpa-sync-daily',     '35 17 * * *', 'fetch-elpa-data',     '{}'],
    ARRAY['medical-sync-daily',  '40 17 * * *', 'fetch-medical-data',  '{}'],
    ARRAY['rating-sync-daily',   '45 17 * * *', 'fetch-rating-data',   '{}'],
    ARRAY['leave-sync-daily',    '50 17 * * *', 'fetch-leave-data',    '{}'],
    ARRAY['el-sync-daily',       '55 17 * * *', 'fetch-el-data',       '{}']
  ];
  j text[];
BEGIN
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN
      PERFORM cron.unschedule(j[1]);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      j[1],
      j[2],
      format(
        $q$INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by)
        VALUES (%L, %L, (%L::jsonb || jsonb_build_object('__cron_job_name', %L)), 'cron_job');$q$,
        j[1], j[3], j[4], j[1]
      )
    );
  END LOOP;
END $$;

-- 3. Queue-aware manage_cron_job().
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

  v_use_queue := p_edge_function IN (
    'fetch-schedule',
    'fetch-leave-data',
    'sync-roster',
    'fetch-training-data',
    'fetch-elpa-data',
    'fetch-medical-data',
    'fetch-rating-data',
    'fetch-el-data'
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

-- 4. Cron health diagnostics for Admin → Cron Jobs.
CREATE OR REPLACE FUNCTION public.get_cron_job_health()
RETURNS TABLE (
  job_name text,
  edge_function_name text,
  cron_schedule text,
  is_active boolean,
  is_registered boolean,
  health_status text,
  last_run_at timestamptz,
  last_run_status text,
  last_queue_status text,
  last_queued_at timestamptz,
  last_completed_at timestamptz,
  last_error text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron
AS $$
WITH job_union AS (
  SELECT
    sj.job_name,
    sj.edge_function_name,
    sj.cron_schedule,
    sj.is_active,
    sj.last_run_at,
    sj.last_run_status,
    cj.jobname IS NOT NULL AS is_registered,
    cj.jobname AS cron_jobname
  FROM public.sync_jobs sj
  LEFT JOIN cron.job cj ON cj.jobname = sj.job_name

  UNION ALL

  SELECT
    cj.jobname AS job_name,
    NULL::text AS edge_function_name,
    cj.schedule AS cron_schedule,
    cj.active AS is_active,
    NULL::timestamptz AS last_run_at,
    NULL::text AS last_run_status,
    true AS is_registered,
    cj.jobname AS cron_jobname
  FROM cron.job cj
  LEFT JOIN public.sync_jobs sj ON sj.job_name = cj.jobname
  WHERE sj.job_name IS NULL
),
latest_queue AS (
  SELECT DISTINCT ON (q.job_name)
    q.job_name,
    q.status,
    q.queued_at,
    q.completed_at,
    q.started_at,
    q.error_message
  FROM public.cron_job_queue q
  ORDER BY q.job_name, q.queued_at DESC
),
latest_error AS (
  SELECT DISTINCT ON (coalesce(l.job_name, replace(l.endpoint, '/functions/v1/', '')))
    coalesce(l.job_name, replace(l.endpoint, '/functions/v1/', '')) AS job_name,
    l.message
  FROM public.api_call_logs l
  WHERE l.status = 'error'
  ORDER BY coalesce(l.job_name, replace(l.endpoint, '/functions/v1/', '')), l.created_at DESC
)
SELECT
  ju.job_name,
  ju.edge_function_name,
  ju.cron_schedule,
  ju.is_active,
  ju.is_registered,
  CASE
    WHEN coalesce(ju.is_active, false) = false THEN 'disabled'
    WHEN ju.is_registered = false THEN 'not_registered'
    WHEN lq.status = 'running' AND lq.started_at < now() - interval '5 minutes' THEN 'stale'
    WHEN lq.status = 'failed' THEN 'failed'
    WHEN ju.last_run_status = 'error' THEN 'failed'
    WHEN ju.last_run_at IS NULL AND ju.edge_function_name IS NOT NULL THEN 'missed'
    WHEN ju.job_name = 'process-cron-queue'
      AND ju.last_run_at < now() - interval '5 minutes' THEN 'missed'
    WHEN ju.job_name LIKE 'schedule-sync-%'
      AND ju.last_run_at < now() - interval '6 hours' THEN 'missed'
    WHEN ju.job_name LIKE 'leave-sync-%'
      AND ju.last_run_at < now() - interval '8 hours' THEN 'missed'
    WHEN ju.job_name LIKE '%-daily'
      AND ju.last_run_at < now() - interval '30 hours' THEN 'missed'
    WHEN ju.edge_function_name = 'sync-roster'
      AND ju.last_run_at < now() - interval '30 hours' THEN 'missed'
    ELSE 'healthy'
  END AS health_status,
  ju.last_run_at,
  ju.last_run_status,
  lq.status AS last_queue_status,
  lq.queued_at AS last_queued_at,
  lq.completed_at AS last_completed_at,
  coalesce(lq.error_message, le.message) AS last_error
FROM job_union ju
LEFT JOIN latest_queue lq ON lq.job_name = ju.job_name
LEFT JOIN latest_error le ON le.job_name = ju.job_name
ORDER BY ju.job_name;
$$;

REVOKE ALL ON FUNCTION public.get_cron_job_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_cron_job_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_job_health() TO service_role;
