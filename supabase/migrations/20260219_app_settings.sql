-- App Settings: key-value store for admin-configurable settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  label TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Everyone can read settings
CREATE POLICY "Authenticated read app_settings" ON public.app_settings
  FOR SELECT USING (auth.role() = 'authenticated');

-- Only admins can write
CREATE POLICY "Admin write app_settings" ON public.app_settings
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Seed the roster webapp URL
INSERT INTO public.app_settings (key, value, label)
VALUES (
  'roster_webapp_url',
  'https://script.google.com/macros/s/AKfycby0ZL9nspDkRuln1JRpr8llBRaNxvaO9Zo1X6zMg89i_inQSeDBJd6EyQE9Wj6dhQ-S1Q/exec',
  'Roster Sync Webapp URL'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
