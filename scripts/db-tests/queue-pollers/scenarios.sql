-- ─────────────────────────────────────────────────────────────────────────────
-- Scenario tests for 20261021100000_gate_queue_pollers and
-- 20261021110000_drop_duplicate_schedule_indexes.
-- Each block raises on the first failed expectation; run.sh stops there.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA t;

CREATE FUNCTION t.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_msg;
  END IF;
  RAISE NOTICE 'ok   %', p_msg;
END $$;

CREATE FUNCTION t.cmd(p_job TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT command FROM cron.job WHERE jobname = p_job
$$;

-- Run a job's command as pg_cron would and record the firing.
-- Returns how many HTTP calls the firing made.
CREATE FUNCTION t.fire(p_job TEXT) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_before BIGINT;
  v_jobid  BIGINT;
  v_cmd    TEXT;
BEGIN
  SELECT count(*) INTO v_before FROM net.calls;
  SELECT jobid, command INTO v_jobid, v_cmd FROM cron.job WHERE jobname = p_job;
  EXECUTE v_cmd;
  INSERT INTO cron.job_run_details (jobid, command, status, return_message, start_time, end_time)
  VALUES (v_jobid, v_cmd, 'succeeded', 'SELECT 1', now(), now());
  RETURN (SELECT count(*) FROM net.calls) - v_before;
END $$;

-- A pg_cron firing in the past, without running anything.
CREATE FUNCTION t.fired(p_job TEXT, p_ago INTERVAL, p_status TEXT DEFAULT 'succeeded')
RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO cron.job_run_details (jobid, status, return_message, start_time, end_time)
  SELECT jobid, p_status, CASE p_status WHEN 'failed' THEN 'ERROR: boom' ELSE 'SELECT 0' END,
         now() - p_ago, now() - p_ago
  FROM cron.job WHERE jobname = p_job
$$;

CREATE FUNCTION t.health(p_job TEXT) RETURNS TEXT LANGUAGE sql AS $$
  SELECT health_status FROM public.get_cron_job_health() WHERE job_name = p_job
$$;

CREATE FUNCTION t.reset() RETURNS VOID LANGUAGE sql AS $$
  TRUNCATE public.cron_job_queue, public.notification_queue, net.calls, cron.job_run_details;
  DELETE FROM public.app_settings;
  UPDATE public.sync_jobs SET last_run_at = NULL, last_run_status = NULL;
$$;

CREATE FUNCTION t.plan(p_sql TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  r      RECORD;
  v_plan TEXT := '';
BEGIN
  FOR r IN EXECUTE 'EXPLAIN ' || p_sql LOOP
    v_plan := v_plan || r."QUERY PLAN" || E'\n';
  END LOOP;
  RETURN v_plan;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. The rewritten commands
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_pcq TEXT := t.cmd('process-cron-queue');
  v_pnq TEXT := t.cmd('process-notification-queue');
BEGIN
  PERFORM t.ok(v_pcq ~ 'WHERE public\.cron_queue_has_due_work\(\);$',
               'process-cron-queue command ends with its guard');
  PERFORM t.ok(v_pcq ~ '^SELECT net\.http_post\(' AND v_pcq LIKE '%/functions/v1/process-cron-queue%'
               AND v_pcq LIKE '%timeout_milliseconds := 150000%',
               'process-cron-queue keeps its URL and 150s timeout');
  PERFORM t.ok(v_pnq ~ 'WHERE public\.notification_queue_has_due_work\(\);$',
               'process-notification-queue command ends with its guard');
  PERFORM t.ok(v_pnq LIKE '%''Bearer '' || ''test-service-key''%'
               AND v_pnq LIKE '%''apikey'',        ''test-service-key''%'
               AND v_pnq LIKE '%timeout_milliseconds := 60000%',
               'process-notification-queue keeps its embedded key, headers and timeout');
  PERFORM t.ok((length(v_pcq) - length(replace(v_pcq, '_has_due_work()', ''))) / length('_has_due_work()') = 1
           AND (length(v_pnq) - length(replace(v_pnq, '_has_due_work()', ''))) / length('_has_due_work()') = 1,
               'applying the migration twice adds each guard once');
  PERFORM t.ok(t.cmd('leave-sync-daily') NOT LIKE '%has_due_work%',
               'queued jobs are left alone');
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. A firing calls the processor only when there is work
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM t.reset();
  PERFORM t.ok(t.fire('process-cron-queue') = 0, 'cron queue: empty queue → no call');

  INSERT INTO public.cron_job_queue (job_name, edge_function_name) VALUES ('j', 'f');
  PERFORM t.ok(t.fire('process-cron-queue') = 1, 'cron queue: due pending job → one call');
  PERFORM t.ok((SELECT url FROM net.calls ORDER BY id DESC LIMIT 1) LIKE '%/process-cron-queue',
               'cron queue: the call goes to process-cron-queue');

  PERFORM t.reset();
  INSERT INTO public.cron_job_queue (job_name, edge_function_name, available_at)
  VALUES ('j', 'f', now() + interval '10 minutes');
  PERFORM t.ok(t.fire('process-cron-queue') = 0, 'cron queue: retry not yet due → no call');

  PERFORM t.reset();
  INSERT INTO public.cron_job_queue (job_name, edge_function_name, status, started_at)
  VALUES ('j', 'f', 'running', now() - interval '1 minute');
  PERFORM t.ok(t.fire('process-cron-queue') = 0, 'cron queue: job running normally → no call');

  PERFORM t.reset();
  INSERT INTO public.cron_job_queue (job_name, edge_function_name, status, started_at)
  VALUES ('j', 'f', 'running', now() - interval '10 minutes');
  PERFORM t.ok(t.fire('process-cron-queue') = 1, 'cron queue: zombie running job → call, so it is recovered');

  PERFORM t.reset();
  INSERT INTO public.cron_job_queue (job_name, edge_function_name, status, completed_at)
  VALUES ('j', 'f', 'completed', now()), ('j', 'f', 'failed', now()), ('j', 'f', 'cancelled', now());
  PERFORM t.ok(t.fire('process-cron-queue') = 0, 'cron queue: only finished jobs → no call');
END $$;

DO $$
BEGIN
  PERFORM t.reset();
  PERFORM t.ok(t.fire('process-notification-queue') = 0, 'notifications: empty queue → no call');

  INSERT INTO public.notification_queue (status) VALUES ('pending');
  PERFORM t.ok(t.fire('process-notification-queue') = 1, 'notifications: due pending → one call');
  PERFORM t.ok((SELECT headers ->> 'Authorization' FROM net.calls ORDER BY id DESC LIMIT 1) = 'Bearer test-service-key',
               'notifications: the call still carries the embedded key');

  PERFORM t.reset();
  INSERT INTO public.notification_queue (status, next_attempt_at) VALUES ('failed', now() + interval '1 hour');
  PERFORM t.ok(t.fire('process-notification-queue') = 0, 'notifications: retry not yet due → no call');

  PERFORM t.reset();
  INSERT INTO public.notification_queue (status, next_attempt_at) VALUES ('failed', now() - interval '1 minute');
  PERFORM t.ok(t.fire('process-notification-queue') = 1, 'notifications: retry due → call');

  PERFORM t.reset();
  INSERT INTO public.notification_queue (status, processed_at) VALUES ('processing', now() - interval '1 minute');
  PERFORM t.ok(t.fire('process-notification-queue') = 0, 'notifications: batch in progress → no call');

  PERFORM t.reset();
  INSERT INTO public.notification_queue (status, processed_at) VALUES ('processing', now() - interval '10 minutes');
  PERFORM t.ok(t.fire('process-notification-queue') = 1, 'notifications: stuck batch → call, so it is recovered');

  PERFORM t.reset();
  INSERT INTO public.notification_queue (status) VALUES ('sent'), ('dead_letter');
  PERFORM t.ok(t.fire('process-notification-queue') = 0, 'notifications: only finished rows → no call');

  PERFORM t.reset();
  INSERT INTO public.notification_queue (status) VALUES ('pending');
  INSERT INTO public.app_settings (key, value) VALUES ('email_system_enabled', 'false');
  PERFORM t.ok(t.fire('process-notification-queue') = 0, 'notifications: email paused → no call');
  UPDATE public.app_settings SET value = 'true' WHERE key = 'email_system_enabled';
  PERFORM t.ok(t.fire('process-notification-queue') = 1, 'notifications: email resumed → call');
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Health view
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- process-cron-queue
  PERFORM t.reset();
  UPDATE public.sync_jobs SET last_run_at = now() - interval '3 hours', last_run_status = 'success'
  WHERE job_name = 'process-cron-queue';
  PERFORM t.fired('process-cron-queue', interval '30 seconds');
  PERFORM t.ok(t.health('process-cron-queue') = 'healthy',
               'cron queue: idle for hours but firing → healthy');
  PERFORM t.ok((SELECT last_run_at FROM public.get_cron_job_health() WHERE job_name = 'process-cron-queue')
                 > now() - interval '1 minute',
               'cron queue: last run shows the last check, not the last real run');

  PERFORM t.reset();
  PERFORM t.fired('process-cron-queue', interval '10 minutes');
  PERFORM t.ok(t.health('process-cron-queue') = 'missed', 'cron queue: pg_cron stopped firing → missed');

  PERFORM t.reset();
  PERFORM t.fired('process-cron-queue', interval '20 seconds', 'failed');
  PERFORM t.ok(t.health('process-cron-queue') = 'failed', 'cron queue: last firing failed → failed');

  PERFORM t.ok((SELECT last_error FROM public.get_cron_job_health() WHERE job_name = 'process-cron-queue')
                 = 'ERROR: boom', 'cron queue: failed firing shows pg_cron''s message');

  PERFORM t.reset();
  PERFORM t.fired('process-cron-queue', interval '20 seconds');
  INSERT INTO public.cron_job_queue (job_name, edge_function_name, available_at)
  VALUES ('j', 'f', now() - interval '20 minutes');
  PERFORM t.ok(t.health('process-cron-queue') = 'stale', 'cron queue: due job waiting 20 min → stale');
  PERFORM t.ok((SELECT last_error FROM public.get_cron_job_health() WHERE job_name = 'process-cron-queue')
                 LIKE '1 due job(s) waiting since % IST',
               'cron queue: stale says how much is waiting, not pg_cron''s "1 row"');

  PERFORM t.reset();
  PERFORM t.fired('process-cron-queue', interval '20 seconds');
  INSERT INTO public.cron_job_queue (job_name, edge_function_name, available_at)
  VALUES ('j', 'f', now() - interval '5 minutes');
  PERFORM t.ok(t.health('process-cron-queue') = 'healthy', 'cron queue: due job waiting 5 min → still healthy');

  -- process-notification-queue
  PERFORM t.reset();
  UPDATE public.sync_jobs SET last_run_at = now() - interval '5 hours', last_run_status = 'success'
  WHERE job_name = 'process-notification-queue';
  PERFORM t.fired('process-notification-queue', interval '1 minute');
  PERFORM t.ok(t.health('process-notification-queue') = 'healthy',
               'notifications: idle for hours but firing → healthy');

  PERFORM t.reset();
  PERFORM t.fired('process-notification-queue', interval '15 minutes');
  PERFORM t.ok(t.health('process-notification-queue') = 'missed', 'notifications: not fired for 15 min → missed');

  PERFORM t.reset();
  PERFORM t.fired('process-notification-queue', interval '1 minute');
  INSERT INTO public.notification_queue (status, next_attempt_at) VALUES ('pending', now() - interval '15 minutes');
  PERFORM t.ok(t.health('process-notification-queue') = 'healthy', 'notifications: due for 15 min (a burst draining) → healthy');
  INSERT INTO public.notification_queue (status, next_attempt_at) VALUES ('pending', now() - interval '40 minutes');
  PERFORM t.ok(t.health('process-notification-queue') = 'stale', 'notifications: due for 40 min → stale');
  PERFORM t.ok((SELECT last_error FROM public.get_cron_job_health() WHERE job_name = 'process-notification-queue')
                 LIKE '1 notification(s) waiting since % IST',
               'notifications: stale says how much is waiting and since when');
  INSERT INTO public.app_settings (key, value) VALUES ('email_system_enabled', 'false');
  PERFORM t.ok(t.health('process-notification-queue') = 'healthy', 'notifications: same backlog while paused → healthy');

  PERFORM t.reset();
  PERFORM t.fired('process-notification-queue', interval '1 minute');
  UPDATE public.sync_jobs SET last_run_at = now() - interval '3 minutes', last_run_status = 'error'
  WHERE job_name = 'process-notification-queue';
  INSERT INTO public.api_call_logs (endpoint, status, message, job_name)
  VALUES ('/functions/v1/process-notification-queue', 'error', 'claim failed', 'process-notification-queue');
  INSERT INTO public.notification_queue (status) VALUES ('pending');
  PERFORM t.ok(t.health('process-notification-queue') = 'failed', 'notifications: last run errored with work left → failed');
  PERFORM t.ok((SELECT last_error FROM public.get_cron_job_health() WHERE job_name = 'process-notification-queue')
                 = 'claim failed', 'notifications: failed shows the run''s error');
  DELETE FROM public.notification_queue;
  INSERT INTO public.notification_queue (status, processed_at) VALUES ('processing', now());
  PERFORM t.ok(t.health('process-notification-queue') = 'failed', 'notifications: errored with a batch still claimed → failed');
  UPDATE public.notification_queue SET status = 'dead_letter';
  PERFORM t.ok(t.health('process-notification-queue') = 'healthy',
               'notifications: errored but nothing left to do (dead-lettered) → healthy, not stuck red');

  -- An ordinary daily job is judged as before.
  PERFORM t.reset();
  UPDATE public.sync_jobs SET last_run_at = now() - interval '2 hours', last_run_status = 'success'
  WHERE job_name = 'leave-sync-daily';
  PERFORM t.ok(t.health('leave-sync-daily') = 'healthy', 'daily job ran 2h ago → healthy');
  UPDATE public.sync_jobs SET last_run_at = now() - interval '30 hours' WHERE job_name = 'leave-sync-daily';
  PERFORM t.ok(t.health('leave-sync-daily') = 'missed', 'daily job ran 30h ago → missed');

  -- A queued job left waiting: pg_cron's successful "1 row" is not an error.
  PERFORM t.reset();
  UPDATE public.sync_jobs SET last_run_at = now() - interval '2 hours', last_run_status = 'success'
  WHERE job_name = 'leave-sync-daily';
  PERFORM t.fired('leave-sync-daily', interval '20 minutes');
  INSERT INTO public.cron_job_queue (job_name, edge_function_name, available_at, queued_at)
  VALUES ('leave-sync-daily', 'fetch-leave-data', now() - interval '20 minutes', now() - interval '20 minutes');
  PERFORM t.ok(t.health('leave-sync-daily') = 'stale' AND
               (SELECT last_error FROM public.get_cron_job_health() WHERE job_name = 'leave-sync-daily') IS NULL,
               'stale queued job does not show pg_cron''s success message as its error');
  PERFORM t.reset();
END $$;

-- system_health_check() judges the processors on pg_cron's firings too.
DO $$
DECLARE
  v JSONB;
BEGIN
  PERFORM t.reset();
  UPDATE public.sync_jobs SET last_run_at = now() - interval '30 hours', last_run_status = 'success';
  PERFORM t.fired('process-notification-queue', interval '1 minute');
  v := public.system_health_check() -> 'cron_jobs';
  PERFORM t.ok((SELECT (e ->> 'stale')::boolean FROM jsonb_array_elements(v) e
                WHERE e ->> 'job' = 'process-notification-queue') = false,
               'system_health_check: quiet notification processor that pg_cron still fires is not stale');
  PERFORM t.ok((SELECT (e ->> 'stale')::boolean FROM jsonb_array_elements(v) e
                WHERE e ->> 'job' = 'leave-sync-daily') = true,
               'system_health_check: other jobs keep the 25h rule');
  PERFORM t.reset();
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Grants
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM t.ok(NOT has_function_privilege('anon', 'public.cron_queue_has_due_work()', 'EXECUTE')
           AND NOT has_function_privilege('authenticated', 'public.cron_queue_has_due_work()', 'EXECUTE')
           AND NOT has_function_privilege('anon', 'public.notification_queue_has_due_work()', 'EXECUTE')
           AND NOT has_function_privilege('authenticated', 'public.notification_queue_has_due_work()', 'EXECUTE'),
               'guards are closed to anon and authenticated');
  PERFORM t.ok(has_function_privilege('authenticated', 'public.get_cron_job_health()', 'EXECUTE')
           AND NOT has_function_privilege('anon', 'public.get_cron_job_health()', 'EXECUTE'),
               'health view keeps its grants');
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. employee_schedules indexes
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_names TEXT[];
BEGIN
  SELECT array_agg(indexname ORDER BY indexname) INTO v_names
  FROM   pg_indexes WHERE schemaname = 'public' AND tablename = 'employee_schedules';

  PERFORM t.ok(NOT (v_names && ARRAY['idx_employee_schedules_code_date', 'idx_schedules_emp_date_range',
                                     'idx_employee_schedules_duty_date']),
               'the three duplicate indexes are gone');
  PERFORM t.ok(v_names @> ARRAY['employee_schedules_pkey', 'employee_schedules_employee_code_duty_date_key',
                                'idx_employee_schedules_date_code', 'idx_schedules_date_code',
                                'idx_employee_schedules_employee_name_trgm',
                                'idx_employee_schedules_employee_code_trgm'],
               'every other index is kept');

  INSERT INTO public.employee_schedules (employee_code, employee_name, duty_date, duty_code)
  VALUES ('E1', 'One', '2026-10-01', 'M')
  ON CONFLICT (employee_code, duty_date) DO UPDATE SET duty_code = EXCLUDED.duty_code;
  INSERT INTO public.employee_schedules (employee_code, employee_name, duty_date, duty_code)
  VALUES ('E1', 'One', '2026-10-01', 'N')
  ON CONFLICT (employee_code, duty_date) DO UPDATE SET duty_code = EXCLUDED.duty_code;
  PERFORM t.ok((SELECT count(*) = 1 AND min(duty_code) = 'N' FROM public.employee_schedules),
               'ON CONFLICT (employee_code, duty_date) still works');
END $$;

-- Every lookup the dropped indexes served still has an index.
SET enable_seqscan = off;
DO $$
BEGIN
  PERFORM t.ok(t.plan($q$SELECT * FROM public.employee_schedules WHERE employee_code = 'E1'
                         AND duty_date BETWEEN '2026-10-01' AND '2026-10-31' ORDER BY duty_date$q$)
               NOT LIKE '%Seq Scan%', 'employee + date range is indexed');
  PERFORM t.ok(t.plan($q$SELECT * FROM public.employee_schedules WHERE employee_code = 'E1'$q$)
               NOT LIKE '%Seq Scan%', 'employee lookup is indexed');
  PERFORM t.ok(t.plan($q$SELECT * FROM public.employee_schedules WHERE duty_date = '2026-10-01'$q$)
               NOT LIKE '%Seq Scan%', 'single date is indexed');
  PERFORM t.ok(t.plan($q$SELECT * FROM public.employee_schedules
                         WHERE duty_date BETWEEN '2026-10-01' AND '2026-10-31'$q$)
               NOT LIKE '%Seq Scan%', 'date range is indexed');
END $$;
RESET enable_seqscan;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Re-registering from the admin page (manage_cron_job) keeps the guard
-- ═══════════════════════════════════════════════════════════════════════════

SET app.settings.supabase_url = 'https://example.supabase.co';
SET app.settings.service_role_key = 'admin-page-key';

DO $$
DECLARE
  v_cmd TEXT;
BEGIN
  PERFORM t.reset();

  PERFORM public.manage_cron_job('reschedule', 'process-cron-queue', '* * * * *');
  v_cmd := t.cmd('process-cron-queue');
  PERFORM t.ok(v_cmd ~ 'WHERE public\.cron_queue_has_due_work\(\);$'
           AND v_cmd LIKE '%timeout_milliseconds := 150000%',
               'reschedule keeps process-cron-queue guarded, with its 150s timeout');
  PERFORM t.ok(t.fire('process-cron-queue') = 0, 'rescheduled cron queue: empty → no call');
  INSERT INTO public.cron_job_queue (job_name, edge_function_name) VALUES ('j', 'f');
  PERFORM t.ok(t.fire('process-cron-queue') = 1, 'rescheduled cron queue: due job → call');

  PERFORM public.manage_cron_job('unschedule', 'process-notification-queue');
  PERFORM t.ok(t.cmd('process-notification-queue') IS NULL, 'switching the notification processor off unschedules it');
  PERFORM public.manage_cron_job('schedule', 'process-notification-queue', '*/2 * * * *');
  v_cmd := t.cmd('process-notification-queue');
  PERFORM t.ok(v_cmd ~ 'WHERE public\.notification_queue_has_due_work\(\);$'
           AND v_cmd LIKE '%timeout_milliseconds := 60000%',
               'switching it back on registers it guarded');
  PERFORM t.ok(t.fire('process-notification-queue') = 0, 're-registered notifications: empty → no call');

  PERFORM public.manage_cron_job('schedule', 'check-license-expiry', '30 18 * * *', 'check-license-expiry');
  v_cmd := t.cmd('check-license-expiry');
  PERFORM t.ok(v_cmd NOT LIKE '%has_due_work%' AND v_cmd LIKE '%timeout_milliseconds := 60000%'
           AND v_cmd ~ '\);$',
               'other direct jobs are registered as before');
  PERFORM t.ok(t.fire('check-license-expiry') = 1, 'other direct jobs still call every time');

  PERFORM public.manage_cron_job('schedule', 'leave-sync-daily', '50 17 * * *', 'fetch-leave-data');
  PERFORM t.ok(t.cmd('leave-sync-daily') LIKE 'INSERT INTO public.cron_job_queue%',
               'queued jobs are still registered as queue inserts');
  PERFORM public.manage_cron_job('schedule', 'working-hours-cache-16h', '30 10 * * *', 'refresh-working-hours');
  PERFORM public.manage_cron_job('schedule', 'ba-test-fetch-1740', '10 12 * * *', 'fetch-ba-test');
  PERFORM t.ok(t.cmd('working-hours-cache-16h') LIKE 'INSERT INTO public.cron_job_queue%'
           AND t.cmd('ba-test-fetch-1740') LIKE 'INSERT INTO public.cron_job_queue%',
               'working-hours and BA-test jobs go back through the queue');
  PERFORM t.reset();
END $$;

RESET app.settings.supabase_url;
RESET app.settings.service_role_key;

DO $$ BEGIN RAISE NOTICE 'all queue-poller scenarios passed'; END $$;
