-- Add ELPA (English Language Proficiency for Aviation) columns to employee_training_records
-- Reuses the same emp_id key, avoiding a separate table

ALTER TABLE public.employee_training_records
  ADD COLUMN IF NOT EXISTS elpa_level TEXT,
  ADD COLUMN IF NOT EXISTS elpa_valid_upto TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS elpa_endorsed_upto TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS elpa_synced_at TIMESTAMPTZ;

-- Seed the ELPA webapp URL setting (admin will configure the actual URL)
INSERT INTO public.app_settings (key, value, label)
VALUES (
  'elpa_data_webapp_url',
  '',
  'ELPA Data Webapp URL'
)
ON CONFLICT (key) DO NOTHING;
