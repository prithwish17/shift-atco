-- Add trainee unit / hours sync columns to employee_training_records

ALTER TABLE public.employee_training_records
  ADD COLUMN IF NOT EXISTS trainee_designation TEXT,
  ADD COLUMN IF NOT EXISTS trainee_unit TEXT,
  ADD COLUMN IF NOT EXISTS trainee_hours_required INTEGER,
  ADD COLUMN IF NOT EXISTS trainee_synced_at TIMESTAMPTZ;

-- Seed the trainee webapp URL setting
INSERT INTO public.app_settings (key, value, label)
VALUES (
  'trainee_data_webapp_url',
  '',
  'Trainee Data Webapp URL'
)
ON CONFLICT (key) DO NOTHING;