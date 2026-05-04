-- ─────────────────────────────────────────────────────────────────────────────
-- Observability System — Schema Upgrades + Metrics Views
-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1 : api_call_logs schema upgrades
-- SECTION 2 : edge_function_errors table
-- SECTION 3 : Metrics views (leave, notification, cron)
-- SECTION 4 : Archival infrastructure
-- SECTION 5 : Health check RPC
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 — api_call_logs schema upgrades
-- ═══════════════════════════════════════════════════════════════════════════

-- Add missing columns for richer observability
ALTER TABLE public.api_call_logs
  ADD COLUMN IF NOT EXISTS log_level     TEXT NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS user_id       UUID,
  ADD COLUMN IF NOT EXISTS error_stack   TEXT,
  ADD COLUMN IF NOT EXISTS metadata      JSONB DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS trace_id      TEXT;

-- Constrain log levels
ALTER TABLE public.api_call_logs
  DROP CONSTRAINT IF EXISTS api_call_logs_log_level_check;
ALTER TABLE public.api_call_logs
  ADD CONSTRAINT api_call_logs_log_level_check
  CHECK (log_level IN ('debug', 'info', 'warn', 'error', 'fatal'));

-- Index: filter by log_level for error monitoring dashboards
CREATE INDEX IF NOT EXISTS idx_api_call_logs_level_created
  ON public.api_call_logs(log_level, created_at DESC)
  WHERE log_level IN ('error', 'fatal');

-- Index: per-user log trail
CREATE INDEX IF NOT EXISTS idx_api_call_logs_user
  ON public.api_call_logs(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Index: trace correlation
CREATE INDEX IF NOT EXISTS idx_api_call_logs_trace
  ON public.api_call_logs(trace_id)
  WHERE trace_id IS NOT NULL;

-- Allow admin read (existing policy only allows authenticated SELECT)
-- Add admin-level email_logs read policy for the dashboard
DROP POLICY IF EXISTS "Admin read email_logs" ON public.email_logs;
CREATE POLICY "Admin read email_logs" ON public.email_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('admin', 'supervisor')
        AND approved = true
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — edge_function_errors: structured error capture
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE:
--   Captures unhandled errors and structured error reports from edge functions.
--   Designed for a Sentry-like drill-down: group by fingerprint, track frequency.
--
--   Unlike api_call_logs (1 row per invocation), this table is for ERRORS ONLY,
--   with enough detail for debugging (stack trace, request context, environment).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.edge_function_errors (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name   TEXT        NOT NULL,
  error_message   TEXT        NOT NULL,
  error_stack     TEXT,
  -- Fingerprint: deterministic hash for grouping identical errors
  -- Computed as: function_name + first line of stack (or error_message)
  fingerprint     TEXT        NOT NULL,
  severity        TEXT        NOT NULL DEFAULT 'error'
                    CHECK (severity IN ('warn', 'error', 'fatal')),
  -- Context
  user_id         UUID,
  request_method  TEXT,
  request_path    TEXT,
  request_body    JSONB,      -- sanitized (no PII)
  -- Environment
  trace_id        TEXT,
  environment     TEXT        NOT NULL DEFAULT 'production',
  -- Metadata
  metadata        JSONB       DEFAULT '{}'::JSONB,
  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Was this error acknowledged / resolved by an admin?
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID
);

ALTER TABLE public.edge_function_errors ENABLE ROW LEVEL SECURITY;

-- Only admins can view errors
CREATE POLICY "Admin read edge_function_errors" ON public.edge_function_errors
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role = 'admin'
        AND approved = true
    )
  );

-- Service role can write
CREATE POLICY "Service role write edge_function_errors" ON public.edge_function_errors
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_efe_fingerprint
  ON public.edge_function_errors(fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_efe_function_created
  ON public.edge_function_errors(function_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_efe_severity_unresolved
  ON public.edge_function_errors(severity, created_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_efe_trace
  ON public.edge_function_errors(trace_id)
  WHERE trace_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 — METRICS VIEWS
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 3a. Leave approval time metrics ─────────────────────────────────────────
-- Shows average, median, p95 approval times per leave type per month.
-- Query: SELECT * FROM v_leave_approval_metrics WHERE month >= now() - interval '6 months'

CREATE OR REPLACE VIEW public.v_leave_approval_metrics AS
SELECT
  DATE_TRUNC('month', applied_at)::DATE          AS month,
  leave_type,
  COUNT(*)                                        AS total_requests,
  COUNT(*) FILTER (WHERE status = 'Approved')     AS approved,
  COUNT(*) FILTER (WHERE status = 'Rejected')     AS rejected,
  COUNT(*) FILTER (WHERE status = 'Cancelled')    AS cancelled,
  COUNT(*) FILTER (WHERE status IN ('Pending WSO', 'Pending Supervisor')) AS pending,
  -- Average WSO approval time (hours)
  ROUND(AVG(
    EXTRACT(EPOCH FROM (wso_approved_at - applied_at)) / 3600
  ) FILTER (WHERE wso_approved_at IS NOT NULL), 1) AS avg_wso_hours,
  -- Average supervisor approval time (hours from WSO → supervisor)
  ROUND(AVG(
    EXTRACT(EPOCH FROM (supervisor_approved_at - wso_approved_at)) / 3600
  ) FILTER (WHERE supervisor_approved_at IS NOT NULL), 1) AS avg_supervisor_hours,
  -- Total end-to-end time (hours from application → final approval)
  ROUND(AVG(
    EXTRACT(EPOCH FROM (supervisor_approved_at - applied_at)) / 3600
  ) FILTER (WHERE supervisor_approved_at IS NOT NULL), 1) AS avg_total_hours,
  -- P95 end-to-end time
  ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (supervisor_approved_at - applied_at)) / 3600
  ) FILTER (WHERE supervisor_approved_at IS NOT NULL))::NUMERIC, 1) AS p95_total_hours
FROM public.leave_requests
GROUP BY 1, 2;

-- ── 3b. Notification delivery metrics ───────────────────────────────────────
-- Shows success rate, failure rate, provider breakdown per day.

CREATE OR REPLACE VIEW public.v_notification_metrics AS
SELECT
  DATE_TRUNC('day', created_at)::DATE   AS day,
  channel,
  event_type,
  COUNT(*)                               AS total,
  COUNT(*) FILTER (WHERE status = 'sent')         AS sent,
  COUNT(*) FILTER (WHERE status = 'failed')       AS failed,
  COUNT(*) FILTER (WHERE status = 'dead_letter')  AS dead_letter,
  COUNT(*) FILTER (WHERE status = 'pending')      AS pending,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'sent') / NULLIF(COUNT(*), 0),
    1
  ) AS success_rate_pct,
  AVG(attempts) FILTER (WHERE status = 'sent')    AS avg_attempts_to_send
FROM public.notification_queue
GROUP BY 1, 2, 3;

-- ── 3c. Cron job success metrics ────────────────────────────────────────────
-- Shows success/error rates per job per day, with average duration.

CREATE OR REPLACE VIEW public.v_cron_job_metrics AS
SELECT
  DATE_TRUNC('day', created_at)::DATE   AS day,
  COALESCE(job_name, endpoint)          AS job_identifier,
  COUNT(*)                               AS total_runs,
  COUNT(*) FILTER (WHERE status = 'success')     AS successes,
  COUNT(*) FILTER (WHERE status = 'error')       AS failures,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'success') / NULLIF(COUNT(*), 0),
    1
  ) AS success_rate_pct,
  ROUND(AVG(duration_ms), 0)             AS avg_duration_ms,
  MAX(duration_ms)                        AS max_duration_ms,
  SUM(COALESCE(records_affected, 0))     AS total_records_affected
FROM public.api_call_logs
WHERE job_name IS NOT NULL OR endpoint LIKE '/functions/%'
GROUP BY 1, 2;

-- ── 3d. Email provider metrics ──────────────────────────────────────────────
-- Provider reliability comparison.

CREATE OR REPLACE VIEW public.v_email_provider_metrics AS
SELECT
  DATE_TRUNC('day', created_at)::DATE   AS day,
  provider,
  COUNT(*)                               AS total,
  COUNT(*) FILTER (WHERE status = 'sent')    AS sent,
  COUNT(*) FILTER (WHERE status = 'failed')  AS failed,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status = 'sent') / NULLIF(COUNT(*), 0),
    1
  ) AS success_rate_pct
FROM public.email_logs
GROUP BY 1, 2;

-- ── 3e. Error frequency view ────────────────────────────────────────────────
-- Groups errors by fingerprint for Sentry-like issue tracking.

CREATE OR REPLACE VIEW public.v_error_frequency AS
SELECT
  fingerprint,
  function_name,
  error_message,
  severity,
  COUNT(*)                                    AS occurrences,
  MIN(created_at)                             AS first_seen,
  MAX(created_at)                             AS last_seen,
  COUNT(*) FILTER (WHERE resolved_at IS NULL) AS unresolved,
  -- Frequency: occurrences in last 24h
  COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS last_24h
FROM public.edge_function_errors
GROUP BY 1, 2, 3, 4;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4 — ARCHIVAL: notification_queue cleanup
-- ═══════════════════════════════════════════════════════════════════════════
-- Move completed/dead-letter notifications older than 90 days to archive.
-- Run weekly via pg_cron.

CREATE TABLE IF NOT EXISTS public.notification_queue_archive (
  LIKE public.notification_queue INCLUDING ALL
);

ALTER TABLE public.notification_queue_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages archive" ON public.notification_queue_archive
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin read archive" ON public.notification_queue_archive
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role = 'admin'
        AND approved = true
    )
  );

-- Archive function: moves old completed rows out of hot queue
CREATE OR REPLACE FUNCTION public.archive_old_notifications(retention_days INT DEFAULT 90)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_archived INT;
BEGIN
  WITH moved AS (
    DELETE FROM public.notification_queue
    WHERE status IN ('sent', 'dead_letter')
      AND created_at < now() - (retention_days || ' days')::INTERVAL
    RETURNING *
  )
  INSERT INTO public.notification_queue_archive
  SELECT * FROM moved;

  GET DIAGNOSTICS v_archived = ROW_COUNT;

  RETURN jsonb_build_object(
    'archived', v_archived,
    'cutoff_date', (now() - (retention_days || ' days')::INTERVAL)::TEXT
  );
END;
$$;

-- Archive old api_call_logs too (keep 180 days in hot table)
CREATE TABLE IF NOT EXISTS public.api_call_logs_archive (
  LIKE public.api_call_logs INCLUDING ALL
);

ALTER TABLE public.api_call_logs_archive ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages log archive" ON public.api_call_logs_archive
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin read log archive" ON public.api_call_logs_archive
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE OR REPLACE FUNCTION public.archive_old_api_logs(retention_days INT DEFAULT 180)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_archived INT;
BEGIN
  WITH moved AS (
    DELETE FROM public.api_call_logs
    WHERE created_at < now() - (retention_days || ' days')::INTERVAL
    RETURNING *
  )
  INSERT INTO public.api_call_logs_archive
  SELECT * FROM moved;

  GET DIAGNOSTICS v_archived = ROW_COUNT;

  RETURN jsonb_build_object('archived', v_archived);
END;
$$;

-- Register weekly archival cron (Sunday 04:00 UTC = 09:30 IST)
SELECT cron.schedule(
  'archive-old-logs',
  '0 4 * * 0',
  $$SELECT public.archive_old_notifications(90);$$
);

SELECT cron.schedule(
  'archive-old-api-logs',
  '10 4 * * 0',
  $$SELECT public.archive_old_api_logs(180);$$
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Health Check RPC
-- ═══════════════════════════════════════════════════════════════════════════
-- Single RPC that returns system health at a glance.
-- Used by admin dashboard and external uptime monitor.

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

    -- Cron health: last run of each scheduled job
    'cron_jobs', (
      SELECT jsonb_agg(jsonb_build_object(
        'job', job_name,
        'last_run', last_run_at,
        'status', last_run_status,
        'stale', (last_run_at < now() - interval '25 hours')
      ))
      FROM public.sync_jobs
      WHERE is_active = true
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
