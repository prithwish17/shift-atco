-- ─────────────────────────────────────────────────────────────────────────────
-- manage_cron_job() — admin-callable SECURITY DEFINER function
--
-- Actions: 'schedule', 'unschedule', 'reschedule'
-- Called via the manage-cron-job Edge Function (admin-auth gated).
--
-- Runs as the function owner (postgres) so it can access cron.schedule()
-- and cron.unschedule() which require superuser-level cron schema access.
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_base    text;
  v_skey    text;
  v_url     text;
  v_edge_fn text;
  v_result  jsonb;
BEGIN
  -- Validate action
  IF p_action NOT IN ('schedule', 'unschedule', 'reschedule') THEN
    RAISE EXCEPTION 'Invalid action: %. Must be schedule, unschedule, or reschedule.', p_action;
  END IF;

  -- Validate job_name
  IF p_job_name IS NULL OR p_job_name = '' THEN
    RAISE EXCEPTION 'job_name is required';
  END IF;

  -- Get base URL and service role key
  v_base := current_setting('app.settings.supabase_url', true) || '/functions/v1';
  v_skey := current_setting('app.settings.service_role_key', true);

  IF v_base IS NULL OR v_base = '/functions/v1' THEN
    RAISE EXCEPTION 'app.settings.supabase_url not configured';
  END IF;
  IF v_skey IS NULL OR v_skey = '' THEN
    RAISE EXCEPTION 'app.settings.service_role_key not configured';
  END IF;

  -- ── UNSCHEDULE ────────────────────────────────────────────────────────────
  IF p_action = 'unschedule' THEN
    -- Remove from pg_cron
    BEGIN
      PERFORM cron.unschedule(p_job_name);
    EXCEPTION WHEN OTHERS THEN
      -- Job may not exist in cron, that's fine
      NULL;
    END;

    -- Mark inactive in sync_jobs
    UPDATE public.sync_jobs
    SET is_active = false, updated_at = now()
    WHERE job_name = p_job_name;

    RETURN jsonb_build_object('ok', true, 'action', 'unschedule', 'job_name', p_job_name);
  END IF;

  -- ── SCHEDULE / RESCHEDULE ─────────────────────────────────────────────────
  IF p_cron_schedule IS NULL OR p_cron_schedule = '' THEN
    RAISE EXCEPTION 'cron_schedule is required for % action', p_action;
  END IF;

  -- For reschedule, unschedule first
  IF p_action = 'reschedule' THEN
    BEGIN
      PERFORM cron.unschedule(p_job_name);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- Look up edge_function from sync_jobs if not provided
  IF p_edge_function IS NULL OR p_edge_function = '' THEN
    v_edge_fn := (
      SELECT edge_function_name
      FROM public.sync_jobs
      WHERE job_name = p_job_name
      LIMIT 1
    );

    IF v_edge_fn IS NULL THEN
      RAISE EXCEPTION 'edge_function is required for new jobs not yet in sync_jobs';
    END IF;
    p_edge_function := v_edge_fn;
  END IF;

  -- Build the full URL
  v_url := v_base || '/' || p_edge_function;

  -- Register in pg_cron with 60s timeout
  PERFORM cron.schedule(
    p_job_name,
    p_cron_schedule,
    format(
      $q$SELECT net.http_post(
        url                  := %L,
        headers              := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey',        current_setting('app.settings.service_role_key'),
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
        ),
        body                 := %L::jsonb,
        timeout_milliseconds := 60000
      );$q$,
      v_url,
      p_payload::text
    )
  );

  -- Upsert into sync_jobs
  INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload, updated_at)
  VALUES (p_job_name, p_edge_function, p_cron_schedule, true, p_payload, now())
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
    'edge_function', p_edge_function
  );
END;
$$;

-- Grant execute to service_role only (edge function runs as service_role)
REVOKE ALL ON FUNCTION public.manage_cron_job(text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manage_cron_job(text, text, text, text, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--   SELECT public.manage_cron_job('schedule', 'test-job', '0 * * * *', 'fetch-schedule', '{}');
--   SELECT public.manage_cron_job('unschedule', 'test-job');
-- ─────────────────────────────────────────────────────────────────────────────
