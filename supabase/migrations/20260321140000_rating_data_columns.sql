-- Add rating data columns to employee_training_records
-- Reuses the same emp_id key, same pattern as ELPA / Medical

ALTER TABLE public.employee_training_records
  ADD COLUMN IF NOT EXISTS rating_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rating_designation TEXT,
  ADD COLUMN IF NOT EXISTS rating_synced_at TIMESTAMPTZ;

-- Seed the rating webapp URL setting (admin will configure the actual URL)
INSERT INTO public.app_settings (key, value, label)
VALUES (
  'rating_data_webapp_url',
  '',
  'Rating Data Webapp URL'
)
ON CONFLICT (key) DO NOTHING;
