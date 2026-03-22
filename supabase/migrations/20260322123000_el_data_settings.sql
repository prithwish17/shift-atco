-- Seed the earned leave data webapp URL setting (admin will configure the actual URL)
INSERT INTO public.app_settings (key, value, label)
VALUES (
  'el_data_webapp_url',
  '',
  'Earned Leave Data Webapp URL'
)
ON CONFLICT (key) DO NOTHING;