-- Employee Leave Records: master leave register synced from Google Sheets
-- Each row = one leave date for one employee in one category

CREATE TABLE IF NOT EXISTS public.employee_leave_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_id TEXT NOT NULL,                     -- maps to profiles.employee_id
  employee_name TEXT NOT NULL,
  sl_no INTEGER,
  status TEXT,                              -- transfer/superannuation status from sheet
  leave_category TEXT NOT NULL,             -- 'CL','RH','NH','CH','COMP_OFF','OPE'
  leave_date DATE NOT NULL,                 -- the actual leave/duty date
  metadata JSONB DEFAULT '{}',              -- category-specific extra fields
  source TEXT NOT NULL DEFAULT 'google_sheets',  -- 'google_sheets' or 'webapp'
  sync_batch_id TEXT,                       -- batch ID for tracking sync runs
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT employee_leave_records_unique UNIQUE(emp_id, leave_category, leave_date)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_elr_emp_id ON public.employee_leave_records(emp_id);
CREATE INDEX IF NOT EXISTS idx_elr_category ON public.employee_leave_records(leave_category);
CREATE INDEX IF NOT EXISTS idx_elr_date ON public.employee_leave_records(leave_date);
CREATE INDEX IF NOT EXISTS idx_elr_emp_cat ON public.employee_leave_records(emp_id, leave_category);

-- RLS
ALTER TABLE public.employee_leave_records ENABLE ROW LEVEL SECURITY;

-- Employees can view their own records (matched by emp_id → profiles.employee_id)
CREATE POLICY "Employees view own leave records"
  ON public.employee_leave_records FOR SELECT
  USING (
    emp_id = (
      SELECT employee_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- WSO, Supervisors, Admin can view all
CREATE POLICY "Staff view all leave records"
  ON public.employee_leave_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('wso', 'supervisor', 'admin')
        AND user_roles.approved = true
    )
  );

-- WSO, Supervisors, Admin can insert/update (for webapp edits)
CREATE POLICY "Staff manage leave records"
  ON public.employee_leave_records FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('wso', 'supervisor', 'admin')
        AND user_roles.approved = true
    )
  );

-- updated_at trigger
CREATE TRIGGER update_employee_leave_records_updated_at
  BEFORE UPDATE ON public.employee_leave_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
