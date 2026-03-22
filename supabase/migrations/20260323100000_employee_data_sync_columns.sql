-- Add employee data sync columns to employee_training_records
-- Stores: highest_rating, rating_summary (YES/NO per rating type), without_ratings

ALTER TABLE public.employee_training_records
  ADD COLUMN IF NOT EXISTS highest_rating TEXT,
  ADD COLUMN IF NOT EXISTS rating_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS without_ratings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Seed the employee data webapp URL setting
INSERT INTO public.app_settings (key, value, label)
VALUES (
  'employee_data_webapp_url',
  '',
  'Employee Data Webapp URL'
)
ON CONFLICT (key) DO NOTHING;

-- Seed missing employees data storage
INSERT INTO public.app_settings (key, value, label)
VALUES (
  'missing_employees_data',
  '[]',
  'Employees not found in latest employee data sync'
)
ON CONFLICT (key) DO NOTHING;
