-- ─────────────────────────────────────────────────────────────────────────────
-- Minimal stand-in for the Supabase database the queue-poller migrations run
-- against (20260922120000_fix_cron_queue_health, 20261021100000_gate_queue_pollers,
-- 20261021110000_drop_duplicate_schedule_indexes).
--
-- pg_cron and pg_net are replaced by tables and functions with the same names
-- and signatures: cron.schedule() and cron.alter_job() edit cron.job, and
-- net.http_post() records each call in net.calls instead of sending it.
-- Tables the migrations assume already exist are created at their current
-- shape; everything under test comes from the real migration files.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

-- Supabase grants every new function in public to the API roles by default;
-- reproduce that so the grant checks mean something.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ── pg_cron stand-in ─────────────────────────────────────────────────────────

CREATE SCHEMA cron;

CREATE TABLE cron.job (
  jobid    BIGSERIAL PRIMARY KEY,
  schedule TEXT NOT NULL,
  command  TEXT NOT NULL,
  active   BOOLEAN NOT NULL DEFAULT true,
  jobname  TEXT UNIQUE
);

CREATE TABLE cron.job_run_details (
  jobid          BIGINT,
  runid          BIGSERIAL PRIMARY KEY,
  command        TEXT,
  status         TEXT,
  return_message TEXT,
  start_time     TIMESTAMPTZ,
  end_time       TIMESTAMPTZ
);

CREATE FUNCTION cron.schedule(job_name TEXT, schedule TEXT, command TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION cron.unschedule(job_name TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = job_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'could not find valid entry for job ''%''', job_name;
  END IF;
  RETURN true;
END $$;

CREATE FUNCTION cron.alter_job(
  job_id   BIGINT,
  schedule TEXT    DEFAULT NULL,
  command  TEXT    DEFAULT NULL,
  database TEXT    DEFAULT NULL,
  username TEXT    DEFAULT NULL,
  active   BOOLEAN DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cron.job j
  SET    schedule = coalesce(alter_job.schedule, j.schedule),
         command  = coalesce(alter_job.command,  j.command),
         active   = coalesce(alter_job.active,   j.active)
  WHERE  j.jobid = job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % does not exist', job_id;
  END IF;
END $$;


-- ── pg_net stand-in ──────────────────────────────────────────────────────────

CREATE SCHEMA net;

CREATE TABLE net.calls (
  id      BIGSERIAL PRIMARY KEY,
  url     TEXT,
  headers JSONB,
  body    JSONB,
  timeout INTEGER
);

CREATE FUNCTION net.http_post(
  url                  TEXT,
  body                 JSONB   DEFAULT '{}'::jsonb,
  params               JSONB   DEFAULT '{}'::jsonb,
  headers              JSONB   DEFAULT '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds INTEGER DEFAULT 5000)
RETURNS BIGINT LANGUAGE sql AS $$
  INSERT INTO net.calls (url, headers, body, timeout)
  VALUES (url, headers, body, timeout_milliseconds)
  RETURNING id;
$$;


-- ── Tables the migrations assume exist (current shape) ──────────────────────

CREATE TABLE public.app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  label      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sync_jobs (
  job_name           TEXT PRIMARY KEY,
  edge_function_name TEXT,
  cron_schedule      TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  payload            JSONB NOT NULL DEFAULT '{}',
  last_run_at        TIMESTAMPTZ,
  last_run_status    TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- As created by 20260420_200000_cron_job_queue.sql; 20260922120000 adds the
-- retry columns.
CREATE TABLE public.cron_job_queue (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name           TEXT        NOT NULL,
  edge_function_name TEXT        NOT NULL,
  payload            JSONB       NOT NULL DEFAULT '{}',
  status             TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  priority           INTEGER     NOT NULL DEFAULT 0,
  queued_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  error_message      TEXT,
  triggered_by       TEXT        NOT NULL DEFAULT 'cron_job',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.notification_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID,
  channel         TEXT        NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'push', 'in_app')),
  event_type      TEXT        NOT NULL DEFAULT 'test',
  status          TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead_letter')),
  attempts        INTEGER     NOT NULL DEFAULT 0,
  max_attempts    INTEGER     NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.api_call_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint   TEXT,
  method     TEXT,
  status     TEXT,
  message    TEXT,
  job_name   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read by system_health_check(); only the columns it uses.
CREATE TABLE public.edge_function_errors (
  severity    TEXT,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.email_logs (
  status     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.leave_requests (
  status     TEXT,
  applied_at TIMESTAMPTZ
);

-- employee_schedules with every index production has today.
CREATE TABLE public.employee_schedules (
  id               UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_code    TEXT NOT NULL,
  employee_name    TEXT NOT NULL,
  duty_date        DATE NOT NULL,
  duty_code        TEXT NOT NULL DEFAULT '',
  duty_description TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_code, duty_date)
);
CREATE INDEX idx_employee_schedules_code_date         ON public.employee_schedules (employee_code, duty_date);
CREATE INDEX idx_employee_schedules_duty_date         ON public.employee_schedules (duty_date);
CREATE INDEX idx_schedules_date_code                  ON public.employee_schedules (duty_date, duty_code) WHERE duty_code IS NOT NULL;
CREATE INDEX idx_schedules_emp_date_range             ON public.employee_schedules (employee_code, duty_date);
CREATE INDEX idx_employee_schedules_date_code         ON public.employee_schedules (duty_date, employee_code);
CREATE INDEX idx_employee_schedules_employee_name_trgm ON public.employee_schedules USING GIN (employee_name gin_trgm_ops);
CREATE INDEX idx_employee_schedules_employee_code_trgm ON public.employee_schedules USING GIN (employee_code gin_trgm_ops);


-- ── Jobs as production registered them ───────────────────────────────────────

-- process-notification-queue, exactly as 20260327000000 formats it: the key is
-- embedded at schedule time, so the rewrite must keep it verbatim.
SELECT cron.schedule(
  'process-notification-queue',
  '*/2 * * * *',
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
    'https://example.supabase.co/functions/v1/process-notification-queue',
    'test-service-key', 'test-service-key', '{}'
  )
);

-- A queued job, which the guard migration must not touch.
SELECT cron.schedule(
  'leave-sync-daily',
  '50 17 * * *',
  $$INSERT INTO public.cron_job_queue (job_name, edge_function_name, payload, triggered_by)
    VALUES ('leave-sync-daily', 'fetch-leave-data', '{}'::jsonb, 'cron_job');$$
);

INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule) VALUES
  ('process-cron-queue',         'process-cron-queue',         '* * * * *'),
  ('process-notification-queue', 'process-notification-queue', '*/2 * * * *'),
  ('leave-sync-daily',           'fetch-leave-data',           '50 17 * * *');
