
CREATE TABLE public.rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date text NOT NULL,
  shift text NOT NULL,
  team text NOT NULL,
  unit text NOT NULL,
  employee_name text NOT NULL,
  position text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(date, shift, employee_name, unit, position)
);

ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view rosters"
  ON public.rosters FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "WSOs and supervisors can manage rosters"
  ON public.rosters FOR ALL
  USING (has_role(auth.uid(), 'wso'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
