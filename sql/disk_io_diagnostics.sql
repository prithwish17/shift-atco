-- ─────────────────────────────────────────────────────────────────────────────
-- Disk IO diagnostics — run in Supabase Dashboard → SQL Editor, one block at a
-- time. Read-only except the pg_stat_statements reset at the very end.
-- See DISK_IO_MITIGATION_PLAN.md for what each result means.
-- All times in cron.* and api_call_logs are UTC.
-- ─────────────────────────────────────────────────────────────────────────────


-- 0. The instance: how much fits in RAM, and how big the DB is
SELECT version();
SHOW shared_buffers;
SHOW work_mem;
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;


-- 1. Database-wide cache hit ratio and temp-file spills since the last reset.
--    hit_pct under ~99% on a 0.5 GB instance means reads are going to disk.
--    temp_bytes is query sorts/hashes spilling past work_mem — written to disk.
SELECT blks_read, blks_hit,
       round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS hit_pct,
       temp_files, pg_size_pretty(temp_bytes) AS temp_written,
       xact_commit, stats_reset
FROM   pg_stat_database
WHERE  datname = current_database();


-- 2. Top statements by blocks read from disk (not found in shared_buffers).
SELECT round(100.0 * s.shared_blks_read / NULLIF(sum(s.shared_blks_read) OVER (), 0), 1) AS pct_of_reads,
       s.shared_blks_read, s.shared_blks_hit, s.temp_blks_written,
       s.calls, round(s.total_exec_time::numeric) AS total_ms, r.rolname,
       left(regexp_replace(s.query, '\s+', ' ', 'g'), 180) AS query
FROM   extensions.pg_stat_statements s
JOIN   pg_roles r ON r.oid = s.userid
ORDER  BY s.shared_blks_read DESC
LIMIT  25;


-- 3. Top statements by blocks written (dirtied pages + temp spills).
SELECT s.shared_blks_dirtied, s.shared_blks_written, s.temp_blks_written,
       s.calls, round(s.total_exec_time::numeric) AS total_ms, r.rolname,
       left(regexp_replace(s.query, '\s+', ' ', 'g'), 180) AS query
FROM   extensions.pg_stat_statements s
JOIN   pg_roles r ON r.oid = s.userid
ORDER  BY s.shared_blks_dirtied + s.shared_blks_written + s.temp_blks_written DESC
LIMIT  25;


-- 4. Which tables are read from disk (heap + index + TOAST), incl. cron/net.
SELECT schemaname, relname,
       heap_blks_read, idx_blks_read, coalesce(toast_blks_read, 0) AS toast_blks_read,
       round(100.0 * heap_blks_hit / NULLIF(heap_blks_hit + heap_blks_read, 0), 1) AS heap_hit_pct
FROM   pg_statio_all_tables
WHERE  schemaname IN ('public', 'cron', 'net', 'auth', 'storage')
ORDER  BY heap_blks_read + idx_blks_read + coalesce(toast_blks_read, 0) DESC
LIMIT  20;


-- 5. Write churn per table. High n_tup_upd with low n_tup_hot_upd = every
--    update also writes every index.
SELECT schemaname, relname, n_tup_ins, n_tup_upd, n_tup_hot_upd, n_tup_del,
       n_live_tup, n_dead_tup, seq_scan, seq_tup_read, idx_scan,
       last_autovacuum, last_autoanalyze
FROM   pg_stat_all_tables
WHERE  schemaname IN ('public', 'cron', 'net')
ORDER  BY n_tup_ins + n_tup_upd + n_tup_del DESC
LIMIT  20;


-- 6. Biggest tables, incl. pg_cron / pg_net / auth / storage.
SELECT n.nspname, c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_relation_size(c.oid))       AS heap,
       pg_size_pretty(pg_indexes_size(c.oid))        AS indexes
FROM   pg_class c
JOIN   pg_namespace n ON n.oid = c.relnamespace
WHERE  c.relkind = 'r'
  AND  n.nspname IN ('public', 'cron', 'net', 'auth', 'storage')
ORDER  BY pg_total_relation_size(c.oid) DESC
LIMIT  25;


-- 7. Indexes on the hot tables: size and whether anything uses them.
SELECT relname, indexrelname,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size,
       idx_scan
FROM   pg_stat_user_indexes
WHERE  relname IN ('employee_schedules', 'rosters', 'api_call_logs',
                   'working_hours_cache', 'leave_sheet_sync_staging',
                   'employee_leave_records', 'notifications')
ORDER  BY relname, pg_relation_size(indexrelid) DESC;


-- 8. Checkpoints. checkpoints_req >> checkpoints_timed means WAL volume (bulk
--    writes) is forcing checkpoints. PG17 moved these to pg_stat_checkpointer.
SELECT * FROM pg_stat_bgwriter;
-- SELECT * FROM pg_stat_checkpointer;   -- PG17+


-- 9. Background firings per job in the last 24h.
SELECT j.jobname, j.schedule, count(*) AS runs_24h,
       count(*) FILTER (WHERE d.status = 'failed') AS failed_24h
FROM   cron.job_run_details d
JOIN   cron.job j USING (jobid)
WHERE  d.start_time > now() - interval '24 hours'
GROUP  BY j.jobname, j.schedule
ORDER  BY runs_24h DESC;


-- 10. Are the cleanup jobs actually succeeding?
SELECT j.jobname, d.status, left(d.return_message, 120) AS return_message, d.start_time
FROM   cron.job_run_details d
JOIN   cron.job j USING (jobid)
WHERE  j.jobname IN ('purge-cron-history', 'compact-bg-tables', 'purge-old-data', 'compact-log-tables')
ORDER  BY d.start_time DESC
LIMIT  20;

-- purge-cron-history keeps 2 days; an older min(start_time) means it is failing.
SELECT min(start_time) AS oldest_run, count(*) AS rows FROM cron.job_run_details;
SELECT count(*) AS rows, pg_size_pretty(pg_total_relation_size('net._http_response')) AS size
FROM   net._http_response;


-- 11. Is the 2026-10-17 leave sync fix live, and how much staging is left?
SELECT position('ANALYZE public.leave_sheet_sync_staging' IN prosrc) > 0 AS commit_fix_applied
FROM   pg_proc
WHERE  proname = 'commit_leave_sheet_sync';

SELECT status, count(*) AS runs, min(started_at), max(started_at)
FROM   public.leave_sheet_sync_runs
WHERE  started_at > now() - interval '14 days'
GROUP  BY status;

SELECT count(*) AS staged_rows,
       pg_size_pretty(pg_total_relation_size('public.leave_sheet_sync_staging')) AS on_disk
FROM   public.leave_sheet_sync_staging;


-- 12. How much each sync really changes, per run.
SELECT created_at, coalesce(job_name, endpoint) AS job, status, records_affected,
       duration_ms, left(message, 140) AS message
FROM   public.api_call_logs
WHERE  created_at > now() - interval '3 days'
  AND  (endpoint IN ('fetch-schedule', 'fetch-leave-data')
        OR job_name LIKE 'working-hours%'
        OR job_name LIKE 'roster-%'
        OR job_name LIKE '%-sync-daily')
ORDER  BY created_at DESC
LIMIT  80;


-- 13. Archive re-insert check. The monthly archiver keeps current + previous
--     month. If min(duty_date) is older than the 1st of last month, the
--     schedule feed is putting archived months back on every sync.
SELECT min(duty_date), max(duty_date), count(*) FROM public.employee_schedules;

-- rosters has no retention at all: how far back does it go?
SELECT min(date), max(date), count(*) FROM public.rosters;


-- 14. How many log rows are idle-poller noise.
SELECT coalesce(job_name, endpoint) AS job,
       count(*) FILTER (WHERE message ILIKE 'No pending jobs%') AS idle_rows,
       count(*) AS total_rows
FROM   public.api_call_logs
WHERE  created_at > now() - interval '7 days'
GROUP  BY 1
ORDER  BY total_rows DESC
LIMIT  15;


-- 15. Start a clean 24h measurement window. Run this last, then re-run
--     blocks 1-5 tomorrow to get per-day numbers.
-- SELECT extensions.pg_stat_statements_reset();
-- SELECT pg_stat_reset();
