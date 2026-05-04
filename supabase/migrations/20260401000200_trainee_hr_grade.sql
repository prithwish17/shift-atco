-- Add trainee HR Grade status for supervisor-managed trainee progress

ALTER TABLE public.employee_training_records
  ADD COLUMN IF NOT EXISTS trainee_hr_grade TEXT;