-- Add trainee status date fields for supervisor-managed trainee progress

ALTER TABLE public.employee_training_records
  ADD COLUMN IF NOT EXISTS trainee_preboard_completed_on DATE,
  ADD COLUMN IF NOT EXISTS trainee_preboard_scheduled_on DATE,
  ADD COLUMN IF NOT EXISTS trainee_board_scheduled_on DATE;
