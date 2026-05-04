-- ─────────────────────────────────────────────────────────────────────────────
-- get_working_hours_summary(p_month) — Server-side Working Hours aggregation.
--
-- Replaces 18+ paginated client requests + heavy JavaScript peak-window
-- calculations with a single SQL function returning ~200 pre-computed rows.
--
-- Input:  p_month TEXT  e.g. '2026-04'
-- Output: One row per (non-hidden) employee with:
--   - Month-only aggregates: total_hours, days_worked, avg_per_day
--   - Sliding-window peaks:  peak_7d, peak_15d, peak_30d (+ breach flags)
--   - Daily schedule JSONB:  [{date, duty_code, hours}, ...] for the month
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_working_hours_summary(p_month TEXT)
RETURNS TABLE (
  employee_code    TEXT,
  employee_name    TEXT,
  current_shift    TEXT,
  total_hours      INTEGER,
  days_worked      INTEGER,
  avg_per_day      NUMERIC(4,1),
  peak_7d_hours    INTEGER,
  peak_15d_hours   INTEGER,
  peak_30d_hours   INTEGER,
  peak_7d_breached BOOLEAN,
  peak_15d_breached BOOLEAN,
  peak_30d_breached BOOLEAN,
  daily_schedule   JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start DATE;
  v_month_end   DATE;
  v_query_start DATE;
  v_query_end   DATE;
BEGIN
  -- Derive date bounds from p_month (e.g. '2026-04' → 2026-04-01 .. 2026-04-30).
  v_month_start := (p_month || '-01')::DATE;
  v_month_end   := (DATE_TRUNC('month', v_month_start) + INTERVAL '1 month - 1 day')::DATE;
  -- Extended range: ±29 days for accurate 30-day sliding-window peaks.
  v_query_start := v_month_start - 29;
  v_query_end   := v_month_end   + 29;

  RETURN QUERY
  WITH
  -- ── 1. Duty code → hours mapping ────────────────────────────────────────
  -- Replicate the same mapping from the frontend DUTY_HOURS_MAP constant.
  duty_map(code, hrs) AS (
    VALUES
      ('M',6),('A',6),('N',6),('NO',6),
      ('G',8),('GO',8),
      ('M+A',12),('A+M',12),('NO+N',12),
      ('CO+N',6),('CO+A',6),('CO+M',6),
      ('SAT+NO',7),('SAT+N',5),
      ('SUN+N',5),('SUN+M',6),('SUN+A',6),('SUN+NO',7),
      -- Zero-hour codes (explicitly listed so the LEFT JOIN returns 0):
      ('CO',0),('SL',0),('Tr',0),('T',0),('CH',0),('NH',0),
      ('SAT',0),('SUN',0),('NA',0),('LEAVE',0),('L',0)
  ),

  -- ── 2. All schedules in extended range, joined with profile + hours ─────
  extended AS (
    SELECT
      es.employee_code  AS emp_code,
      COALESCE(p.full_name, es.employee_name) AS emp_name,
      COALESCE(p.current_shift::TEXT, '—')          AS shift,
      es.duty_date,
      es.duty_code,
      COALESCE(dm.hrs, dmu.hrs, 0)            AS duty_hours
    FROM public.employee_schedules es
    LEFT JOIN public.profiles p
      ON p.employee_id = es.employee_code
    LEFT JOIN duty_map dm
      ON dm.code = TRIM(es.duty_code)
    LEFT JOIN duty_map dmu
      ON dmu.code = UPPER(TRIM(es.duty_code))
    WHERE es.duty_date BETWEEN v_query_start AND v_query_end
      AND COALESCE(p.is_hidden, false) = false
  ),

  -- ── 3. Per-employee: list of all (date, hours) in extended range ─────────
  emp_dates AS (
    SELECT emp_code, emp_name, shift, duty_date, duty_hours
    FROM extended
  ),

  -- ── 4. Month-only aggregates ────────────────────────────────────────────
  month_agg AS (
    SELECT
      emp_code,
      SUM(duty_hours)::INTEGER                           AS total_hours,
      COUNT(*) FILTER (WHERE duty_hours > 0)::INTEGER    AS days_worked
    FROM emp_dates
    WHERE duty_date BETWEEN v_month_start AND v_month_end
    GROUP BY emp_code
  ),

  -- ── 5. Daily schedule JSONB for the selected month ──────────────────────
  daily_json AS (
    SELECT
      emp_code,
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'date', TO_CHAR(duty_date, 'YYYY-MM-DD'),
          'duty_code', duty_code,
          'hours', duty_hours
        )
        ORDER BY duty_date
      ) AS schedule
    FROM extended
    WHERE duty_date BETWEEN v_month_start AND v_month_end
    GROUP BY emp_code
  ),

  -- ── 6. Sliding-window peak calculations ─────────────────────────────────
  -- Generate a calendar series for every day in the extended range,
  -- cross-join with each employee, then sum hours in windows of 7/15/30.
  --
  -- Strategy: For each employee, build a dense date→hours lookup,
  -- then use generate_series as window starts and SUM over each window.
  emp_list AS (
    SELECT DISTINCT emp_code FROM emp_dates
  ),
  calendar AS (
    SELECT d::DATE AS cal_date
    FROM generate_series(v_query_start, v_query_end, '1 day'::INTERVAL) d
  ),
  -- Dense grid: every (employee, date) with hours (0 if no schedule row)
  dense AS (
    SELECT
      el.emp_code,
      c.cal_date,
      COALESCE(ed.duty_hours, 0) AS hrs
    FROM emp_list el
    CROSS JOIN calendar c
    LEFT JOIN emp_dates ed
      ON ed.emp_code = el.emp_code
      AND ed.duty_date = c.cal_date
  ),
  -- Step 1: Compute per-day windowed sums (7/15/30-day rolling windows).
  windowed AS (
    SELECT
      emp_code,
      cal_date,
      SUM(hrs) OVER (PARTITION BY emp_code ORDER BY cal_date ROWS BETWEEN CURRENT ROW AND 6 FOLLOWING)  AS w7,
      SUM(hrs) OVER (PARTITION BY emp_code ORDER BY cal_date ROWS BETWEEN CURRENT ROW AND 14 FOLLOWING) AS w15,
      SUM(hrs) OVER (PARTITION BY emp_code ORDER BY cal_date ROWS BETWEEN CURRENT ROW AND 29 FOLLOWING) AS w30
    FROM dense
  ),
  -- Step 2: Get the peak (max) for each employee across all window starts.
  peaks AS (
    SELECT
      emp_code,
      MAX(w7)::INTEGER  AS peak_7,
      MAX(w15)::INTEGER AS peak_15,
      MAX(w30)::INTEGER AS peak_30
    FROM windowed
    GROUP BY emp_code
  )

  -- ── 7. Final result ─────────────────────────────────────────────────────
  SELECT
    ed.emp_code                                       AS employee_code,
    ed.emp_name                                       AS employee_name,
    ed.shift                                          AS current_shift,
    COALESCE(ma.total_hours, 0)                       AS total_hours,
    COALESCE(ma.days_worked, 0)                       AS days_worked,
    CASE
      WHEN COALESCE(ma.days_worked, 0) > 0
      THEN ROUND(ma.total_hours::NUMERIC / ma.days_worked, 1)
      ELSE 0
    END                                               AS avg_per_day,
    COALESCE(pk.peak_7,  0)::INTEGER                  AS peak_7d_hours,
    COALESCE(pk.peak_15, 0)::INTEGER                  AS peak_15d_hours,
    COALESCE(pk.peak_30, 0)::INTEGER                  AS peak_30d_hours,
    COALESCE(pk.peak_7,  0) > 60                      AS peak_7d_breached,
    COALESCE(pk.peak_15, 0) > 130                     AS peak_15d_breached,
    COALESCE(pk.peak_30, 0) > 200                     AS peak_30d_breached,
    COALESCE(dj.schedule, '[]'::JSONB)                AS daily_schedule
  FROM (
    SELECT DISTINCT ON (emp_code) emp_code, emp_name, shift
    FROM emp_dates
    ORDER BY emp_code, duty_date DESC
  ) ed
  LEFT JOIN month_agg  ma ON ma.emp_code = ed.emp_code
  LEFT JOIN peaks      pk ON pk.emp_code = ed.emp_code
  LEFT JOIN daily_json dj ON dj.emp_code = ed.emp_code
  ORDER BY ed.emp_name;
END;
$$;

-- Supervisors and admins can call this function.
REVOKE ALL ON FUNCTION public.get_working_hours_summary(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_working_hours_summary(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_working_hours_summary(TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--   SELECT * FROM get_working_hours_summary('2026-04') LIMIT 5;
-- ─────────────────────────────────────────────────────────────────────────────
