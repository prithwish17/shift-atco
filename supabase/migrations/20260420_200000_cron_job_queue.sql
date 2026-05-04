-- ─────────────────────────────────────────────────────────────────────────────
-- Cron Job Queue System
--
-- Introduces a queue table so that all scheduled cron jobs enqueue work
-- rather than calling edge functions directly. A single queue-processor
-- edge function drains the queue one job at a time, guaranteeing:
--   • No two cron jobs run concurrently (prevents Google Apps Script conflicts)
--   • Failed jobs are recorded with full error messages
--   • Stale/zombie jobs are auto-recovered after 5 minutes
--   • Admin UI can show live queue depth and run history
--
-- Architecture:
--   pg_cron (every min)  → process-cron-queue edge function (direct HTTP)
--   pg_cron (other jobs) → INSERT INTO cron_job_queue (no HTTP, no key needed)
--   process-cron-queue   → claims one pending job → calls target edge function
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Create queue table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cron_job_queue (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name           text        NOT NULL,
  edge_function_name text        NOT NULL,
  payload            jsonb       NOT NULL DEFAULT '{}',
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  priority           integer     NOT NULL DEFAULT 0,  -- higher = processed first
  queued_at          timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  error_message      text,
  triggered_by       text        NOT NULL DEFAULT 'cron_job',
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Index for queue drain: status + priority DESC + queued_at ASC (FIFO within priority)
CREATE INDEX IF NOT EXISTS idx_cron_job_queue_pending
  ON public.cron_job_queue (status, priority DESC, queued_at ASC)
  WHERE status = 'pending';

-- Index for admin history view
CREATE INDEX IF NOT EXISTS idx_cron_job_queue_created
  ON public.cron_job_queue (created_at DESC);

-- ── 2. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.cron_job_queue ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY "Service role full access"
  ON public.cron_job_queue FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── 3. claim_next_queue_job() — atomic single-job claim ──────────────────────
--
-- Uses SELECT … FOR UPDATE SKIP LOCKED, the standard PostgreSQL queue pattern.
-- Only one caller wins per invocation; concurrent processors skip the same row.

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

-- ── 4. cleanup_stale_queue_jobs() — recover zombie running jobs ────────────────

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

-- ── 5. Register process-cron-queue pg_cron job ───────────────────────────────
--
-- This is the ONLY cron job that still uses a direct HTTP call.
-- All other jobs enqueue work via INSERT INTO cron_job_queue instead.

DO $$
DECLARE
  base text := coalesce(
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'https://ilkrqlxrqaelflslbdnx.supabase.co'
  ) || '/functions/v1';
BEGIN
  -- Unschedule existing if present
  BEGIN PERFORM cron.unschedule('process-cron-queue'); EXCEPTION WHEN OTHERS THEN NULL; END;

  -- Register every minute. process-cron-queue is configured with verify_jwt=false,
  -- so manual SQL execution does not need app.settings.service_role_key.
  PERFORM cron.schedule(
    'process-cron-queue',
    '* * * * *',
    format(
      $q$SELECT net.http_post(
        url                  := %L,
        headers              := jsonb_build_object('Content-Type', 'application/json'),
        body                 := '{}'::jsonb,
        timeout_milliseconds := 90000
      );$q$,
      base || '/process-cron-queue'
    )
  );

  RAISE NOTICE 'Registered process-cron-queue (every minute)';
END $$;

-- Upsert into sync_jobs so it appears in admin UI
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, is_active, payload)
VALUES ('process-cron-queue', 'process-cron-queue', '* * * * *', true, '{}')
ON CONFLICT (job_name) DO UPDATE SET
  cron_schedule = '* * * * *',
  is_active     = true,
  updated_at    = now();

-- ── 6. Switch schedule-sync and leave-sync to use the queue ──────────────────
--
-- Replace the direct net.http_post() commands from Migration 1 with simple
-- INSERT INTO cron_job_queue statements — no service_role_key required.

DO $$
DECLARE
  jobs text[][] := ARRAY[
    -- [job_name, cron_utc, edge_function, payload]
    ARRAY['schedule-sync-10h', '32 4  * * *', 'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-12h', '32 6  * * *', 'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-14h', '32 8  * * *', 'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-16h', '32 10 * * *', 'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-18h', '32 12 * * *', 'fetch-schedule',   '{}'],
    ARRAY['schedule-sync-20h', '32 14 * * *', 'fetch-schedule',   '{}'],
    ARRAY['leave-sync-10h',    '35 4  * * *', 'fetch-leave-data', '{}'],
    ARRAY['leave-sync-14h',    '35 8  * * *', 'fetch-leave-data', '{}'],
    ARRAY['leave-sync-18h',    '35 12 * * *', 'fetch-leave-data', '{}']
  ];
  j text[];
BEGIN
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    -- Unschedule the direct HTTP version from Migration 1
    BEGIN PERFORM cron.unschedule(j[1]); EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Re-register as a queue INSERT (no key required)
    PERFORM cron.schedule(
      j[1], j[2],
      format(
        $q$INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by)
        VALUES (%L, %L, %L::jsonb, 'cron_job');$q$,
        j[1], j[3], j[4]
      )
    );

    RAISE NOTICE 'Switched % to queue-based execution', j[1];
  END LOOP;
END $$;

-- ── 7. Switch roster sync jobs to queue ──────────────────────────────────────

DO $$
DECLARE
  jobs text[][] := ARRAY[
    ARRAY['roster-morning-18h',   '30 12 * * *', 'sync-roster', '{"shift":"Morning"}'],
    ARRAY['roster-morning-20h',   '30 14 * * *', 'sync-roster', '{"shift":"Morning"}'],
    ARRAY['roster-morning-21h',   '30 15 * * *', 'sync-roster', '{"shift":"Morning"}'],
    ARRAY['roster-morning-22h',   '30 16 * * *', 'sync-roster', '{"shift":"Morning"}'],
    ARRAY['roster-morning-23h',   '30 17 * * *', 'sync-roster', '{"shift":"Morning"}'],
    ARRAY['roster-morning-00h',   '30 18 * * *', 'sync-roster', '{"shift":"Morning"}'],
    ARRAY['roster-morning-01h',   '30 19 * * *', 'sync-roster', '{"shift":"Morning"}'],
    ARRAY['roster-morning-06h',   '30 00 * * *', 'sync-roster', '{"shift":"Morning"}'],
    ARRAY['roster-afternoon-08h', '30 02 * * *', 'sync-roster', '{"shift":"Afternoon"}'],
    ARRAY['roster-afternoon-09h', '30 03 * * *', 'sync-roster', '{"shift":"Afternoon"}'],
    ARRAY['roster-afternoon-10h', '30 04 * * *', 'sync-roster', '{"shift":"Afternoon"}'],
    ARRAY['roster-afternoon-11h', '30 05 * * *', 'sync-roster', '{"shift":"Afternoon"}'],
    ARRAY['roster-afternoon-12h', '30 06 * * *', 'sync-roster', '{"shift":"Afternoon"}'],
    ARRAY['roster-night-13h',     '30 07 * * *', 'sync-roster', '{"shift":"Night"}'],
    ARRAY['roster-night-14h',     '30 08 * * *', 'sync-roster', '{"shift":"Night"}'],
    ARRAY['roster-night-15h',     '30 09 * * *', 'sync-roster', '{"shift":"Night"}'],
    ARRAY['roster-night-16h',     '30 10 * * *', 'sync-roster', '{"shift":"Night"}'],
    ARRAY['roster-night-17h',     '30 11 * * *', 'sync-roster', '{"shift":"Night"}'],
    ARRAY['roster-night-19h',     '30 13 * * *', 'sync-roster', '{"shift":"Night"}'],
    ARRAY['roster-night-20h',     '30 14 * * *', 'sync-roster', '{"shift":"Night"}'],
    ARRAY['roster-night-21h',     '30 15 * * *', 'sync-roster', '{"shift":"Night"}'],
    ARRAY['roster-night-22h',     '30 16 * * *', 'sync-roster', '{"shift":"Night"}'],
    ARRAY['roster-night-23h',     '30 17 * * *', 'sync-roster', '{"shift":"Night"}']
  ];
  j text[];
BEGIN
  FOREACH j SLICE 1 IN ARRAY jobs LOOP
    BEGIN PERFORM cron.unschedule(j[1]); EXCEPTION WHEN OTHERS THEN NULL; END;

    PERFORM cron.schedule(
      j[1], j[2],
      format(
        $q$INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by)
        VALUES (%L, %L, %L::jsonb, 'cron_job');$q$,
        j[1], j[3], j[4]
      )
    );
  END LOOP;

  RAISE NOTICE 'Switched 23 roster sync jobs to queue-based execution';
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--
-- Check queue table exists:
--   SELECT * FROM cron_job_queue LIMIT 5;
--
-- Check process-cron-queue is registered (every minute, direct HTTP):
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'process-cron-queue';
--
-- Check schedule-sync jobs now use INSERT (no HTTP, no key):
--   SELECT jobname, command FROM cron.job WHERE jobname = 'schedule-sync-10h';
--   -- Should show: INSERT INTO public.cron_job_queue ...
--
-- After a cron cycle, check queue entries:
--   SELECT job_name, status, queued_at, started_at, completed_at
--   FROM cron_job_queue ORDER BY queued_at DESC LIMIT 20;
-- ─────────────────────────────────────────────────────────────────────────────
