-- ─────────────────────────────────────────────────────────────────────────────
-- Defensive RLS cleanup for ba_test_list and public.rosters.
--
-- Runs ONLY if the tables already exist (graceful no-op otherwise).
-- This migration is safe to apply multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ba_test_list: recreate policies with canonical service_role pattern ────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ba_test_list'
  ) THEN
    RAISE NOTICE 'ba_test_list does not exist yet — skipping policy update';
    RETURN;
  END IF;

  -- Drop old policies that used auth.role() = 'service_role' (may block inserts)
  DROP POLICY IF EXISTS "ba_test_list_service_write" ON public.ba_test_list;
  DROP POLICY IF EXISTS "ba_test_list_read"          ON public.ba_test_list;
  DROP POLICY IF EXISTS "ba_test_list_staff_manage"  ON public.ba_test_list;

  -- Re-create with canonical TO service_role pattern
  CREATE POLICY "ba_test_list_read"
    ON public.ba_test_list FOR SELECT TO authenticated USING (true);

  CREATE POLICY "ba_test_list_service_write"
    ON public.ba_test_list FOR ALL TO service_role
    USING (true) WITH CHECK (true);

  CREATE POLICY "ba_test_list_staff_manage"
    ON public.ba_test_list FOR ALL TO authenticated
    USING  (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'))
    WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

  RAISE NOTICE 'ba_test_list RLS policies updated';
END $$;

-- ── public.rosters: add explicit service_role policy ─────────────────────────
-- The sync-roster edge function runs under service_role. Without an explicit
-- service_role policy, pg_cron-triggered inserts may be blocked by RLS.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rosters'
  ) THEN
    RAISE NOTICE 'rosters table does not exist — skipping';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "Service role manage rosters" ON public.rosters;

  CREATE POLICY "Service role manage rosters"
    ON public.rosters FOR ALL TO service_role
    USING (true) WITH CHECK (true);

  RAISE NOTICE 'rosters service_role policy added';
END $$;
