-- ATC Duty Grid tables
-- Creates duty_rosters, roster_assignments, employee_leave_dates, extra_duties

-- Duty Rosters: one row per date+shift
CREATE TABLE IF NOT EXISTS public.duty_rosters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  roster_date DATE NOT NULL,
  shift TEXT NOT NULL DEFAULT 'Morning',
  team TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(roster_date, shift)
);

-- Roster Assignments: position ↔ employee mapping
CREATE TABLE IF NOT EXISTS public.roster_assignments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  roster_id UUID NOT NULL REFERENCES public.duty_rosters(id) ON DELETE CASCADE,
  position_name TEXT NOT NULL,
  position_label TEXT,
  department TEXT NOT NULL,
  employee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  remark TEXT,
  section_type TEXT NOT NULL DEFAULT 'sector',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(roster_id, position_name, department)
);

-- Employee Leave Dates: per-date leave records for the grid
-- Distinct from the existing 'leaves' table (which tracks approval workflows)
CREATE TABLE IF NOT EXISTS public.employee_leave_dates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  leave_date DATE NOT NULL,
  leave_type TEXT NOT NULL DEFAULT 'Leave',
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Extra Duties: OPE / Familiarization / Refresher / Other
CREATE TABLE IF NOT EXISTS public.extra_duties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  roster_id UUID NOT NULL REFERENCES public.duty_rosters(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  duty_type TEXT NOT NULL DEFAULT 'OPE',
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE public.duty_rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_leave_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extra_duties ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Read access for all authenticated users
CREATE POLICY "Authenticated read duty_rosters" ON public.duty_rosters
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read roster_assignments" ON public.roster_assignments
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read employee_leave_dates" ON public.employee_leave_dates
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read extra_duties" ON public.extra_duties
  FOR SELECT USING (auth.role() = 'authenticated');

-- RLS Policies: Write access for WSO, Supervisor, Admin
CREATE POLICY "WSO/Sup/Admin write duty_rosters" ON public.duty_rosters
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "WSO/Sup/Admin write roster_assignments" ON public.roster_assignments
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "WSO/Sup/Admin write employee_leave_dates" ON public.employee_leave_dates
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Sup/Admin write extra_duties" ON public.extra_duties
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Timestamp update trigger for duty_rosters
CREATE OR REPLACE FUNCTION public.update_duty_roster_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_duty_rosters_updated_at
  BEFORE UPDATE ON public.duty_rosters
  FOR EACH ROW EXECUTE FUNCTION public.update_duty_roster_updated_at();
