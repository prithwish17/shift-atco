-- ─────────────────────────────────────────────────────────────────────────────
-- Minimal stand-in for the Supabase database the leave migrations run against.
--
-- Only what the leave migrations touch: the auth helpers (auth.uid() and
-- auth.role() read request.jwt.claims exactly as Supabase's do), the API roles,
-- and the tables those migrations assume already exist, at their current
-- shape. Every leave table and function *under test* comes from the real
-- migration files, applied after this by run.sh.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Supabase grants every new function and table in public to the API roles by
-- default, so REVOKE ... FROM PUBLIC alone does not close a function to signed-in
-- users. Reproduce that, or the grant tests below prove nothing.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id    UUID PRIMARY KEY,
  email TEXT
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'sub'), '')::UUID
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::JSONB ->> 'role')::TEXT
$$;

CREATE TYPE public.leave_type AS ENUM ('cl', 'rh', 'el', 'hpl', 'comp_off');

CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users (id),
  employee_id   TEXT UNIQUE,
  full_name     TEXT,
  current_shift TEXT
);

CREATE TABLE public.user_roles (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  UUID NOT NULL REFERENCES auth.users (id),
  role     TEXT NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE public.holidays (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date DATE NOT NULL,
  station      TEXT NOT NULL DEFAULT 'ALL',
  name         TEXT
);

CREATE TABLE public.comp_off_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES auth.users (id),
  holiday_id   UUID NOT NULL REFERENCES public.holidays (id),
  duty_date    DATE NOT NULL,
  days_granted INTEGER NOT NULL DEFAULT 1,
  expiry_date  DATE,
  status       TEXT NOT NULL DEFAULT 'available',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, holiday_id, duty_date)
);

CREATE TABLE public.employee_schedules (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code    TEXT NOT NULL,
  employee_name    TEXT,
  duty_date        DATE NOT NULL,
  duty_code        TEXT,
  duty_description TEXT,
  UNIQUE (employee_code, duty_date)
);

CREATE TABLE public.leave_balances (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users (id),
  leave_type  public.leave_type NOT NULL,
  balance     NUMERIC(5,1) NOT NULL DEFAULT 0,
  expiry_date DATE,
  year        INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, leave_type, year)
);

CREATE TABLE public.app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT,
  label TEXT
);

CREATE TABLE public.sync_jobs (
  job_name           TEXT PRIMARY KEY,
  edge_function_name TEXT,
  cron_schedule      TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  payload            JSONB NOT NULL DEFAULT '{}'::JSONB,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule)
VALUES ('sync-leave-records', 'sync-leave-records', '0 */2 * * *');

-- leave_requests at its current shape (baseline + every later ADD COLUMN).
CREATE TABLE public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users (id),
  employee_name TEXT NOT NULL,
  team TEXT,
  leave_type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days NUMERIC(4,1) NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending WSO',
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES auth.users (id),
  reviewed_at TIMESTAMPTZ,
  remarks TEXT,
  wso_approved_by UUID REFERENCES auth.users (id),
  wso_approved_at TIMESTAMPTZ,
  wso_comments TEXT,
  supervisor_approved_by UUID REFERENCES auth.users (id),
  supervisor_approved_at TIMESTAMPTZ,
  supervisor_comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  direct_supervisor_approved BOOLEAN DEFAULT false,
  direct_supervisor_approved_by UUID,
  direct_supervisor_approved_at TIMESTAMPTZ,
  direct_supervisor_comments TEXT,
  actual_rh_date DATE,
  sap_applied BOOLEAN,
  sap_updated BOOLEAN DEFAULT false,
  actual_rh_date_2 DATE,
  ch_comp_off_dates JSONB,
  attachment_path TEXT,
  attachment_meta JSONB,
  CONSTRAINT leave_requests_status_check
    CHECK (status IN ('Pending WSO', 'Pending Supervisor', 'Approved', 'Rejected', 'Cancelled')),
  CONSTRAINT leave_requests_approval_path_check CHECK (
    status <> 'Approved'
    OR (COALESCE(direct_supervisor_approved, false) = false
        AND wso_approved_by IS NOT NULL AND supervisor_approved_by IS NOT NULL)
    OR (COALESCE(direct_supervisor_approved, false) = true
        AND supervisor_approved_by IS NOT NULL AND direct_supervisor_approved_by IS NOT NULL))
);

CREATE TABLE public.leave_schedule_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  leave_request_id UUID NOT NULL REFERENCES public.leave_requests (id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  duty_date DATE NOT NULL,
  had_schedule BOOLEAN NOT NULL DEFAULT false,
  original_employee_code TEXT,
  original_employee_name TEXT,
  original_duty_code TEXT,
  original_duty_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at TIMESTAMPTZ,
  UNIQUE (leave_request_id, duty_date)
);

-- employee_leave_records at its current shape.
CREATE TABLE public.employee_leave_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  sl_no INTEGER,
  status TEXT,
  leave_category TEXT NOT NULL,
  leave_date DATE NOT NULL,
  metadata JSONB DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'google_sheets',
  sync_batch_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_event_type TEXT NOT NULL DEFAULT '',
  event_kind TEXT NOT NULL DEFAULT 'other',
  duty_code TEXT NOT NULL DEFAULT '',
  raw_date_value TEXT,
  raw_shift_value TEXT,
  raw_event JSONB NOT NULL DEFAULT '{}'::JSONB,
  leave_used_on DATE,
  raw_leave_used_value TEXT,
  CONSTRAINT employee_leave_records_unique
    UNIQUE (emp_id, leave_category, source_event_type, leave_date, duty_code)
);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_employee_leave_records_updated_at
  BEFORE UPDATE ON public.employee_leave_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
