-- ─────────────────────────────────────────────────────────────────────────────
-- Keep pg_cron / pg_net background tables small (the real free-tier space hogs)
-- ─────────────────────────────────────────────────────────────────────────────
-- cron.job_run_details (pg_cron's per-run audit log) and net._http_response
-- (pg_net's cached HTTP responses) grow unbounded and are never read by the app.
-- Left alone they reached ~140 MB and ~167 MB respectively. This adds:
--   • purge-cron-history  — daily delete of cron run-history older than 2 days
--   • compact-bg-tables   — weekly VACUUM FULL to return the freed space to disk
--
-- Safe: nothing in the app reads either table; cron.job (the schedules) is not
-- touched. Idempotent.
--
-- NOTE: a one-time reclaim must be run by hand once (cron/net tables can't be
-- compacted by autovacuum). Run as separate statements in the SQL Editor:
--   DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';
--   VACUUM (FULL, ANALYZE) cron.job_run_details;
--   VACUUM (FULL, ANALYZE) net._http_response;
-- ─────────────────────────────────────────────────────────────────────────────

-- Daily: trim pg_cron run history (03:15 UTC = 08:45 IST)
DO $$
BEGIN PERFORM cron.unschedule('purge-cron-history'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'purge-cron-history',
  '15 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';$$
);

-- Weekly: compact the two background tables so the freed space returns to disk
-- (Sun 03:40 UTC). VACUUM FULL takes a brief exclusive lock; these tables stay
-- tiny thanks to the daily purge + pg_net's own TTL, so the lock is sub-second.
-- If the cron role ever lacks privileges to VACUUM these schemas, the job simply
-- errors in job_run_details and the app is unaffected.
DO $$
BEGIN PERFORM cron.unschedule('compact-bg-tables'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'compact-bg-tables',
  '40 3 * * 0',
  $$VACUUM (FULL) cron.job_run_details;
    VACUUM (FULL) net._http_response;$$
);

-- Verify:
--   SELECT jobname, schedule FROM cron.job
--   WHERE jobname IN ('purge-cron-history','compact-bg-tables');
