-- ═══════════════════════════════════════════════════════════════════════════
-- Announcements: optional quick demo video
--
-- When demo_video is true the dashboard card plays the quick demo video
-- served from /demo/ (a static file in the app, not R2, so it costs nothing
-- against the storage quota) with a Share button that links to the public
-- /demo page.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS demo_video BOOLEAN NOT NULL DEFAULT false;

GRANT INSERT (demo_video) ON public.announcements TO authenticated;
GRANT UPDATE (demo_video) ON public.announcements TO authenticated;

NOTIFY pgrst, 'reload schema';
