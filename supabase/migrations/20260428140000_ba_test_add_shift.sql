-- Add shift column to ba_test_list so we can track which shift each
-- selection belongs to and apply per-shift expiry rules.

ALTER TABLE public.ba_test_list
  ADD COLUMN IF NOT EXISTS shift text;

-- Index for quick "is this employee selected for today's shift?" lookups
CREATE INDEX IF NOT EXISTS ba_test_list_shift_idx ON public.ba_test_list (shift);
