-- ─────────────────────────────────────────────────────────────────────────────
-- Fix the cron queue and make Admin → Cron Jobs → Health report the truth.
--
-- What was wrong (checked against production on 2026-09-22):
--   • process-cron-queue chained .catch() onto Supabase query builders, which
--     only implement .then(). It threw a TypeError after every job, before it
--     wrote sync_jobs.last_run_at and api_call_logs. Every queued job whose
--     function does not write sync_jobs itself (leave, EL, ELPA, medical,
--     rating, training, OJT, trainee, working-hours) showed as "missed" even
--     though it completed.
--   • The queue aborted each job after ~45s, while sync-roster budgets up to
--     110s. Roster runs that went on to succeed were recorded as "Signal timed out".
--   • Nothing was retried, so Google's sporadic 404s from Apps Script and
--     published sheets left the job failed until the next day.
--   • The health view called schedule-sync / leave-sync "missed" after 6-8h,
--     but each of those jobs runs once a day. It also showed the newest error
--     ever logged, even when later runs had succeeded.
--   • roster-night-19h … 23h were never added to sync_jobs.
--
-- The edge function half of the fix is supabase/functions/process-cron-queue.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Retry bookkeeping on the queue.
ALTER TABLE public.cron_job_queue
  ADD COLUMN IF NOT EXISTS attempt      integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_attempts integer     NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now();

-- 2. Claim the next due job, one job at a time.
--
-- process-cron-queue now runs for up to 140s and is started every minute, so
-- two invocations overlap. The advisory lock serialises claimers and the
-- running-job check keeps the queue single-flight, as it was designed to be.
CREATE OR REPLACE FUNCTION public.claim_next_queue_job()
RETURNS public.cron_job_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cron_job_queue;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.claim_next_queue_job'));

  IF EXISTS (
    SELECT 1 FROM public.cron_job_queue
    WHERE  status = 'running'
      AND  started_at > now() - interval '5 minutes'
  ) THEN
    RETURN v_job;
  END IF;

  UPDATE public.cron_job_queue
  SET    status     = 'running',
         started_at = now()
  WHERE  id = (
    SELECT id
    FROM   public.cron_job_queue
    WHERE  status = 'pending'
      AND  available_at <= now()
    ORDER  BY priority DESC, available_at ASC, queued_at ASC
    LIMIT  1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_queue_job() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_queue_job() TO service_role;

-- 3. Give the pg_net call as long as the processor may run (140s budget).
DO $$
DECLARE
  base text := coalesce(
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'https://ilkrqlxrqaelflslbdnx.supabase.co'
  ) || '/functions/v1';
BEGIN
  BEGIN
    PERFORM cron.unschedule('process-cron-queue');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'process-cron-queue',
    '* * * * *',
    format(
      $q$SELECT net.http_post(
        url                  := %L,
        headers              := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(
            current_setting('supabase.service_role_key', true),
            current_setting('app.settings.service_role_key', true),
            ''
          )
        ),
        body                 := '{}'::jsonb,
        timeout_milliseconds := 150000
      );$q$,
      base || '/process-cron-queue'
    )
  );
END $$;

-- 4. Bring sync_jobs in line with what pg_cron actually runs.
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES
  ('roster-night-19h', 'sync-roster', '30 13 * * *', true, '{"shift":"Night"}'),
  ('roster-night-20h', 'sync-roster', '30 14 * * *', true, '{"shift":"Night"}'),
  ('roster-night-21h', 'sync-roster', '30 15 * * *', true, '{"shift":"Night"}'),
  ('roster-night-22h', 'sync-roster', '30 16 * * *', true, '{"shift":"Night"}'),
  ('roster-night-23h', 'sync-roster', '30 17 * * *', true, '{"shift":"Night"}')
ON CONFLICT (job_name) DO NOTHING;

-- Some rows drifted from their cron entry (leave-sync-* says :30, fires at :35).
UPDATE public.sync_jobs sj
SET    cron_schedule = cj.schedule,
       updated_at    = now()
FROM   cron.job cj
WHERE  cj.jobname = sj.job_name
  AND  regexp_replace(trim(cj.schedule), '\s+', ' ', 'g')
    <> regexp_replace(trim(sj.cron_schedule), '\s+', ' ', 'g');

-- Queued jobs that completed before this fix never got last_run_at written.
UPDATE public.sync_jobs sj
SET    last_run_at     = q.completed_at,
       last_run_status = CASE WHEN q.status = 'completed' THEN 'success' ELSE 'error' END
FROM  (
  SELECT DISTINCT ON (job_name) job_name, status, completed_at
  FROM   public.cron_job_queue
  WHERE  status IN ('completed', 'failed') AND completed_at IS NOT NULL
  ORDER  BY job_name, completed_at DESC
) q
WHERE  q.job_name = sj.job_name
  AND  (sj.last_run_at IS NULL OR sj.last_run_at < q.completed_at);

-- 5. How long a job may go without running before it counts as missed:
--    one period of its schedule plus an hour's grace.
CREATE OR REPLACE FUNCTION public.cron_expected_gap(p_schedule text)
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$
  WITH f AS (SELECT regexp_split_to_array(trim(coalesce(p_schedule, '')), '\s+') AS p)
  SELECT CASE
    WHEN array_length(p, 1) < 5                    THEN interval '25 hours'
    WHEN p[3] <> '*'                               THEN interval '32 days'   -- monthly
    WHEN p[5] <> '*'                               THEN interval '8 days'    -- weekly
    WHEN p[2] = '*'                                THEN interval '1 hour'    -- every N minutes
    WHEN p[2] ~ '^\*/[0-9]+$'
      THEN make_interval(hours => split_part(p[2], '/', 2)::int + 1)        -- every N hours
    ELSE interval '25 hours'                                                -- daily
  END
  FROM f;
$$;

-- 6. Health view. Same columns as before; the status logic is what changed.
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
scored AS (
  SELECT
    ju.*,
    lq.status        AS q_status,
    lq.queued_at     AS q_queued_at,
    lq.completed_at  AS q_completed_at,
    lq.error_message AS q_error,
    lcr.status       AS cron_status,
    lcr.return_message AS cron_error,
    -- sync_jobs / the queue say when the function ran; pg_cron's own history
    -- is the fallback for jobs that record neither (it only proves it fired).
    coalesce(greatest(ju.last_run_at, lq.completed_at), lcr.start_time) AS eff_last_run,
    CASE
      WHEN coalesce(ju.is_active, false) = false THEN 'disabled'
      WHEN ju.is_registered = false THEN 'not_registered'
      WHEN lq.status = 'running' AND lq.started_at < now() - interval '5 minutes' THEN 'stale'
      -- Queue not draining: a due job has sat unclaimed for 15 minutes.
      WHEN lq.status = 'pending' AND lq.available_at < now() - interval '15 minutes' THEN 'stale'
      WHEN ju.job_name = 'process-cron-queue'
        AND coalesce(ju.last_run_at, '-infinity') < now() - interval '5 minutes' THEN 'missed'
      WHEN lq.status = 'failed' THEN 'failed'
      -- A retry is queued, but the last attempt still failed.
      WHEN lq.status IN ('pending', 'running') AND ju.last_run_status = 'error' THEN 'failed'
      WHEN lq.status IS NULL AND ju.last_run_status = 'error' THEN 'failed'
      WHEN lq.status IS NULL AND ju.last_run_at IS NULL AND lcr.status = 'failed' THEN 'failed'
      WHEN coalesce(greatest(ju.last_run_at, lq.completed_at), lcr.start_time) IS NULL
        THEN CASE WHEN ju.edge_function_name IS NOT NULL THEN 'missed' ELSE 'healthy' END
      WHEN coalesce(greatest(ju.last_run_at, lq.completed_at), lcr.start_time)
           < now() - public.cron_expected_gap(ju.cron_schedule) THEN 'missed'
      ELSE 'healthy'
    END AS health_status,
    le.message AS log_error
  FROM job_union ju
  LEFT JOIN latest_queue    lq  ON lq.job_name = ju.job_name
  LEFT JOIN latest_cron_run lcr ON lcr.jobid = ju.jobid
  LEFT JOIN latest_error    le  ON le.job_name = ju.job_name
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
  CASE WHEN s.health_status IN ('failed', 'stale')
    THEN coalesce(s.q_error, s.log_error, s.cron_error)
  END
FROM scored s
ORDER BY s.job_name;
$$;

REVOKE ALL ON FUNCTION public.get_cron_job_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cron_job_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_job_health() TO service_role;
