-- ─────────────────────────────────────────────────────────────────────────────
-- get_daily_availability(p_month) — Server-side daily availability report.
--
-- Replaces 3-5 network roundtrips (schedules + profiles + training records)
-- with a single SQL function returning ~30 pre-computed rows (one per day).
--
-- Replicates the client-side logic from:
--   - supervisorAvailability.ts (rating groups, staffing requirements)
--   - teamDutyRotation.ts (duty code → shift mapping, team rotation)
--
-- Input:  p_month TEXT  e.g. '2026-04'
-- Output: One row per day of the month with availability counts,
--         net vs requirements, and per-shift group breakdowns.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_daily_availability(p_month TEXT)
RETURNS TABLE (
  iso_date        TEXT,
  date_label      TEXT,
  day_label       TEXT,
  avail_m         INTEGER,
  avail_a         INTEGER,
  avail_n         INTEGER,
  net_m           INTEGER,
  net_a           INTEGER,
  net_n           INTEGER,
  shift_m         JSONB,
  shift_a         JSONB,
  shift_n         JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start DATE;
  v_month_end   DATE;
BEGIN
  v_month_start := (p_month || '-01')::DATE;
  v_month_end   := (DATE_TRUNC('month', v_month_start) + INTERVAL '1 month - 1 day')::DATE;

  RETURN QUERY
  WITH
  -- ── 1. Calendar: one row per day in the month ──────────────────────────
  calendar AS (
    SELECT
      d::DATE                              AS cal_date,
      TO_CHAR(d, 'YYYY-MM-DD')            AS iso_dt,
      TO_CHAR(d, 'DD-Mon-YYYY')           AS date_lbl,
      UPPER(TO_CHAR(d, 'DY'))             AS day_lbl
    FROM generate_series(v_month_start, v_month_end, '1 day'::INTERVAL) d
  ),

  -- ── 2. Duty code → shift mapping ──────────────────────────────────────
  -- Replicates getDutyShiftMatches() from teamDutyRotation.ts
  -- Each duty code maps to 0, 1, or 2 shift codes (M, A, N)
  duty_shift_map(code, shift_code) AS (
    VALUES
      ('M',      'M'), ('A',      'A'), ('N',      'N'),
      ('M+A',    'M'), ('M+A',    'A'),
      ('A+M',    'A'), ('A+M',    'M'),
      ('NO+N',   'N'),
      ('CO+N',   'N'), ('CO+A',   'A'), ('CO+M',   'M'),
      ('SUN+N',  'N'), ('SUN+M',  'M'), ('SUN+A',  'A'),
      ('SAT+N',  'N'),
      ('G',      'M')  -- General duty maps to morning
  ),

  -- ── 3. Rating → group mapping ─────────────────────────────────────────
  -- Replicates RATING_GROUPS from supervisorAvailability.ts
  -- Group 1=RSR, 2=ASR, 3=ACC/OCC, 4=ADC/SMC, 5=ALPHA
  rating_group_map(rating_val, grp) AS (
    VALUES
      ('RSR+UBN',       1), ('RSR',           1),
      ('ASR+RSR',       2), ('ASR+APP',       2),
      ('ACC-PLR',       3), ('OCC+ACC-PLR',   3), ('ADC+ACC-PLR',  3),
      ('ACC-PLR+ACC-P', 3), ('ADC+ACC-P',     3), ('ACC-P+OCC',    3),
      ('OCC',           3),
      ('ADC/SMC',       4), ('ADC',           4), ('SMC',          4),
      ('ALPHA',         5)
  ),

  -- ── 4. Staffing requirements per group per shift type ─────────────────
  -- GROUP_SHIFT_MINIMUMS from supervisorAvailability.ts
  -- [morning/afternoon, night]
  requirements(grp, req_ma, req_n) AS (
    VALUES
      (1, 12, 16),   -- RSR
      (2,  4,  4),   -- ASR
      (3, 14, 16),   -- ACC/OCC
      (4,  9,  9),   -- ADC/SMC
      (5, 11, 10)    -- ALPHA
  ),

  -- Total requirements: M=50, A=50, N=55
  total_req AS (
    SELECT
      SUM(req_ma)::INTEGER AS total_ma,
      SUM(req_n)::INTEGER  AS total_n
    FROM requirements
  ),

  -- ── 5. Team rotation logic ────────────────────────────────────────────
  -- Replicates getTeamDutyForDateKey() from teamDutyRotation.ts
  -- 5-day cycle: M(0), A(1), N(2), NO(3), CO(4)
  -- Anchor date: 2026-03-09
  -- Base duties: A→N(2), B→A(1), C→M(0), D→CO(4), E→NO(3)
  team_bases(team_key, base_idx) AS (
    VALUES ('A', 2), ('B', 1), ('C', 0), ('D', 4), ('E', 3)
  ),
  -- For each (date, team) compute the duty code index
  team_duties AS (
    SELECT
      c.cal_date,
      c.iso_dt,
      tb.team_key,
      -- duty_index = (base_idx + days_since_anchor) % 5
      ((tb.base_idx + (c.cal_date - '2026-03-09'::DATE)) % 5 + 5) % 5 AS duty_idx
    FROM calendar c
    CROSS JOIN team_bases tb
  ),
  -- Map duty_idx to shift code for team identification
  -- 0=M, 1=A, 2=N, 3=NO, 4=CO
  team_shift_for_date AS (
    SELECT
      td.cal_date,
      td.iso_dt,
      td.team_key,
      CASE td.duty_idx
        WHEN 0 THEN 'M'
        WHEN 1 THEN 'A'
        WHEN 2 THEN 'N'
        WHEN 3 THEN 'NO'
        WHEN 4 THEN 'CO'
      END AS team_duty
    FROM team_duties td
  ),
  -- Which team is on which shift each day
  shift_team_codes AS (
    SELECT DISTINCT ON (cal_date, team_duty)
      cal_date,
      team_duty AS shift_code,
      team_key
    FROM team_shift_for_date
    WHERE team_duty IN ('M', 'A', 'N')
    ORDER BY cal_date, team_duty, team_key
  ),

  -- ── 6. Schedule data with shift expansion ─────────────────────────────
  -- Join schedules with profiles and training, then expand duty codes to shifts
  raw_schedules AS (
    SELECT
      es.employee_code,
      es.duty_date,
      UPPER(TRIM(es.duty_code)) AS duty_upper,
      COALESCE(UPPER(TRIM(etr.highest_rating)), '') AS rating,
      COALESCE(UPPER(TRIM(p.designation)), '')       AS designation
    FROM public.employee_schedules es
    LEFT JOIN public.profiles p
      ON p.employee_id = es.employee_code
    LEFT JOIN public.employee_training_records etr
      ON etr.emp_id = es.employee_code
    WHERE es.duty_date BETWEEN v_month_start AND v_month_end
      AND COALESCE(p.is_hidden, false) = false
  ),

  -- Expand each schedule row into the shifts it covers
  expanded AS (
    SELECT
      rs.employee_code,
      rs.duty_date,
      dsm.shift_code,
      rs.rating,
      rs.designation
    FROM raw_schedules rs
    JOIN duty_shift_map dsm
      ON dsm.code = rs.duty_upper
  ),

  -- ── 7. Assign rating group to each expanded row ───────────────────────
  grouped AS (
    SELECT
      e.employee_code,
      e.duty_date,
      e.shift_code,
      COALESCE(
        rgm.grp,
        -- Fallback: RSR+ prefix → group 1
        CASE WHEN e.rating LIKE 'RSR+%' THEN 1 ELSE NULL END,
        -- Fallback: designation contains ALPHA → group 5
        CASE WHEN e.designation LIKE '%ALPHA%' THEN 5 ELSE NULL END
      ) AS grp
    FROM expanded e
    LEFT JOIN rating_group_map rgm ON rgm.rating_val = e.rating
  ),

  -- ── 8. Count unique employees per (date, shift, group) ────────────────
  group_counts AS (
    SELECT
      g.duty_date,
      g.shift_code,
      g.grp,
      COUNT(DISTINCT g.employee_code)::INTEGER AS cnt
    FROM grouped g
    WHERE g.grp IS NOT NULL
    GROUP BY g.duty_date, g.shift_code, g.grp
  ),

  -- Also count total unique employees per (date, shift) for the summary columns
  shift_totals AS (
    SELECT
      g.duty_date,
      g.shift_code,
      COUNT(DISTINCT g.employee_code)::INTEGER AS total_avail
    FROM grouped g
    WHERE g.grp IS NOT NULL
    GROUP BY g.duty_date, g.shift_code
  ),

  -- ── 9. Build JSONB breakdown per (date, shift) ────────────────────────
  group_labels(grp, lbl) AS (
    VALUES (1, 'RSR'), (2, 'ASR'), (3, 'ACC/OCC'), (4, 'ADC/SMC'), (5, 'ALPHA')
  ),

  shift_breakdown AS (
    SELECT
      c.cal_date AS duty_date,
      s.shift_code,
      COALESCE(stc.team_key, s.shift_code) AS team_code,
      JSONB_BUILD_OBJECT(
        'teamCode', COALESCE(stc.team_key, s.shift_code),
        'totalAvailable', COALESCE(st.total_avail, 0),
        'totalRequired', CASE s.shift_code WHEN 'N' THEN tr.total_n ELSE tr.total_ma END,
        'net', COALESCE(st.total_avail, 0) - CASE s.shift_code WHEN 'N' THEN tr.total_n ELSE tr.total_ma END,
        'groups', (
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'group', gl.grp,
              'label', gl.lbl,
              'available', COALESCE(gc.cnt, 0),
              'required', CASE s.shift_code WHEN 'N' THEN req.req_n ELSE req.req_ma END,
              'net', COALESCE(gc.cnt, 0) - CASE s.shift_code WHEN 'N' THEN req.req_n ELSE req.req_ma END,
              'colorClass', ''
            ) ORDER BY gl.grp
          )
          FROM group_labels gl
          JOIN requirements req ON req.grp = gl.grp
          LEFT JOIN group_counts gc
            ON gc.duty_date = c.cal_date
            AND gc.shift_code = s.shift_code
            AND gc.grp = gl.grp
        )
      ) AS breakdown
    FROM calendar c
    CROSS JOIN (VALUES ('M'), ('A'), ('N')) AS s(shift_code)
    CROSS JOIN total_req tr
    LEFT JOIN shift_team_codes stc
      ON stc.cal_date = c.cal_date AND stc.shift_code = s.shift_code
    LEFT JOIN shift_totals st
      ON st.duty_date = c.cal_date AND st.shift_code = s.shift_code
  )

  -- ── 10. Final pivot: one row per day ──────────────────────────────────
  SELECT
    c.iso_dt                                                    AS iso_date,
    c.date_lbl                                                  AS date_label,
    c.day_lbl                                                   AS day_label,

    COALESCE(st_m.total_avail, 0)::INTEGER                      AS avail_m,
    COALESCE(st_a.total_avail, 0)::INTEGER                      AS avail_a,
    COALESCE(st_n.total_avail, 0)::INTEGER                      AS avail_n,

    (COALESCE(st_m.total_avail, 0) - tr.total_ma)::INTEGER      AS net_m,
    (COALESCE(st_a.total_avail, 0) - tr.total_ma)::INTEGER      AS net_a,
    (COALESCE(st_n.total_avail, 0) - tr.total_n)::INTEGER       AS net_n,

    COALESCE(sb_m.breakdown, '{}'::JSONB)                       AS shift_m,
    COALESCE(sb_a.breakdown, '{}'::JSONB)                       AS shift_a,
    COALESCE(sb_n.breakdown, '{}'::JSONB)                       AS shift_n

  FROM calendar c
  CROSS JOIN total_req tr
  LEFT JOIN shift_totals st_m ON st_m.duty_date = c.cal_date AND st_m.shift_code = 'M'
  LEFT JOIN shift_totals st_a ON st_a.duty_date = c.cal_date AND st_a.shift_code = 'A'
  LEFT JOIN shift_totals st_n ON st_n.duty_date = c.cal_date AND st_n.shift_code = 'N'
  LEFT JOIN shift_breakdown sb_m ON sb_m.duty_date = c.cal_date AND sb_m.shift_code = 'M'
  LEFT JOIN shift_breakdown sb_a ON sb_a.duty_date = c.cal_date AND sb_a.shift_code = 'A'
  LEFT JOIN shift_breakdown sb_n ON sb_n.duty_date = c.cal_date AND sb_n.shift_code = 'N'
  ORDER BY c.cal_date;
END;
$$;

-- Supervisors and admins can call this function
REVOKE ALL ON FUNCTION public.get_daily_availability(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_daily_availability(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_availability(TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--   SELECT * FROM get_daily_availability('2026-04') LIMIT 5;
-- ─────────────────────────────────────────────────────────────────────────────
