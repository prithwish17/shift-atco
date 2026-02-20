-- Seed schedule webapp URL for admin-configurable duty schedule sync
INSERT INTO public.app_settings (key, value, label)
VALUES (
  'schedule_webapp_url',
  'https://script.google.com/macros/s/AKfycbyj6zFzcEh16H07ZKj7NAMOndgNeUWG_Hgk8zopLnSDduLzjBFIDWmLvzqqCthPtcF2/exec',
  'Schedule Sync Webapp URL'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
