-- ─────────────────────────────────────────────────────────────────────────────
-- Notification & Email Delivery System
-- 1. notification_queue — job queue for pending deliveries (push + email)
-- 2. notification_preferences — per-user channel preferences
-- 3. email_logs — audit trail for sent emails with dedup
-- ─────────────────────────────────────────────────────────────────────────────

-- ============================================
-- 1. Notification Queue (DB-backed job queue)
-- ============================================
CREATE TABLE IF NOT EXISTS public.notification_queue (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text        UNIQUE,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel         text        NOT NULL CHECK (channel IN ('email', 'push', 'in_app')),
  event_type      text        NOT NULL,
  priority        smallint    NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  -- 1 = critical (send immediately), 5 = normal, 10 = low (digest-eligible)
  status          text        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead_letter')),
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- { title, body, url, category, metadata, email_to, email_subject, template }
  attempts        smallint    NOT NULL DEFAULT 0,
  max_attempts    smallint    NOT NULL DEFAULT 3,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  provider        text,       -- 'resend' | 'brevo' | 'web_push'
  content_hash    text,       -- SHA-256 of (user_id + event_type + core content) for dedup
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  CONSTRAINT valid_provider CHECK (provider IS NULL OR provider IN ('resend', 'brevo', 'web_push'))
);

ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

-- Service role only — no user access to queue
CREATE POLICY "Service role manages notification_queue"
  ON public.notification_queue FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Indexes for queue processing
CREATE INDEX IF NOT EXISTS idx_nq_pending_next
  ON public.notification_queue(status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_nq_user_event
  ON public.notification_queue(user_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nq_content_hash
  ON public.notification_queue(content_hash, created_at DESC)
  WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nq_idempotency
  ON public.notification_queue(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================
-- 2. Notification Preferences
-- ============================================
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text        NOT NULL,
  -- e.g. 'leave_status', 'duty_change', 'license_expiry', 'ope_reminder', etc.
  email      boolean     NOT NULL DEFAULT true,
  push       boolean     NOT NULL DEFAULT true,
  in_app     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, event_type)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own notification preferences"
  ON public.notification_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================
-- 3. Email Logs (audit + dedup)
-- ============================================
CREATE TABLE IF NOT EXISTS public.email_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id      uuid        REFERENCES public.notification_queue(id) ON DELETE SET NULL,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_to      text        NOT NULL,
  subject       text        NOT NULL,
  event_type    text        NOT NULL,
  provider      text        NOT NULL CHECK (provider IN ('resend', 'brevo')),
  provider_id   text,       -- external message ID from provider
  status        text        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'bounced')),
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages email_logs"
  ON public.email_logs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_email_logs_user
  ON public.email_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_logs_event_dedup
  ON public.email_logs(user_id, event_type, created_at DESC);

-- ============================================
-- 4. Add email column to profiles if missing
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'email'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN email text;
  END IF;
END
$$;

-- ============================================
-- 5. Stale job recovery function
-- ============================================
CREATE OR REPLACE FUNCTION public.recover_stale_notification_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  recovered int;
BEGIN
  UPDATE public.notification_queue
  SET status = 'pending',
      next_attempt_at = now()
  WHERE status = 'processing'
    AND processed_at < now() - interval '5 minutes';
  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$;

-- ============================================
-- 6. Move to dead letter function
-- ============================================
CREATE OR REPLACE FUNCTION public.dead_letter_exhausted_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  moved int;
BEGIN
  UPDATE public.notification_queue
  SET status = 'dead_letter'
  WHERE status = 'failed'
    AND attempts >= max_attempts;
  GET DIAGNOSTICS moved = ROW_COUNT;
  RETURN moved;
END;
$$;

-- ============================================
-- 7. Cron schedules
-- ============================================
-- Queue processor: every 2 minutes
INSERT INTO public.sync_jobs (job_name, edge_function_name, cron_schedule, payload) VALUES
  ('process-notification-queue', 'process-notification-queue', '*/2 * * * *', '{}'),
  ('check-duty-changes',        'check-duty-changes',         '0 3 * * *',   '{}')
ON CONFLICT (job_name) DO NOTHING;

-- Stale recovery: every 5 minutes
SELECT cron.schedule(
  'recover-stale-notifications',
  '*/5 * * * *',
  $$SELECT public.recover_stale_notification_jobs()$$
);

-- Dead letter: every 15 minutes
SELECT cron.schedule(
  'dead-letter-notifications',
  '*/15 * * * *',
  $$SELECT public.dead_letter_exhausted_jobs()$$
);

-- Clean old processed queue entries (> 30 days)
SELECT cron.schedule(
  'cleanup-notification-queue',
  '0 4 * * 0',
  $$DELETE FROM public.notification_queue WHERE status IN ('sent', 'dead_letter') AND created_at < now() - interval '30 days'$$
);
