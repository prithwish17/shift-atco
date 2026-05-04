-- Holiday Module Extensions
-- 1. Add columns to holidays table
-- 2. Create comp_off_ledger table

-- ============================================
-- 1. Extend holidays table
-- ============================================
ALTER TABLE public.holidays
  ADD COLUMN IF NOT EXISTS year INTEGER,
  ADD COLUMN IF NOT EXISTS is_optional BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'ALL';

-- Backfill year from holiday_date for existing rows
UPDATE public.holidays SET year = EXTRACT(YEAR FROM holiday_date) WHERE year IS NULL;

-- ============================================
-- 2. Create comp_off_ledger table
-- ============================================
CREATE TABLE IF NOT EXISTS public.comp_off_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  holiday_id UUID NOT NULL REFERENCES public.holidays(id) ON DELETE CASCADE,
  duty_date DATE NOT NULL,
  days_granted INTEGER NOT NULL DEFAULT 1,
  expiry_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'used', 'expired')),
  used_leave_id UUID REFERENCES public.leaves(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(employee_id, holiday_id, duty_date)
);

-- RLS
ALTER TABLE public.comp_off_ledger ENABLE ROW LEVEL SECURITY;

-- Employees can view their own comp-offs
CREATE POLICY "Users view own comp_offs"
  ON public.comp_off_ledger FOR SELECT
  USING (auth.uid() = employee_id);

-- Supervisors/Admins can view all
CREATE POLICY "Supervisors view all comp_offs"
  ON public.comp_off_ledger FOR SELECT
  USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'wso'));

-- Supervisors/Admins can manage
CREATE POLICY "Supervisors manage comp_offs"
  ON public.comp_off_ledger FOR ALL
  USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'wso'));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_comp_off_employee ON public.comp_off_ledger(employee_id);
CREATE INDEX IF NOT EXISTS idx_comp_off_status ON public.comp_off_ledger(status);
CREATE INDEX IF NOT EXISTS idx_comp_off_expiry ON public.comp_off_ledger(expiry_date);
CREATE INDEX IF NOT EXISTS idx_holidays_year ON public.holidays(year);
