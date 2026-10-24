-- ─────────────────────────────────────────────────────────────────────────────
-- Announcements on the employee dashboard
--
-- Supervisors and admins write short announcements that show at the top of
-- /employee until they expire. Managed on /announcements.
--
--   * Title up to 100 characters, body up to 500, so a banner never takes over
--     the page. Long bodies are collapsed to three lines in the UI.
--   * An announcement runs from starts_at (now, or a later date) to expires_at,
--     at most 31 days later. "End now" sets ended_at; the row stays as history.
--   * Approved users read live announcements only. Supervisors and admins read
--     all of them, including scheduled, ended and expired ones.
--   * Admins edit or delete any announcement; supervisors only their own.
--   * Only admins can attach a file. The file lives in R2 under announcements/
--     and is written by /api/storage/announcement-attachment; the trigger below
--     refuses attachment changes from anyone else. Files left behind by deleted
--     announcements are removed by the daily storage reconcile.
--
-- See docs/announcements-and-storage-quota.md.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Table
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.announcements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 100),
  body             TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  priority         TEXT NOT NULL DEFAULT 'info'
                   CHECK (priority IN ('info', 'important', 'urgent')),
  starts_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  attachment_path  TEXT CHECK (attachment_path IS NULL OR attachment_path LIKE 'announcements/%'),
  attachment_meta  JSONB,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT announcements_expiry_window
    CHECK (expires_at > starts_at AND expires_at <= starts_at + interval '31 days')
);

CREATE INDEX IF NOT EXISTS idx_announcements_live
  ON public.announcements (expires_at DESC)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_announcements_created_at
  ON public.announcements (created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Row level security and grants
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Approved users read live announcements" ON public.announcements;
CREATE POLICY "Approved users read live announcements"
  ON public.announcements FOR SELECT
  TO authenticated
  USING (
    public.get_user_role(auth.uid()) IS NOT NULL
    AND ended_at IS NULL
    AND starts_at <= now()
    AND expires_at > now()
  );

DROP POLICY IF EXISTS "Supervisors and admins read all announcements" ON public.announcements;
CREATE POLICY "Supervisors and admins read all announcements"
  ON public.announcements FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'supervisor')
  );

DROP POLICY IF EXISTS "Supervisors and admins create announcements" ON public.announcements;
CREATE POLICY "Supervisors and admins create announcements"
  ON public.announcements FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'supervisor')
    )
  );

DROP POLICY IF EXISTS "Admins and owning supervisors update announcements" ON public.announcements;
CREATE POLICY "Admins and owning supervisors update announcements"
  ON public.announcements FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'supervisor') AND created_by = auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'supervisor') AND created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Admins and owning supervisors delete announcements" ON public.announcements;
CREATE POLICY "Admins and owning supervisors delete announcements"
  ON public.announcements FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (public.has_role(auth.uid(), 'supervisor') AND created_by = auth.uid())
  );

-- anon gets nothing. authenticated writes only the content columns; who wrote
-- it and when is set by the trigger. Attachment columns are writable here but
-- the trigger lets only admins change them.
REVOKE ALL ON public.announcements FROM anon, authenticated;
GRANT SELECT, DELETE ON public.announcements TO authenticated;
GRANT INSERT (title, body, priority, starts_at, expires_at, created_by)
  ON public.announcements TO authenticated;
GRANT UPDATE (title, body, priority, starts_at, expires_at, ended_at, attachment_path, attachment_meta)
  ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Trigger
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.announcements_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_attachment_changed BOOLEAN;
BEGIN
  NEW.title := btrim(NEW.title);
  NEW.body  := btrim(NEW.body);

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.updated_by := NULL;
    v_attachment_changed := NEW.attachment_path IS NOT NULL OR NEW.attachment_meta IS NOT NULL;
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    v_attachment_changed := NEW.attachment_path IS DISTINCT FROM OLD.attachment_path
                         OR NEW.attachment_meta IS DISTINCT FROM OLD.attachment_meta;
  END IF;

  -- Signed-in users go through the API roles; migrations, the SQL editor and
  -- service_role do not and are trusted.
  IF v_attachment_changed
     AND current_user IN ('authenticated', 'anon')
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can add or remove announcement attachments'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS announcements_before_write ON public.announcements;
CREATE TRIGGER announcements_before_write
  BEFORE INSERT OR UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.announcements_before_write();
