-- Fix broken RLS write policies on grid tables + employee_schedules
-- These policies previously allowed ANY authenticated user to INSERT/UPDATE/DELETE.
-- Now properly restricted to WSO / Supervisor / Admin roles using has_role().

-- ================================================================
-- 1. duty_rosters
-- ================================================================
DROP POLICY IF EXISTS "WSO/Sup/Admin write duty_rosters" ON public.duty_rosters;

CREATE POLICY "WSO/Sup/Admin write duty_rosters" ON public.duty_rosters
  FOR ALL USING (
    public.has_role(auth.uid(), 'wso') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'admin')
  ) WITH CHECK (
    public.has_role(auth.uid(), 'wso') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'admin')
  );

-- ================================================================
-- 2. roster_assignments
-- ================================================================
DROP POLICY IF EXISTS "WSO/Sup/Admin write roster_assignments" ON public.roster_assignments;

CREATE POLICY "WSO/Sup/Admin write roster_assignments" ON public.roster_assignments
  FOR ALL USING (
    public.has_role(auth.uid(), 'wso') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'admin')
  ) WITH CHECK (
    public.has_role(auth.uid(), 'wso') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'admin')
  );

-- ================================================================
-- 3. employee_leave_dates
-- ================================================================
DROP POLICY IF EXISTS "WSO/Sup/Admin write employee_leave_dates" ON public.employee_leave_dates;

CREATE POLICY "WSO/Sup/Admin write employee_leave_dates" ON public.employee_leave_dates
  FOR ALL USING (
    public.has_role(auth.uid(), 'wso') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'admin')
  ) WITH CHECK (
    public.has_role(auth.uid(), 'wso') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'admin')
  );

-- ================================================================
-- 4. extra_duties
-- ================================================================
DROP POLICY IF EXISTS "Sup/Admin write extra_duties" ON public.extra_duties;

CREATE POLICY "Sup/Admin write extra_duties" ON public.extra_duties
  FOR ALL USING (
    public.has_role(auth.uid(), 'wso') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'admin')
  ) WITH CHECK (
    public.has_role(auth.uid(), 'wso') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'admin')
  );

-- ================================================================
-- 5. employee_schedules
-- ================================================================
DROP POLICY IF EXISTS "WSO/Sup/Admin write employee_schedules" ON public.employee_schedules;

CREATE POLICY "WSO/Sup/Admin write employee_schedules" ON public.employee_schedules
  FOR ALL USING (
    public.has_role(auth.uid(), 'wso') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'admin')
  ) WITH CHECK (
    public.has_role(auth.uid(), 'wso') OR
    public.has_role(auth.uid(), 'supervisor') OR
    public.has_role(auth.uid(), 'admin')
  );
