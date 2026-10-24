-- ─────────────────────────────────────────────────────────────────────────────
-- Employees hide announcements they have read
--
-- The × on a dashboard announcement stores one row here for that user. The
-- banner leaves out announcements the user has hidden, unless the announcement
-- was edited after they hid it: an updated notice comes back so the change is
-- read. "View all" still lists hidden ones, with "Show again".
--
--   * Each user reads, adds and removes only their own rows.
--   * Rows go when the announcement or the user is deleted.
--
-- See docs/announcements-and-storage-quota.md.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.announcement_dismissals (
  announcement_id  UUID NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  dismissed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_dismissals_user
  ON public.announcement_dismissals (user_id);

ALTER TABLE public.announcement_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own dismissals" ON public.announcement_dismissals;
CREATE POLICY "Users read own dismissals"
  ON public.announcement_dismissals FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users add own dismissals" ON public.announcement_dismissals;
CREATE POLICY "Users add own dismissals"
  ON public.announcement_dismissals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.get_user_role(auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users update own dismissals" ON public.announcement_dismissals;
CREATE POLICY "Users update own dismissals"
  ON public.announcement_dismissals FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users remove own dismissals" ON public.announcement_dismissals;
CREATE POLICY "Users remove own dismissals"
  ON public.announcement_dismissals FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.announcement_dismissals FROM anon, authenticated;
GRANT SELECT, DELETE ON public.announcement_dismissals TO authenticated;
GRANT INSERT (announcement_id, user_id, dismissed_at) ON public.announcement_dismissals TO authenticated;
-- The client upserts (hiding again after an edit refreshes dismissed_at), and
-- PostgREST's upsert sets every column it sends, so all three are updatable.
-- The UPDATE policy still pins user_id to the caller.
GRANT UPDATE (announcement_id, user_id, dismissed_at) ON public.announcement_dismissals TO authenticated;
GRANT ALL ON public.announcement_dismissals TO service_role;
