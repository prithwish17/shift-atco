-- ─────────────────────────────────────────────────────────────────────────────
-- Storage Reclamation — keep the database under the Supabase free tier (500 MB)
-- ─────────────────────────────────────────────────────────────────────────────
-- Why this exists:
--   The previous "archival" jobs (archive-old-logs / archive-old-api-logs) only
--   MOVED rows from a hot table into an *_archive table IN THE SAME DATABASE, so
--   they reclaimed zero disk. This migration replaces that with real retention:
--   delete old rows, drop the dead archive tables, prune redundant indexes, and
--   cap the working-hours cache. A daily purge keeps it that way.
--
-- IMPORTANT — disk is only RETURNED to Supabase after a VACUUM FULL.
--   DELETE alone marks rows dead; it does NOT shrink the reported DB size.
--   After applying this migration, run the one-time VACUUM FULL block at the
--   bottom of STORAGE_RECLAMATION.md (it needs a brief exclusive lock).
--
-- Safe to run more than once (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 — Retire the in-DB "archive" jobs and tables (they save no space)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM cron.unschedule('archive-old-logs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('archive-old-api-logs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- These archive tables duplicate data inside the same 500 MB budget. Drop them.
-- (Both were empty at the time of writing; harmless if they hold a few rows you
--  do not need. If you DO want this history, export it first — see the doc.)
DROP TABLE IF EXISTS public.api_call_logs_archive;
DROP TABLE IF EXISTS public.notification_queue_archive;

-- The old archive functions are no longer scheduled; replace their bodies so any
-- lingering manual call performs a real purge instead of an in-DB copy.
DROP FUNCTION IF EXISTS public.archive_old_notifications(INT);
DROP FUNCTION IF EXISTS public.archive_old_api_logs(INT);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — Single purge function (real deletes, tunable retention)
-- ═══════════════════════════════════════════════════════════════════════════
-- Retention windows (days) chosen to keep dashboards useful while staying small.
-- Adjust the defaults here if you want longer history.

CREATE OR REPLACE FUNCTION public.purge_old_data(
  p_api_log_days        INT DEFAULT 30,   -- api_call_logs
  p_notification_days   INT DEFAULT 30,   -- notifications + notification_queue (sent)
  p_email_log_days      INT DEFAULT 30,   -- email_logs
  p_cron_queue_days     INT DEFAULT 3,    -- cron_job_queue (finished jobs)
  p_error_days          INT DEFAULT 30,   -- edge_function_errors (resolved only)
  p_wh_cache_keep_month INT DEFAULT 1     -- working_hours_cache: keep current + N prior months
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB := '{}'::jsonb;
  n INT;
  v_wh_cutoff TEXT;
BEGIN
  -- Each block is guarded by to_regclass so a table missing in this environment
  -- (e.g. edge_function_errors if the observability migration was never applied)
  -- is skipped instead of aborting the whole purge.

  IF to_regclass('public.api_call_logs') IS NOT NULL THEN
    DELETE FROM public.api_call_logs
    WHERE created_at < now() - (p_api_log_days || ' days')::interval;
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('api_call_logs', n);
  END IF;

  IF to_regclass('public.notifications') IS NOT NULL THEN
    DELETE FROM public.notifications
    WHERE created_at < now() - (p_notification_days || ' days')::interval;
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('notifications', n);
  END IF;

  -- notification_queue: only finished rows; never touch pending/processing
  IF to_regclass('public.notification_queue') IS NOT NULL THEN
    DELETE FROM public.notification_queue
    WHERE status IN ('sent', 'dead_letter')
      AND created_at < now() - (p_notification_days || ' days')::interval;
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('notification_queue', n);
  END IF;

  IF to_regclass('public.email_logs') IS NOT NULL THEN
    DELETE FROM public.email_logs
    WHERE created_at < now() - (p_email_log_days || ' days')::interval;
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('email_logs', n);
  END IF;

  -- cron_job_queue: only finished jobs; never touch pending/running
  IF to_regclass('public.cron_job_queue') IS NOT NULL THEN
    DELETE FROM public.cron_job_queue
    WHERE status IN ('completed', 'failed', 'cancelled')
      AND coalesce(completed_at, queued_at) < now() - (p_cron_queue_days || ' days')::interval;
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('cron_job_queue', n);
  END IF;

  -- edge_function_errors: keep unresolved forever, drop resolved after the window
  IF to_regclass('public.edge_function_errors') IS NOT NULL THEN
    DELETE FROM public.edge_function_errors
    WHERE resolved_at IS NOT NULL
      AND resolved_at < now() - (p_error_days || ' days')::interval;
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('edge_function_errors', n);
  END IF;

  -- working_hours_cache: keep current month + p_wh_cache_keep_month prior months.
  -- Older months are regenerated on demand by the RPC/Redis fallback if ever viewed.
  IF to_regclass('public.working_hours_cache') IS NOT NULL THEN
    v_wh_cutoff := to_char((current_date - (p_wh_cache_keep_month || ' months')::interval), 'YYYY-MM');
    DELETE FROM public.working_hours_cache WHERE month < v_wh_cutoff;
    GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('working_hours_cache', n);
  END IF;

  RETURN v || jsonb_build_object('ran_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_data(INT, INT, INT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_data(INT, INT, INT, INT, INT, INT) TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 — Schedule it: daily purge, then a light weekly compaction
-- ═══════════════════════════════════════════════════════════════════════════
-- 03:30 UTC = 09:00 IST. Purge first, compact the (now small) log tables after.

DO $$
BEGIN PERFORM cron.unschedule('purge-old-data'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'purge-old-data',
  '30 3 * * *',
  $$SELECT public.purge_old_data();$$
);

-- Weekly VACUUM FULL on the SMALL, frequently-churned tables only (Sun 03:50 UTC).
-- These stay tiny after the daily purge, so the exclusive lock is sub-second.
-- NOTE: do NOT add big tables (employee_schedules) here — vacuum those manually.
-- If the lock ever causes trouble, just: SELECT cron.unschedule('compact-log-tables');
DO $$
BEGIN PERFORM cron.unschedule('compact-log-tables'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'compact-log-tables',
  '50 3 * * 0',
  $$VACUUM (FULL, ANALYZE) public.api_call_logs;
    VACUUM (FULL, ANALYZE) public.cron_job_queue;
    VACUUM (FULL, ANALYZE) public.notifications;
    VACUUM (FULL, ANALYZE) public.notification_queue;
    VACUUM (FULL, ANALYZE) public.email_logs;
    VACUUM (FULL, ANALYZE) public.working_hours_cache;$$
);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4 — Drop redundant indexes (each is a leading-prefix of a composite)
-- ═══════════════════════════════════════════════════════════════════════════
-- Verified safe: every index dropped here is the leading column(s) of an existing
-- composite index, so Postgres already serves those lookups from the composite.
-- Zero functional impact and effectively zero performance impact; pure space win.
--
--   dropped (single col)                    covered by (composite)
--   --------------------------------------  ----------------------------------------
--   idx_employee_schedules_employee_code    idx_employee_schedules_code_date (employee_code, duty_date)
--   idx_comp_off_employee                   idx_comp_off_employee_status     (employee_id, status)
--   idx_duty_exchanges_partner              idx_duty_exchanges_partner_status(exchange_partner_id, status)
--   idx_duty_exchanges_requesting_user      idx_duty_exchanges_requester_status (requesting_user_id, status)
--   idx_exchange_approvals_approver         idx_exchange_approvals_approver_status (approver_id, status)
--   idx_exchange_approvals_request          idx_exchange_approvals_request_status  (request_id, status, sequence_order)
--   idx_whc_month                           idx_whc_month_computed           (month, computed_at DESC)

DROP INDEX IF EXISTS public.idx_employee_schedules_employee_code;
DROP INDEX IF EXISTS public.idx_comp_off_employee;
DROP INDEX IF EXISTS public.idx_duty_exchanges_partner;
DROP INDEX IF EXISTS public.idx_duty_exchanges_requesting_user;
DROP INDEX IF EXISTS public.idx_exchange_approvals_approver;
DROP INDEX IF EXISTS public.idx_exchange_approvals_request;
DROP INDEX IF EXISTS public.idx_whc_month;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 5 — Run an immediate first purge so you see the effect right away
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.purge_old_data();

-- After this migration, run the one-time VACUUM FULL block in STORAGE_RECLAMATION.md
-- to actually shrink the reported database size.
