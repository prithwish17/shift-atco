-- Keep roster teams canonical and prevent one team's row colliding with another's.
UPDATE public.rosters
SET team = CASE regexp_replace(upper(trim(team)), '^TEAM\s+', '')
  WHEN 'ALPHA' THEN 'A'
  WHEN 'BRAVO' THEN 'B'
  WHEN 'CHARLIE' THEN 'C'
  WHEN 'DELTA' THEN 'D'
  WHEN 'ECHO' THEN 'E'
  WHEN 'GENERAL' THEN 'G'
  ELSE regexp_replace(upper(trim(team)), '^TEAM\s+', '')
END
WHERE team IS NOT NULL;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY date, shift, team, employee_name, unit, position
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.rosters
)
DELETE FROM public.rosters r
USING ranked
WHERE r.id = ranked.id
  AND ranked.rn > 1;

ALTER TABLE public.rosters
  DROP CONSTRAINT IF EXISTS rosters_date_shift_employee_name_unit_position_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'rosters_date_shift_team_employee_name_unit_position_key'
      AND conrelid = 'public.rosters'::regclass
  ) THEN
    ALTER TABLE public.rosters
      ADD CONSTRAINT rosters_date_shift_team_employee_name_unit_position_key
      UNIQUE (date, shift, team, employee_name, unit, position);
  END IF;
END $$;
