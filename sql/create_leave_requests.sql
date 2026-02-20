-- Leave Requests Table
-- Run this in the Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id),
  employee_name TEXT NOT NULL,
  team TEXT,
  leave_type TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON public.leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON public.leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON public.leave_requests(start_date, end_date);

-- RLS Policies
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;

-- Employees can view their own requests
CREATE POLICY "Employees view own leave requests"
  ON public.leave_requests FOR SELECT
  USING (auth.uid() = employee_id);

-- Employees can insert their own requests
CREATE POLICY "Employees insert own leave requests"
  ON public.leave_requests FOR INSERT
  WITH CHECK (auth.uid() = employee_id);

-- Employees can update their own pending requests (for cancel/edit)
CREATE POLICY "Employees update own pending requests"
  ON public.leave_requests FOR UPDATE
  USING (auth.uid() = employee_id AND status = 'Pending');

-- WSO and Supervisors can view all requests
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

-- WSO and Supervisors can update any request (for approve/reject)
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

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_leave_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_requests_updated_at
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_leave_requests_updated_at();
