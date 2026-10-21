-- ─────────────────────────────────────────────────────────────────────────────
-- Only start the queue processors when there is work for them.
--
-- process-cron-queue fires every minute and process-notification-queue every
-- two, around the clock: ~2,160 pg_net calls a day, nearly all of which find an
-- empty queue. Each idle call still costs a pg_net request and response row, a
-- sync_jobs update and, for the notification processor, an api_call_logs insert
-- across eight indexes. On the free-tier instance that steady trickle is part of
-- what exhausts the disk IO budget (DISK_IO_MITIGATION_PLAN.md, Phase 2.1).
--
--   1. Two guard functions answer "is anything due?" from the queue tables.
--   2. Each pg_cron command gets `WHERE <guard>` appended. The command is
--      rewritten in place from cron.job, so the URL, headers and timeout each
--      job was registered with are kept exactly; only the condition is added.
--      pg_cron still fires on schedule, so latency is unchanged.
--   3. The health view stops expecting a heartbeat every minute. An idle
--      processor is healthy as long as pg_cron keeps firing it and no due work
--      is left waiting.
--   4. manage_cron_job, which the admin page uses to re-register jobs, adds
--      the same guard, so toggling a processor off and on keeps it.
--   5. system_health_check() counts the processors' firings the same way.
--
-- Apply this before deploying process-notification-queue: that function no
-- longer records idle runs, which the old health view would read as missed.
--
-- Undo: SELECT cron.alter_job(jobid, command := regexp_replace(command,
--         '\s*WHERE public\.\w+_has_due_work\(\);\s*$', ';'))
--       FROM cron.job WHERE jobname IN ('process-cron-queue', 'process-notification-queue');
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Guards
-- ═══════════════════════════════════════════════════════════════════════════

-- Due work for process-cron-queue: a pending job whose time has come, or a
-- running job old enough for cleanup_stale_queue_jobs() to recover. Retries
-- wait in 'pending' with a future available_at and do not count until due.
CREATE OR REPLACE FUNCTION public.cron_queue_has_due_work()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.cron_job_queue
           WHERE  status = 'pending' AND available_at <= now())
      OR EXISTS (
           SELECT 1 FROM public.cron_job_queue
           WHERE  status = 'running' AND started_at < now() - interval '5 minutes');
$$;

-- Due work for process-notification-queue: the same rows its claim query
-- selects, plus 'processing' rows recover_stale_notification_jobs() would
-- reset. While an admin has paused the email system the processor skips the
-- whole queue, so there is nothing for it to do and it is not started.
CREATE OR REPLACE FUNCTION public.notification_queue_has_due_work()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
           (SELECT value FROM public.app_settings WHERE key = 'email_system_enabled'),
           'true') <> 'false'
     AND (EXISTS (
            SELECT 1 FROM public.notification_queue
            WHERE  status IN ('pending', 'failed') AND next_attempt_at <= now())
       OR EXISTS (
            SELECT 1 FROM public.notification_queue
            WHERE  status = 'processing' AND processed_at < now() - interval '5 minutes'));
$$;

REVOKE ALL ON FUNCTION public.cron_queue_has_due_work()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_queue_has_due_work() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_queue_has_due_work()         TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_queue_has_due_work() TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Append the guard to each processor's pg_cron command
-- ═══════════════════════════════════════════════════════════════════════════
-- Both commands are a single `SELECT net.http_post(...);`, so a WHERE clause
-- after the select list turns them into "call only if due". Anything else is
-- left alone with a warning rather than rewritten blind.

DO $$
DECLARE
  r       record;
  v_guard text;
BEGIN
  FOR r IN
    SELECT jobid, jobname, command
    FROM   cron.job
    WHERE  jobname IN ('process-cron-queue', 'process-notification-queue')
  LOOP
    v_guard := CASE r.jobname
                 WHEN 'process-cron-queue' THEN 'public.cron_queue_has_due_work()'
                 ELSE 'public.notification_queue_has_due_work()'
               END;

    IF position(v_guard IN r.command) > 0 THEN
      CONTINUE;  -- already guarded
    END IF;

    IF r.command !~* '^\s*SELECT\s+net\.http_post\s*\('
       OR regexp_replace(r.command, ';\s*$', '') LIKE '%;%' THEN
      RAISE WARNING '% left unguarded: its command is not a single SELECT net.http_post(...)', r.jobname;
      CONTINUE;
    END IF;

    PERFORM cron.alter_job(
      r.jobid,
      command := regexp_replace(r.command, ';?\s*$', '') || E'\nWHERE ' || v_guard || ';'
    );
    RAISE NOTICE '% now runs only when %', r.jobname, v_guard;
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Health view: an idle processor is healthy
-- ═══════════════════════════════════════════════════════════════════════════
-- Same columns and rules as 20260922120000_fix_cron_queue_health.sql except:
--   • For the two processors, "last run" is the later of the processor's own
--     sync_jobs.last_run_at and pg_cron's last firing, which is now the last
--     time the queue was checked.
--   • process-cron-queue is missed when pg_cron has not fired it for 5 minutes
--     and stale when a due job has waited 15 (the threshold the per-job 'stale'
--     rule uses). process-notification-queue is missed after 10 minutes and
--     stale when due notifications have waited 30: it sends 50 per firing, so
--     a burst of a few hundred takes several firings to drain. The old rule
--     wanted a heartbeat every 5 minutes, which an idle processor no longer
--     writes.
--   • A failed firing (the guard or pg_net erroring) shows as failed. A failed
--     notification run shows as failed only while notification work is still
--     outstanding; one that left nothing to do (say, a dead-lettered email)
--     would otherwise stay red until the next email, since nothing re-runs it.
--   • Last error: pg_cron's return_message counts as an error only when the
--     firing failed (otherwise it reads '1 row'), and a stale processor says
--     how much work is waiting and since when.

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
    coalesce(cj.schedule, sj.cron_schedule) AS cron_schedule,
    sj.is_active,
    sj.last_run_at,
    sj.last_run_status,
    cj.jobid,
    cj.jobname IS NOT NULL AS is_registered
  FROM public.sync_jobs sj
  LEFT JOIN cron.job cj ON cj.jobname = sj.job_name

  UNION ALL

  SELECT
    cj.jobname,
    NULL::text,
    cj.schedule,
    cj.active,
    NULL::timestamptz,
    NULL::text,
    cj.jobid,
    true
  FROM cron.job cj
  LEFT JOIN public.sync_jobs sj ON sj.job_name = cj.jobname
  WHERE sj.job_name IS NULL
),
latest_queue AS (
  SELECT DISTINCT ON (q.job_name)
    q.job_name, q.status, q.queued_at, q.available_at, q.started_at, q.completed_at, q.error_message
  FROM public.cron_job_queue q
  ORDER BY q.job_name, q.queued_at DESC
),
latest_cron_run AS (
  SELECT DISTINCT ON (d.jobid)
    d.jobid, d.status, d.start_time, d.return_message
  FROM cron.job_run_details d
  ORDER BY d.jobid, d.runid DESC
),
latest_error AS (
  SELECT DISTINCT ON (coalesce(l.job_name, replace(l.endpoint, '/functions/v1/', '')))
    coalesce(l.job_name, replace(l.endpoint, '/functions/v1/', '')) AS job_name,
    l.message
  FROM public.api_call_logs l
  WHERE l.status = 'error'
  ORDER BY coalesce(l.job_name, replace(l.endpoint, '/functions/v1/', '')), l.created_at DESC
),
email_on AS (
  SELECT coalesce(
           (SELECT value FROM public.app_settings WHERE key = 'email_system_enabled'),
           'true') <> 'false' AS enabled
),
-- Work the processors have left waiting too long, and whether any
-- notification work is outstanding at all.
backlog AS (
  SELECT
    (SELECT count(*) FROM public.cron_job_queue
      WHERE status = 'pending' AND available_at < now() - interval '15 minutes') AS cron_waiting,
    (SELECT min(available_at) FROM public.cron_job_queue
      WHERE status = 'pending' AND available_at < now() - interval '15 minutes') AS cron_waiting_since,
    (SELECT count(*) FROM public.notification_queue
      WHERE e.enabled AND status IN ('pending', 'failed')
        AND next_attempt_at < now() - interval '30 minutes') AS notif_waiting,
    (SELECT min(next_attempt_at) FROM public.notification_queue
      WHERE e.enabled AND status IN ('pending', 'failed')
        AND next_attempt_at < now() - interval '30 minutes') AS notif_waiting_since,
    e.enabled AND EXISTS (
      SELECT 1 FROM public.notification_queue
      WHERE (status IN ('pending', 'failed') AND next_attempt_at <= now())
         OR status = 'processing') AS notif_outstanding
  FROM email_on e
),
joined AS (
  SELECT
    ju.*,
    lq.status        AS q_status,
    lq.queued_at     AS q_queued_at,
    lq.available_at  AS q_available_at,
    lq.started_at    AS q_started_at,
    lq.completed_at  AS q_completed_at,
    lq.error_message AS q_error,
    lcr.status       AS cron_status,
    lcr.start_time   AS cron_start,
    lcr.return_message AS cron_error,
    -- sync_jobs / the queue say when the function ran; pg_cron's own history
    -- is the fallback for jobs that record neither (it only proves it fired).
    -- A gated processor is only started when there is work, so for those the
    -- last firing — the last time the queue was checked — counts as a run.
    CASE
      WHEN ju.job_name IN ('process-cron-queue', 'process-notification-queue')
        THEN greatest(ju.last_run_at, lcr.start_time)
      ELSE coalesce(greatest(ju.last_run_at, lq.completed_at), lcr.start_time)
    END AS eff_last_run,
    le.message AS log_error,
    b.*
  FROM job_union ju
  CROSS JOIN backlog b
  LEFT JOIN latest_queue    lq  ON lq.job_name = ju.job_name
  LEFT JOIN latest_cron_run lcr ON lcr.jobid = ju.jobid
  LEFT JOIN latest_error    le  ON le.job_name = ju.job_name
),
scored AS (
  SELECT
    j.*,
    CASE
      WHEN coalesce(j.is_active, false) = false THEN 'disabled'
      WHEN j.is_registered = false THEN 'not_registered'
      -- The two queue processors: judged on pg_cron firing them and on the
      -- queues draining, not on a heartbeat.
      WHEN j.job_name = 'process-cron-queue' THEN CASE
        WHEN j.cron_status = 'failed' THEN 'failed'
        WHEN coalesce(j.eff_last_run, '-infinity') < now() - interval '5 minutes' THEN 'missed'
        WHEN j.cron_waiting > 0 THEN 'stale'
        ELSE 'healthy'
      END
      -- A run that errors with work left (due, or claimed and unfinished) is
      -- started again by the guard; the error clears when that run succeeds.
      WHEN j.job_name = 'process-notification-queue' THEN CASE
        WHEN j.cron_status = 'failed' THEN 'failed'
        WHEN coalesce(j.eff_last_run, '-infinity') < now() - interval '10 minutes' THEN 'missed'
        WHEN j.notif_waiting > 0 THEN 'stale'
        WHEN j.last_run_status = 'error' AND j.notif_outstanding THEN 'failed'
        ELSE 'healthy'
      END
      WHEN j.q_status = 'running' AND j.q_started_at < now() - interval '5 minutes' THEN 'stale'
      -- Queue not draining: a due job has sat unclaimed for 15 minutes.
      WHEN j.q_status = 'pending' AND j.q_available_at < now() - interval '15 minutes' THEN 'stale'
      WHEN j.q_status = 'failed' THEN 'failed'
      -- A retry is queued, but the last attempt still failed.
      WHEN j.q_status IN ('pending', 'running') AND j.last_run_status = 'error' THEN 'failed'
      WHEN j.q_status IS NULL AND j.last_run_status = 'error' THEN 'failed'
      WHEN j.q_status IS NULL AND j.last_run_at IS NULL AND j.cron_status = 'failed' THEN 'failed'
      WHEN j.eff_last_run IS NULL
        THEN CASE WHEN j.edge_function_name IS NOT NULL THEN 'missed' ELSE 'healthy' END
      WHEN j.eff_last_run < now() - public.cron_expected_gap(j.cron_schedule) THEN 'missed'
      ELSE 'healthy'
    END AS health_status
  FROM joined j
)
SELECT
  s.job_name,
  s.edge_function_name,
  s.cron_schedule,
  s.is_active,
  s.is_registered,
  s.health_status,
  s.eff_last_run,
  coalesce(s.last_run_status, CASE s.cron_status WHEN 'succeeded' THEN 'success' WHEN 'failed' THEN 'error' END),
  s.q_status,
  s.q_queued_at,
  s.q_completed_at,
  -- Only surface an error while it is still the current state; an old error
  -- next to a healthy job reads as a live problem.
  CASE
    WHEN s.health_status NOT IN ('failed', 'stale') THEN NULL
    WHEN s.job_name IN ('process-cron-queue', 'process-notification-queue')
     AND s.cron_status = 'failed' THEN s.cron_error
    WHEN s.job_name = 'process-cron-queue' AND s.cron_waiting > 0
      THEN format('%s due job(s) waiting since %s IST', s.cron_waiting,
                  to_char(s.cron_waiting_since AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI'))
    WHEN s.job_name = 'process-notification-queue' AND s.notif_waiting > 0
      THEN format('%s notification(s) waiting since %s IST', s.notif_waiting,
                  to_char(s.notif_waiting_since AT TIME ZONE 'Asia/Kolkata', 'DD Mon HH24:MI'))
    ELSE coalesce(s.q_error, s.log_error, CASE WHEN s.cron_status = 'failed' THEN s.cron_error END)
  END
FROM scored s
ORDER BY s.job_name;
$$;

REVOKE ALL ON FUNCTION public.get_cron_job_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cron_job_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_job_health() TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. manage_cron_job keeps the guard
-- ═══════════════════════════════════════════════════════════════════════════
-- The admin Cron Jobs page's switch and "change time" call manage_cron_job,
-- which re-registers a job from scratch. For the two processors that wrote a
-- plain net.http_post again, silently dropping the guard (and giving
-- process-cron-queue a 60s timeout instead of the 150s it needs). Unchanged
-- from 20260814130000_kolkata_joining_date.sql apart from the guard, the
-- timeout, and refresh-working-hours and fetch-ba-test going back on the
-- queue list; CREATE OR REPLACE keeps its existing grants.

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
  v_guard     text;
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
    'fetch-trainee-data',
    -- In the list from 20260427/20260428; lost when 20260811110000 was copied
    -- from an older version, so toggling them sent them around the queue.
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

    -- The queue processors only run when their queue has work (section 2).
    v_guard := CASE p_edge_function
                 WHEN 'process-cron-queue'         THEN 'public.cron_queue_has_due_work()'
                 WHEN 'process-notification-queue' THEN 'public.notification_queue_has_due_work()'
               END;

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
          timeout_milliseconds := %s
        )%s;$q$,
        v_url,
        v_skey,
        v_skey,
        coalesce(p_payload, '{}'::jsonb)::text,
        -- process-cron-queue runs for up to 140s (20260922120000).
        CASE WHEN p_edge_function = 'process-cron-queue' THEN 150000 ELSE 60000 END,
        coalesce(E'\nWHERE ' || v_guard, '')
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. system_health_check counts the processors' firings too
-- ═══════════════════════════════════════════════════════════════════════════
-- Its cron_jobs list called a job stale after 25 hours without a run, read
-- from sync_jobs. A gated notification processor can go that long with no
-- email to send (a quiet weekend, or email paused). Unchanged from
-- 20260404300000_observability_system.sql apart from that rule.

CREATE OR REPLACE FUNCTION public.system_health_check()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'timestamp', now(),

    -- Notification queue depth: should be < 100 normally
    'notification_queue', (
      SELECT jsonb_build_object(
        'pending',     COUNT(*) FILTER (WHERE status = 'pending'),
        'processing',  COUNT(*) FILTER (WHERE status = 'processing'),
        'failed',      COUNT(*) FILTER (WHERE status = 'failed'),
        'dead_letter',  COUNT(*) FILTER (WHERE status = 'dead_letter'),
        'oldest_pending', MIN(created_at) FILTER (WHERE status = 'pending')
      ) FROM public.notification_queue
      WHERE status NOT IN ('sent')
    ),

    -- Cron health: last run of each scheduled job. The two queue processors
    -- only run when there is work, so their last pg_cron firing (the last time
    -- they checked the queue) counts as a run (20261021100000).
    'cron_jobs', (
      SELECT jsonb_agg(jsonb_build_object(
        'job', sj.job_name,
        'last_run', r.last_run,
        'status', sj.last_run_status,
        'stale', (r.last_run < now() - interval '25 hours')
      ))
      FROM public.sync_jobs sj
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN sj.job_name IN ('process-cron-queue', 'process-notification-queue') THEN
            greatest(sj.last_run_at, (
              SELECT max(d.start_time)
              FROM   cron.job_run_details d
              JOIN   cron.job j ON j.jobid = d.jobid
              WHERE  j.jobname = sj.job_name))
          ELSE sj.last_run_at
        END AS last_run
      ) r
      WHERE sj.is_active = true
    ),

    -- Error rate: errors in last 24h
    'errors_24h', (
      SELECT jsonb_build_object(
        'total',    COUNT(*),
        'fatal',    COUNT(*) FILTER (WHERE severity = 'fatal'),
        'error',    COUNT(*) FILTER (WHERE severity = 'error'),
        'unresolved', COUNT(*) FILTER (WHERE resolved_at IS NULL)
      )
      FROM public.edge_function_errors
      WHERE created_at > now() - interval '24 hours'
    ),

    -- Email delivery: last 24h
    'email_24h', (
      SELECT jsonb_build_object(
        'sent',   COUNT(*) FILTER (WHERE status = 'sent'),
        'failed', COUNT(*) FILTER (WHERE status = 'failed')
      )
      FROM public.email_logs
      WHERE created_at > now() - interval '24 hours'
    ),

    -- Leave queue: pending approvals count
    'leave_pending', (
      SELECT jsonb_build_object(
        'pending_wso',        COUNT(*) FILTER (WHERE status = 'Pending WSO'),
        'pending_supervisor', COUNT(*) FILTER (WHERE status = 'Pending Supervisor'),
        'oldest_pending',     MIN(applied_at) FILTER (WHERE status IN ('Pending WSO', 'Pending Supervisor'))
      )
      FROM public.leave_requests
    )

  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.system_health_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.system_health_check() TO authenticated, service_role;
