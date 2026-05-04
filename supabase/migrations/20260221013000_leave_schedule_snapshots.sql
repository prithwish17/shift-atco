-- Preserve schedule state when approved leave overrides duty as LEAVE,
-- so cancellation can restore the original schedule.

CREATE TABLE IF NOT EXISTS public.leave_schedule_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  leave_request_id UUID NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_leave_schedule_snapshots_leave_request
  ON public.leave_schedule_snapshots(leave_request_id);

CREATE INDEX IF NOT EXISTS idx_leave_schedule_snapshots_employee_date
  ON public.leave_schedule_snapshots(employee_id, duty_date);

ALTER TABLE public.leave_schedule_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read leave_schedule_snapshots"
  ON public.leave_schedule_snapshots
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated write leave_schedule_snapshots"
  ON public.leave_schedule_snapshots
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
