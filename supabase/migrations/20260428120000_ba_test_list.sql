-- ─────────────────────────────────────────────────────────────────────────────
-- BA Test List
--
-- Stores the Breath Analyser test roster fetched from Google Sheets.
-- Rows auto-expire after 2 days.
--
-- Components:
--   1. ba_test_list table + RLS
--   2. app_settings URL key
--   3. 6 sync_jobs entries (IST shift-change times)
--   4. Queue-based pg_cron registration (same pattern as working_hours_cache)
--   5. manage_cron_job() updated to include fetch-ba-test in queue list
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ba_test_list (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    sl_no         integer,
    employee_name text        NOT NULL,
    employee_code text,
    test_time     text,
    remarks       text,
    test_date     date        NOT NULL DEFAULT CURRENT_DATE,
    fetched_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL DEFAULT (now() + INTERVAL '2 days'),
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ba_test_list_test_date_idx  ON public.ba_test_list (test_date);
CREATE INDEX IF NOT EXISTS ba_test_list_expires_at_idx ON public.ba_test_list (expires_at);
CREATE INDEX IF NOT EXISTS ba_test_list_emp_code_idx   ON public.ba_test_list (employee_code);

-- ── 2. RLS — canonical TO service_role pattern ────────────────────────────────

ALTER TABLE public.ba_test_list ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Read: any authenticated user
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ba_test_list'
      AND policyname = 'ba_test_list_read'
  ) THEN
    CREATE POLICY "ba_test_list_read"
      ON public.ba_test_list FOR SELECT TO authenticated USING (true);
  END IF;

  -- Write: service role (edge functions / pg_cron)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ba_test_list'
      AND policyname = 'ba_test_list_service_write'
  ) THEN
    CREATE POLICY "ba_test_list_service_write"
      ON public.ba_test_list FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  -- Write: admin / supervisor for manual corrections
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'ba_test_list'
      AND policyname = 'ba_test_list_staff_manage'
  ) THEN
    CREATE POLICY "ba_test_list_staff_manage"
      ON public.ba_test_list FOR ALL TO authenticated
      USING  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
      WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));
  END IF;
END $$;

-- ── 3. app_settings URL key ───────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value, label, updated_at)
VALUES ('ba_test_sheet_url', '', 'BA Test List Google Sheet URL', now())
ON CONFLICT (key) DO NOTHING;

-- ── 4. sync_jobs seed ─────────────────────────────────────────────────────────
-- IST → UTC (-5:30):
--   05:40 IST = 00:10 UTC,  06:05 IST = 00:35 UTC
--   11:40 IST = 06:10 UTC,  12:05 IST = 06:35 UTC
--   17:40 IST = 12:10 UTC,  18:05 IST = 12:35 UTC

INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES
    ('ba-test-fetch-0540', 'fetch-ba-test', '10 0  * * *', true, '{"__cron_job_name":"ba-test-fetch-0540"}'),
    ('ba-test-fetch-0605', 'fetch-ba-test', '35 0  * * *', true, '{"__cron_job_name":"ba-test-fetch-0605"}'),
    ('ba-test-fetch-1140', 'fetch-ba-test', '10 6  * * *', true, '{"__cron_job_name":"ba-test-fetch-1140"}'),
    ('ba-test-fetch-1205', 'fetch-ba-test', '35 6  * * *', true, '{"__cron_job_name":"ba-test-fetch-1205"}'),
    ('ba-test-fetch-1740', 'fetch-ba-test', '10 12 * * *', true, '{"__cron_job_name":"ba-test-fetch-1740"}'),
    ('ba-test-fetch-1805', 'fetch-ba-test', '35 12 * * *', true, '{"__cron_job_name":"ba-test-fetch-1805"}')
ON CONFLICT (job_name) DO UPDATE SET
    edge_function_name = EXCLUDED.edge_function_name,
    cron_schedule      = EXCLUDED.cron_schedule,
    is_active          = true,
    payload            = EXCLUDED.payload,
    updated_at         = now();

-- ── 5. Register pg_cron jobs as queue inserts (no supabase_url needed) ────────

DO $$
DECLARE
    jobs text[][] := ARRAY[
        ARRAY['ba-test-fetch-0540', '10 0  * * *', 'fetch-ba-test', '{"__cron_job_name":"ba-test-fetch-0540"}'],
        ARRAY['ba-test-fetch-0605', '35 0  * * *', 'fetch-ba-test', '{"__cron_job_name":"ba-test-fetch-0605"}'],
        ARRAY['ba-test-fetch-1140', '10 6  * * *', 'fetch-ba-test', '{"__cron_job_name":"ba-test-fetch-1140"}'],
        ARRAY['ba-test-fetch-1205', '35 6  * * *', 'fetch-ba-test', '{"__cron_job_name":"ba-test-fetch-1205"}'],
        ARRAY['ba-test-fetch-1740', '10 12 * * *', 'fetch-ba-test', '{"__cron_job_name":"ba-test-fetch-1740"}'],
        ARRAY['ba-test-fetch-1805', '35 12 * * *', 'fetch-ba-test', '{"__cron_job_name":"ba-test-fetch-1805"}']
    ];
    j text[];
BEGIN
    FOREACH j SLICE 1 IN ARRAY jobs LOOP
        -- Idempotent: unschedule before re-registering
        BEGIN
            PERFORM cron.unschedule(j[1]);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        -- Register as a queue insert — avoids need for app.settings.supabase_url
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

-- ── 6. Update manage_cron_job() to include fetch-ba-test in queue list ────────
--
-- Any toggle / reschedule from the admin UI now correctly uses the queue path
-- instead of trying to call net.http_post (which would need app.settings.supabase_url).

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

  -- Queue-based edge functions (added fetch-ba-test)
  v_use_queue := p_edge_function IN (
    'fetch-schedule',
    'fetch-leave-data',
    'sync-roster',
    'fetch-training-data',
    'fetch-elpa-data',
    'fetch-medical-data',
    'fetch-rating-data',
    'fetch-el-data',
    'refresh-working-hours',
    'fetch-ba-test'
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

  -- Idempotent: always unschedule first
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
