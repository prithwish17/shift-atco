-- Add medical data columns to employee_training_records
-- Reuses the same emp_id key, same pattern as ELPA

ALTER TABLE public.employee_training_records
  ADD COLUMN IF NOT EXISTS med_last_date DATE,
  ADD COLUMN IF NOT EXISTS med_endorsed_upto DATE,
  ADD COLUMN IF NOT EXISTS med_status TEXT,
  ADD COLUMN IF NOT EXISTS med_history JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS med_synced_at TIMESTAMPTZ;

-- Seed the medical webapp URL setting (admin will configure the actual URL)
INSERT INTO public.app_settings (key, value, label)
VALUES (
  'medical_data_webapp_url',
  '',
  'Medical Data Webapp URL'
)
ON CONFLICT (key) DO NOTHING;
