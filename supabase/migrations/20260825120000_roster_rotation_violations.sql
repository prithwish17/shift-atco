-- Rotation-based validation for `rosters`.
--
-- The scraper stamps every row of a source tab with that tab's B2 date cell
-- (roster-scraper.gs), so a single mis-typed keystroke there relabels an entire
-- shift onto another day.  Nothing inside the scrape can notice: every row of
-- the tab agrees with every other row.  The 5-day duty rotation is the one check
-- that does not come from the sheet — it fixes which team is on which shift on
-- any given date, so a date wrong by anything other than a multiple of five days
-- makes the (date, shift, team) triple arithmetically impossible.
--
-- This mirrors src/lib/teamDutyRotation.ts and
-- supabase/functions/_shared/dutyRotation.ts.  All three encode the same cycle;
-- change one and the others must follow.
--
-- The view is deliberately read-only.  Nothing here deletes: the rows it lists
-- are audited by a human first, and the sync's own sweep is what removes them
-- going forward.

-- ── Shift label → duty code ──────────────────────────────────────────────────
-- Returns NULL for anything that is not one of the three duty shifts, which is
-- how special rows ("Extra Duty", "Duty Change", "REMARK") stay out of the view.
CREATE OR REPLACE FUNCTION public.roster_shift_code(p_shift TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE UPPER(BTRIM(COALESCE(p_shift, '')))
    WHEN 'MORNING'   THEN 'M'
    WHEN 'M'         THEN 'M'
    WHEN 'AFTERNOON' THEN 'A'
    WHEN 'A'         THEN 'A'
    WHEN 'NIGHT'     THEN 'N'
    WHEN 'N'         THEN 'N'
    ELSE NULL
  END;
$$;

-- ── Team → position in the 5-day cycle on a given date ───────────────────────
-- Returns NULL for teams that do not rotate: "G" (general duty) and anything
-- outside A–E.  Callers must treat NULL as "no opinion", never as a violation —
-- a check that guessed there would condemn good rows.  Team aliases are folded
-- because legacy rows predate the sync's normalisation to single letters.
CREATE OR REPLACE FUNCTION public.roster_team_duty(p_team TEXT, p_date DATE)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  WITH normalised AS (
    SELECT REGEXP_REPLACE(UPPER(BTRIM(COALESCE(p_team, ''))), '^TEAM\s+', '') AS t
  ),
  base AS (
    -- Index into ARRAY['M','A','N','NO','CO'] on 2026-03-09, the rotation anchor.
    SELECT CASE t
      WHEN 'A' THEN 2  WHEN 'ALPHA'   THEN 2   -- N
      WHEN 'B' THEN 1  WHEN 'BRAVO'   THEN 1   -- A
      WHEN 'C' THEN 0  WHEN 'CHARLIE' THEN 0   -- M
      WHEN 'D' THEN 4  WHEN 'DELTA'   THEN 4   -- CO
      WHEN 'E' THEN 3  WHEN 'ECHO'    THEN 3   -- NO
      ELSE NULL
    END AS i
    FROM normalised
  )
  SELECT (ARRAY['M', 'A', 'N', 'NO', 'CO'])[
    ((base.i + ((p_date - DATE '2026-03-09') % 5) + 5) % 5) + 1
  ]
  FROM base
  WHERE base.i IS NOT NULL;
$$;

-- ── The violations ───────────────────────────────────────────────────────────
-- One row per stored duty the rotation says cannot exist.  `rotation_duty` is
-- what that team was actually doing on that date, and `likely_correct_date` is
-- the nearest date on which the row as stored would have been valid — for a
-- mis-typed date cell that is normally the day it belongs to.
CREATE OR REPLACE VIEW public.v_roster_rotation_violations AS
SELECT
  r.id,
  r.date,
  r.shift,
  r.team,
  r.unit,
  r.employee_name,
  r.position,
  public.roster_team_duty(r.team, r.date::DATE) AS rotation_duty,
  (
    -- Nearest, not earliest: the cycle repeats every 5 days, so a ±7 window holds
    -- three valid candidates and MIN() would name the furthest one in the past.
    SELECT window_dates.candidate
    FROM (
      SELECT r.date::DATE + offs AS candidate, ABS(offs) AS distance
      FROM GENERATE_SERIES(-7, 7) AS offs
    ) AS window_dates
    WHERE public.roster_team_duty(r.team, window_dates.candidate)
          = public.roster_shift_code(r.shift)
    ORDER BY window_dates.distance, window_dates.candidate
    LIMIT 1
  ) AS likely_correct_date
FROM public.rosters r
WHERE
  -- Legacy rows in a non-ISO shape cannot be cast to a date; the normalise
  -- migration (20260802000000) is what deals with those, not this view.
  r.date ~ '^\d{4}-\d{2}-\d{2}$'
  AND public.roster_shift_code(r.shift) IS NOT NULL
  AND public.roster_team_duty(r.team, r.date::DATE) IS NOT NULL
  AND public.roster_team_duty(r.team, r.date::DATE) <> public.roster_shift_code(r.shift);

COMMENT ON VIEW public.v_roster_rotation_violations IS
  'Rows in `rosters` whose (date, shift, team) the 5-day duty rotation makes impossible — '
  'almost always a mis-typed date cell on a source spreadsheet tab. Audit before deleting.';

GRANT SELECT ON public.v_roster_rotation_violations TO service_role;
