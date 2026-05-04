ALTER TABLE public.ba_tests
ADD COLUMN IF NOT EXISTS team_code TEXT;

CREATE INDEX IF NOT EXISTS idx_ba_tests_date_team_code
ON public.ba_tests(test_date, team_code);