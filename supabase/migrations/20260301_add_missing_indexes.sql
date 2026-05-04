-- Add missing database indexes for frequently queried columns
-- These indexes improve query performance for leave requests,
-- employee schedules, rosters, and profile lookups.

CREATE INDEX IF NOT EXISTS idx_employee_schedules_code_date
  ON public.employee_schedules(employee_code, duty_date);

CREATE INDEX IF NOT EXISTS idx_rosters_date_shift_team
  ON public.rosters(date, shift, team);

CREATE INDEX IF NOT EXISTS idx_profiles_email
  ON public.profiles(email);

-- leave_requests indexes (only if table exists — it may have been created outside migrations)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'leave_requests' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_status ON public.leave_requests(employee_id, status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON public.leave_requests(start_date, end_date)';
  END IF;
END $$;
