-- ─────────────────────────────────────────────────────────────────────────────
-- Roster month publication: hold next month's roster back from employees
--
-- The roster sheet syncs a month ahead, so employees used to see next month's
-- duties as soon as they landed — before the roster was final. A supervisor or
-- admin now publishes each future month explicitly.
--
--   * One row per published month (the 1st of the month). No row = not
--     published. Unpublishing deletes the row.
--   * The current month and every earlier month are always visible; only
--     months after the current one wait for a row here.
--   * The gate is applied in the client for employees. WSO, supervisors and
--     admins always see every month, since they build and check the roster.
--   * Purely additive: no existing table, column, policy or function changes,
--     and the schedule/roster syncs keep writing exactly as before.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.roster_month_publications (
  month         DATE PRIMARY KEY
                CHECK (month = date_trunc('month', month)::date),
  published_by  UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.roster_month_publications IS
  'Future roster months a supervisor or admin has released to employees. No row = not published.';

ALTER TABLE public.roster_month_publications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.roster_month_publications FROM anon;
GRANT SELECT, INSERT, DELETE ON public.roster_month_publications TO authenticated;

DROP POLICY IF EXISTS "Authenticated read roster publications" ON public.roster_month_publications;
CREATE POLICY "Authenticated read roster publications"
  ON public.roster_month_publications FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Supervisors and admins publish rosters" ON public.roster_month_publications;
CREATE POLICY "Supervisors and admins publish rosters"
  ON public.roster_month_publications FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'admin'))
    AND published_by = auth.uid()
  );

DROP POLICY IF EXISTS "Supervisors and admins unpublish rosters" ON public.roster_month_publications;
CREATE POLICY "Supervisors and admins unpublish rosters"
  ON public.roster_month_publications FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'admin'));
