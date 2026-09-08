-- ─────────────────────────────────────────────────────────────────────────────
-- BA Test List — main vs standby
--
-- The randomiser's BAT_REPORT tab now publishes two selections per shift: the
-- compulsory MAIN list and a STANDBY list that is only called on if someone on
-- the main list is unavailable. Both are stored in ba_test_list; this column is
-- what tells them apart.
--
-- Existing rows are all main-list selections, hence the default.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.ba_test_list
  ADD COLUMN IF NOT EXISTS list_type text NOT NULL DEFAULT 'MAIN';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ba_test_list'::regclass
      AND conname  = 'ba_test_list_list_type_check'
  ) THEN
    ALTER TABLE public.ba_test_list
      ADD CONSTRAINT ba_test_list_list_type_check
      CHECK (list_type IN ('MAIN', 'STANDBY'));
  END IF;
END $$;

-- The employee pages ask "which list am I on today?", so date + type together.
CREATE INDEX IF NOT EXISTS ba_test_list_date_type_idx
  ON public.ba_test_list (test_date, list_type);

COMMENT ON COLUMN public.ba_test_list.list_type IS
  'MAIN = compulsory selection, STANDBY = reserve list for the same shift.';
