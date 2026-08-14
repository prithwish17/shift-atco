-- ─────────────────────────────────────────────────────────────────────────────
-- Kolkata joining date, from the CAP Kolkata Master "ATCO LIST" sheet.
--
-- The app had no Kolkata joining date. profiles.date_of_joining is a single
-- unlabelled field, self-entered by each employee, and exists only for people
-- with an app account — so it could not distinguish "joined AAI" from "joined
-- Kolkata", and did not cover the roster.
--
-- The master list carries both, in adjacent columns: DOJ_AAI (J) and DOJ (K).
-- They land in different places, because they mean different things and serve
-- different consumers:
--
--   employee_training_records.kolkata_joining_date  <- DOJ, column K
--       Keyed by emp_id TEXT, so it covers all 374 roster members rather than
--       only account-holders. SARC reads it to decide which ratings count: a
--       rating earned at a previous station is not a Kolkata rating.
--
--   profiles.date_of_joining                        <- DOJ_AAI, column J
--       Now means one thing — the AAI service date — instead of whatever each
--       employee typed. Display only.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.employee_training_records
  ADD COLUMN IF NOT EXISTS kolkata_joining_date DATE,
  ADD COLUMN IF NOT EXISTS atco_master_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transferred_out BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.employee_training_records.kolkata_joining_date IS
  'Date the controller joined Kolkata (ATCO LIST column DOJ). Drives which ratings count for SARC.';
COMMENT ON COLUMN public.employee_training_records.transferred_out IS
  'TRANSFER STATUS = OUT in the master list — posted away from Kolkata.';

-- Partial index: SARC only ever asks for people who have one.
CREATE INDEX IF NOT EXISTS employee_training_records_kolkata_joining_idx
  ON public.employee_training_records (kolkata_joining_date)
  WHERE kolkata_joining_date IS NOT NULL;

-- ── Sync configuration ───────────────────────────────────────────────────────

INSERT INTO public.app_settings (key, value, label)
VALUES ('atco_master_webapp_url', '', 'ATCO Master Webapp URL')
ON CONFLICT (key) DO NOTHING;

-- Weekly, Sunday. The master list changes on posting orders, not daily, so a
-- nightly pull would be noise. 02:30 UTC = 08:00 IST Sunday — after the
-- overnight jobs, before anyone opens the app on Monday.
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES ('atco-master-sync-weekly', 'fetch-atco-master', '30 2 * * 0', true, '{}')
ON CONFLICT (job_name) DO UPDATE SET
  edge_function_name = EXCLUDED.edge_function_name,
  cron_schedule      = EXCLUDED.cron_schedule,
  is_active          = true,
  payload            = EXCLUDED.payload,
  updated_at         = now();

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('atco-master-sync-weekly');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'atco-master-sync-weekly',
    '30 2 * * 0',
    format(
      $q$INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by)
      VALUES (%L, %L, (%L::jsonb || jsonb_build_object('__cron_job_name', %L)), 'cron_job');$q$,
      'atco-master-sync-weekly', 'fetch-atco-master', '{}', 'atco-master-sync-weekly'
    )
  );
END $$;

-- ── Register fetch-atco-master as queue-backed ───────────────────────────────
-- Verbatim re-emission of the definition in 20260811150000_trainee_sync_cron.sql
-- with 'fetch-atco-master' added to the allowlist, so an admin reschedule keeps
-- the queue architecture instead of falling back to direct HTTP cron.

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
    'fetch-atco-master',
    'fetch-ojt-data',
    'fetch-trainee-data'
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
