-- ─────────────────────────────────────────────────────────────────────────────
-- Twice-daily OJT progress sync.
--
-- pg_cron runs in UTC; IST is UTC+5:30.
--   ojt-sync-midday   30 7  * * *  UTC = 13:00 IST
--   ojt-sync-evening  30 13 * * *  UTC = 19:00 IST
--
-- Both jobs go through cron_job_queue (not direct HTTP cron) so they inherit
-- retry, stale-job cleanup and get_cron_job_health() reporting. That requires
-- 'fetch-ojt-data' to be in the v_use_queue list inside manage_cron_job(),
-- which section 3 re-declares.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Register the jobs ────────────────────────────────────────────────────
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES
  ('ojt-sync-midday',  'fetch-ojt-data', '30 7 * * *',  true, '{}'),
  ('ojt-sync-evening', 'fetch-ojt-data', '30 13 * * *', true, '{}')
ON CONFLICT (job_name) DO UPDATE SET
  edge_function_name = EXCLUDED.edge_function_name,
  cron_schedule      = EXCLUDED.cron_schedule,
  is_active          = true,
  payload            = EXCLUDED.payload,
  updated_at         = now();

-- ─── 2. Schedule them as queue inserts ───────────────────────────────────────
DO $$
DECLARE
  jobs text[][] := ARRAY[
    ARRAY['ojt-sync-midday',  '30 7 * * *',  'fetch-ojt-data', '{}'],
    ARRAY['ojt-sync-evening', '30 13 * * *', 'fetch-ojt-data', '{}']
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

-- ─── 3. Teach manage_cron_job() that fetch-ojt-data is queue-backed ──────────
-- Identical to 20260425124000_idempotent_manage_cron_schedule.sql apart from the
-- added 'fetch-ojt-data' entry in v_use_queue.
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
    'fetch-el-data',
    'fetch-ojt-data'
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

  -- Idempotent for both schedule and reschedule. This prevents duplicate-name
  -- pg_cron errors when sync_jobs and cron.job drift out of sync.
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
