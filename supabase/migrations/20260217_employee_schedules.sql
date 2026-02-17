-- Employee Schedules table — duty assignments fetched from Google Sheets
CREATE TABLE IF NOT EXISTS public.employee_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_code TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  duty_date DATE NOT NULL,
  duty_code TEXT NOT NULL DEFAULT '',
  duty_description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(employee_code, duty_date)
);

ALTER TABLE public.employee_schedules ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read
CREATE POLICY "Authenticated read employee_schedules" ON public.employee_schedules
  FOR SELECT USING (auth.role() = 'authenticated');

-- WSO / Supervisor / Admin can write
CREATE POLICY "WSO/Sup/Admin write employee_schedules" ON public.employee_schedules
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Auto-update timestamp
CREATE TRIGGER update_employee_schedules_updated_at
  BEFORE UPDATE ON public.employee_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
