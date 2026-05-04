-- ─────────────────────────────────────────────────────────────────────────────
-- Email System Toggle
-- Adds an admin-controlled on/off switch for the email notification system.
-- When paused: no new emails are enqueued; pending queue items are discarded.
-- Password-reset emails (Supabase Auth) are unaffected — they bypass this system.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Seed the email system toggle setting (default: enabled)
INSERT INTO public.app_settings (key, value, label)
VALUES (
  'email_system_enabled',
  'true',
  'Email Notification System'
)
ON CONFLICT (key) DO NOTHING;

-- 2. Add 'cancelled' as a valid status in notification_queue
--    (used when the admin pauses the system and clears the queue)
ALTER TABLE public.notification_queue
  DROP CONSTRAINT IF EXISTS notification_queue_status_check;

ALTER TABLE public.notification_queue
  ADD CONSTRAINT notification_queue_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead_letter', 'cancelled'));

-- 3. Index to efficiently find pending email jobs (used on pause to bulk-cancel)
CREATE INDEX IF NOT EXISTS idx_nq_pending_email
  ON public.notification_queue(status, channel)
  WHERE status IN ('pending', 'failed') AND channel = 'email';
