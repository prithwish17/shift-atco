-- Fix duty_rosters unique constraint to include team
-- Previously: UNIQUE(roster_date, shift) — only one roster per date+shift
-- Now: UNIQUE(roster_date, shift, team) — one roster per date+shift+team

-- Drop old constraint
ALTER TABLE public.duty_rosters DROP CONSTRAINT IF EXISTS duty_rosters_roster_date_shift_key;

-- Add new constraint
ALTER TABLE public.duty_rosters ADD CONSTRAINT duty_rosters_roster_date_shift_team_key UNIQUE (roster_date, shift, team);
