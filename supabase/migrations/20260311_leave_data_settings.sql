-- Seed app_settings with leave data webapp URL (placeholder)
INSERT INTO public.app_settings (key, value, label)
VALUES ('leave_data_webapp_url', '', 'Leave Data Webapp URL')
ON CONFLICT (key) DO NOTHING;
