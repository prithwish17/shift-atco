-- Add team column to ba_test_list so the employee page can show which team
-- the published BA test list belongs to. The BAT_REPORT feed already sends
-- it as a top-level "team" field (e.g. "D"); rows fetched before this column
-- existed stay NULL.

ALTER TABLE public.ba_test_list
  ADD COLUMN IF NOT EXISTS team text;

COMMENT ON COLUMN public.ba_test_list.team IS
  'Team the BA test selection was drawn from, as published in the BAT_REPORT banner.';
