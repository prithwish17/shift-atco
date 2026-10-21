-- ─────────────────────────────────────────────────────────────────────────────
-- Disk IO plan — Phase 1 (see DISK_IO_MITIGATION_PLAN.md)
--
-- Supabase Dashboard → SQL Editor. Run ONE step at a time (select it, then Run):
-- VACUUM cannot run in the same request as other statements.
--
-- When: any time except 12:30–12:45 and 17:45–18:00 UTC, when the leave syncs
-- run (12:35 and 17:50 UTC). Step 3 must not run while a sync is staging.
-- ─────────────────────────────────────────────────────────────────────────────


-- ── Step 1 — Is the 2026-10-17 leave fix live? (read-only) ──────────────────

-- 1a. Both should be true. If either is false, stop and see Step 1-fix below.
SELECT
  (SELECT position('ANALYZE public.leave_sheet_sync_staging' IN prosrc) > 0
     FROM pg_proc WHERE proname = 'commit_leave_sheet_sync')   AS commit_fix_applied,
  (SELECT position('15 minutes' IN prosrc) > 0
     FROM pg_proc WHERE proname = 'prune_leave_sheet_staging') AS prune_fix_applied;

-- 1b. Have commits succeeded since the fix? Expect 'committed' rows after 10-17.
SELECT started_at, status, rows_staged, inserted, updated, left(error, 100) AS error
FROM   public.leave_sheet_sync_runs
WHERE  started_at > '2026-10-14'
ORDER  BY started_at DESC
LIMIT  20;

-- 1c. Which October migrations are recorded as applied (only if they were
--     applied with `supabase db push`; SQL-Editor pastes are not recorded).
SELECT version
FROM   supabase_migrations.schema_migrations
WHERE  version >= '20261001'
ORDER  BY version;

-- Step 1-fix (only if 1a is false) — from a machine with the Supabase CLI:
--   supabase migration list          -- see exactly what is pending first
--   supabase db push                 -- applies EVERY pending migration, which
--                                    -- may include 20261005*, 20261017100000 and
--                                    -- 20261017200000_feedback_items.sql
--   supabase functions deploy fetch-leave-data
-- Also check Dashboard → Edge Functions → fetch-leave-data: its last deploy
-- should be 2026-10-17 or later.


-- ── Step 2 — Before measurements (read-only) ─────────────────────────────────

-- 2a. Size now. Note the numbers to compare after Step 3.
SELECT count(*) AS staged_rows,
       pg_size_pretty(pg_total_relation_size('public.leave_sheet_sync_staging')) AS staging_on_disk,
       pg_size_pretty(pg_database_size(current_database()))                       AS db_size
FROM   public.leave_sheet_sync_staging;

-- 2b. Must be 0 before Step 3: no sync in progress.
SELECT count(*) AS runs_staging_now
FROM   public.leave_sheet_sync_runs
WHERE  status = 'staging';


-- ── Step 3 — Compact the staging table, only if 2a shows it still large ─────
-- If the 2026-10-17 migration ran, it TRUNCATEd staging and re-inserted the
-- rows it keeps, which already freed the 171 MB: if 2a shows a few MB, skip
-- this. Otherwise run this statement ON ITS OWN (brief exclusive lock).

VACUUM (FULL, ANALYZE) public.leave_sheet_sync_staging;


-- ── Step 4 — After (read-only) ───────────────────────────────────────────────
-- If you ran Step 3, re-run 2a: staging_on_disk should now be a few MB.


-- ── Step 5 — Other bloated tables (read-only; compact any that stand out) ───
-- A table with dead_pct well above ~20% and more than a few MB on disk is a
-- candidate for the same VACUUM (FULL, ANALYZE), one table per run, off-window.
-- Do NOT VACUUM FULL employee_schedules or rosters during the day: pages read
-- them constantly and the lock would block those pages while it runs.

SELECT schemaname, relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS on_disk,
       n_live_tup, n_dead_tup,
       round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
       last_autovacuum
FROM   pg_stat_all_tables
WHERE  schemaname IN ('public', 'cron', 'net')
ORDER  BY pg_total_relation_size(relid) DESC
LIMIT  15;


-- ── Step 6 — Are the cleanup jobs succeeding? (read-only) ────────────────────

SELECT j.jobname, d.status, left(d.return_message, 120) AS return_message, d.start_time
FROM   cron.job_run_details d
JOIN   cron.job j USING (jobid)
WHERE  j.jobname IN ('purge-cron-history', 'compact-bg-tables', 'purge-old-data', 'compact-log-tables')
ORDER  BY d.start_time DESC
LIMIT  20;

-- Expect oldest_run within ~2 days. Older means purge-cron-history is failing.
SELECT min(start_time) AS oldest_run, count(*) AS rows,
       pg_size_pretty(pg_total_relation_size('cron.job_run_details')) AS on_disk
FROM   cron.job_run_details;

-- Step 6-fix (only if the purge is failing) — run each statement on its own:
--   DELETE FROM cron.job_run_details WHERE end_time < now() - interval '2 days';
--   VACUUM (FULL, ANALYZE) cron.job_run_details;
--   VACUUM (FULL, ANALYZE) net._http_response;
-- and bring me the return_message from the first query above so the job itself
-- can be fixed.
