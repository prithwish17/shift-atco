-- ─────────────────────────────────────────────────────────────────────────────
-- leave_requests — baseline table definition
--
-- WHY THIS FILE EXISTS AND WHY ITS TIMESTAMP IS IN THE PAST
--
-- public.leave_requests is the primary leave workflow table, but until now it
-- was never created by a migration — it lived only in sql/create_leave_requests.sql
-- ("Run this in the Supabase SQL Editor").  Every later migration ALTERs it, and
-- those ALTERs are only partly guarded: 20260220235500_leave_requests_two_stage_approval.sql
-- wraps its ADD COLUMN in an information_schema check but then runs a bare
-- UPDATE/ALTER TABLE against the table.  On a database built purely from
-- supabase/migrations/ that migration therefore fails outright.
--
-- This file is timestamped 20260220100000 so it sorts *before* that migration and
-- a fresh database builds cleanly.  It is deliberately, completely idempotent:
--   • CREATE TABLE IF NOT EXISTS
--   • policies created only when pg_policies has no policy of that name, so a
--     later migration that redefines a policy is never clobbered
--   • trigger dropped and recreated (its definition is unchanged downstream)
-- Applying it out of order to the existing production database is a no-op.
--
-- Column set below is the ORIGINAL one only.  Everything added later
-- (wso_*/supervisor_*, direct_supervisor_*, actual_rh_date, sap_*, ch_comp_off_dates,
-- attachment_*, and the provenance columns) stays owned by its own migration.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id),
  employee_name TEXT NOT NULL,
  team TEXT,
  leave_type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days NUMERIC(4,1) NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending WSO',
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  remarks TEXT,
  wso_approved_by UUID REFERENCES auth.users(id),
  wso_approved_at TIMESTAMPTZ,
  wso_comments TEXT,
  supervisor_approved_by UUID REFERENCES auth.users(id),
  supervisor_approved_at TIMESTAMPTZ,
  supervisor_comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_status_check
    CHECK (status IN ('Pending WSO', 'Pending Supervisor', 'Approved', 'Rejected', 'Cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON public.leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status   ON public.leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates    ON public.leave_requests(start_date, end_date);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- Policies are created only when absent.  A later migration (the backfill
-- foundation) widens the two staff policies to include 'admin'; recreating them
-- here unconditionally would silently revert that, so we never touch an existing
-- policy of the same name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leave_requests'
      AND policyname = 'Employees view own leave requests'
  ) THEN
    CREATE POLICY "Employees view own leave requests"
      ON public.leave_requests FOR SELECT
      USING (auth.uid() = employee_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leave_requests'
      AND policyname = 'Employees insert own leave requests'
  ) THEN
    CREATE POLICY "Employees insert own leave requests"
      ON public.leave_requests FOR INSERT
      WITH CHECK (auth.uid() = employee_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leave_requests'
      AND policyname = 'Employees update own pending requests'
  ) THEN
    CREATE POLICY "Employees update own pending requests"
      ON public.leave_requests FOR UPDATE
      USING (auth.uid() = employee_id AND status IN ('Pending WSO', 'Pending Supervisor'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leave_requests'
      AND policyname = 'WSO/Supervisors view all leave requests'
  ) THEN
    CREATE POLICY "WSO/Supervisors view all leave requests"
      ON public.leave_requests FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_roles.user_id = auth.uid()
            AND user_roles.role IN ('wso', 'supervisor')
            AND user_roles.approved = true
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'leave_requests'
      AND policyname = 'WSO/Supervisors update leave requests'
  ) THEN
    CREATE POLICY "WSO/Supervisors update leave requests"
      ON public.leave_requests FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_roles.user_id = auth.uid()
            AND user_roles.role IN ('wso', 'supervisor')
            AND user_roles.approved = true
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_leave_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leave_requests_updated_at ON public.leave_requests;
CREATE TRIGGER leave_requests_updated_at
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_leave_requests_updated_at();
