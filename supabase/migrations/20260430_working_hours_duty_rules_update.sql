-- ─────────────────────────────────────────────────────────────────────────────
-- Duty Hours Rules Update — April 30, 2026
--
-- Updates working hours system with new duty period limits:
-- - Remove 15-day limit (was 130h)
-- - Update 7-day limit: 48 hours (was 60)
-- - Update 30-day limit: 190 hours (was 200)
-- - Add consecutive duty days tracking (max 6 days, min 48h rest)
--
-- Components:
--   1. Update working_hours_cache table schema
--   2. Update get_working_hours_summary() with new limits + consecutive duty
--   3. Update refresh_working_hours_cache() function
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Update cache table schema ──────────────────────────────────────────────

-- Add consecutive duty columns if not exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'working_hours_cache' AND column_name = 'max_streak'
  ) THEN
    ALTER TABLE public.working_hours_cache ADD COLUMN max_streak INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'working_hours_cache' AND column_name = 'streak_violation'
  ) THEN
    ALTER TABLE public.working_hours_cache ADD COLUMN streak_violation BOOLEAN DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'working_hours_cache' AND column_name = 'rest_violations'
  ) THEN
    ALTER TABLE public.working_hours_cache ADD COLUMN rest_violations JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- Remove peak_15d columns (no longer needed)
ALTER TABLE public.working_hours_cache 
  DROP COLUMN IF EXISTS peak_15d_hours,
  DROP COLUMN IF EXISTS peak_15d_breached;

-- Create index for streak violations
CREATE INDEX IF NOT EXISTS idx_whc_streak_violation 
  ON public.working_hours_cache (streak_violation) 
  WHERE streak_violation = true;

-- ── 2. Updated get_working_hours_summary() ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_working_hours_summary(p_month TEXT)
RETURNS TABLE (
  employee_code    TEXT,
  employee_name    TEXT,
  current_shift    TEXT,
  total_hours      INTEGER,
  days_worked      INTEGER,
  avg_per_day      NUMERIC(4,1),
  peak_7d_hours    INTEGER,
  peak_30d_hours   INTEGER,
  peak_7d_breached BOOLEAN,
  peak_30d_breached BOOLEAN,
  max_streak       INTEGER,
  streak_violation BOOLEAN,
  rest_violations  JSONB,
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

  -- ── 6. Sliding-window peak calculations (7/30 day only) ─────────────────
  emp_list AS (
    SELECT DISTINCT emp_code FROM emp_dates
  ),
  calendar AS (
    SELECT d::DATE AS cal_date
    FROM generate_series(v_query_start, v_query_end, '1 day'::INTERVAL) d
  ),
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
  windowed AS (
    SELECT
      emp_code,
      cal_date,
      SUM(hrs) OVER (PARTITION BY emp_code ORDER BY cal_date ROWS BETWEEN CURRENT ROW AND 6 FOLLOWING)  AS w7,
      SUM(hrs) OVER (PARTITION BY emp_code ORDER BY cal_date ROWS BETWEEN CURRENT ROW AND 29 FOLLOWING) AS w30
    FROM dense
  ),
  peaks AS (
    SELECT
      emp_code,
      MAX(w7)::INTEGER  AS peak_7,
      MAX(w30)::INTEGER AS peak_30
    FROM windowed
    GROUP BY emp_code
  ),

  -- ── 7. Consecutive duty days calculation ────────────────────────────────
  -- Build daily hours for each employee to detect streaks
  daily_hours AS (
    SELECT
      emp_code,
      cal_date,
      COALESCE(ed.duty_hours, 0) AS hrs
    FROM emp_list el
    CROSS JOIN calendar c
    LEFT JOIN emp_dates ed
      ON ed.emp_code = el.emp_code
      AND ed.duty_date = c.cal_date
    ORDER BY emp_code, cal_date
  ),
  -- Detect streaks using window functions
  streaks AS (
    SELECT
      emp_code,
      cal_date,
      hrs,
      -- Create groups by detecting when a working day starts a new streak
      -- (either first day, or previous day had 0 hours)
      SUM(CASE WHEN hrs > 0 AND LAG(hrs, 1, 0) OVER (PARTITION BY emp_code ORDER BY cal_date) = 0 THEN 1 ELSE 0 END) 
        OVER (PARTITION BY emp_code ORDER BY cal_date) AS streak_group
    FROM daily_hours
  ),
  -- Calculate streak lengths
  streak_lengths AS (
    SELECT
      emp_code,
      streak_group,
      COUNT(*) FILTER (WHERE hrs > 0) AS streak_length,
      MIN(cal_date) FILTER (WHERE hrs > 0) AS streak_start,
      MAX(cal_date) FILTER (WHERE hrs > 0) AS streak_end
    FROM streaks
    WHERE hrs > 0
    GROUP BY emp_code, streak_group
  ),
  -- Aggregate consecutive duty stats per employee
  consecutive_stats AS (
    SELECT
      emp_code,
      COALESCE(MAX(streak_length), 0) AS max_streak,
      COALESCE(MAX(streak_length), 0) > 6 AS streak_violation,
      JSONB_AGG(
        CASE 
          WHEN streak_length >= 6 THEN
            JSONB_BUILD_OBJECT(
              'startDate', TO_CHAR(streak_start, 'YYYY-MM-DD'),
              'endDate', TO_CHAR(streak_end, 'YYYY-MM-DD'),
              'streakLength', streak_length
            )
          ELSE NULL
        END
        ORDER BY streak_start
      ) FILTER (WHERE streak_length >= 6) AS rest_violations
    FROM streak_lengths
    GROUP BY emp_code
  )

  -- ── 8. Final result ────────────────────────────────────────────────────
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
    COALESCE(pk.peak_30, 0)::INTEGER                  AS peak_30d_hours,
    COALESCE(pk.peak_7,  0) > 48                      AS peak_7d_breached,
    COALESCE(pk.peak_30, 0) > 190                     AS peak_30d_breached,
    COALESCE(cs.max_streak, 0)::INTEGER               AS max_streak,
    COALESCE(cs.streak_violation, false)              AS streak_violation,
    COALESCE(cs.rest_violations, '[]'::JSONB)         AS rest_violations,
    COALESCE(dj.schedule, '[]'::JSONB)                AS daily_schedule
  FROM (
    SELECT DISTINCT ON (emp_code) emp_code, emp_name, shift
    FROM emp_dates
    ORDER BY emp_code, duty_date DESC
  ) ed
  LEFT JOIN month_agg         ma ON ma.emp_code = ed.emp_code
  LEFT JOIN peaks             pk ON pk.emp_code = ed.emp_code
  LEFT JOIN consecutive_stats cs ON cs.emp_code = ed.emp_code
  LEFT JOIN daily_json        dj ON dj.emp_code = ed.emp_code
  ORDER BY ed.emp_name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_working_hours_summary(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_working_hours_summary(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_working_hours_summary(TEXT) TO service_role;

-- ── 3. Updated refresh_working_hours_cache() ────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_working_hours_cache(p_month TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_now   timestamptz := now();
  rec     record;
BEGIN
  -- Call the updated RPC and upsert each row
  FOR rec IN
    SELECT * FROM public.get_working_hours_summary(p_month)
  LOOP
    INSERT INTO public.working_hours_cache (
      month, employee_code, employee_name, current_shift,
      total_hours, days_worked, avg_per_day,
      peak_7d_hours, peak_30d_hours,
      peak_7d_breached, peak_30d_breached,
      max_streak, streak_violation, rest_violations,
      daily_schedule, computed_at
    ) VALUES (
      p_month, rec.employee_code, rec.employee_name, rec.current_shift,
      rec.total_hours, rec.days_worked, rec.avg_per_day,
      rec.peak_7d_hours, rec.peak_30d_hours,
      rec.peak_7d_breached, rec.peak_30d_breached,
      rec.max_streak, rec.streak_violation, rec.rest_violations,
      rec.daily_schedule, v_now
    )
    ON CONFLICT (month, employee_code) DO UPDATE SET
      employee_name     = EXCLUDED.employee_name,
      current_shift     = EXCLUDED.current_shift,
      total_hours       = EXCLUDED.total_hours,
      days_worked       = EXCLUDED.days_worked,
      avg_per_day       = EXCLUDED.avg_per_day,
      peak_7d_hours     = EXCLUDED.peak_7d_hours,
      peak_30d_hours    = EXCLUDED.peak_30d_hours,
      peak_7d_breached  = EXCLUDED.peak_7d_breached,
      peak_30d_breached = EXCLUDED.peak_30d_breached,
      max_streak        = EXCLUDED.max_streak,
      streak_violation  = EXCLUDED.streak_violation,
      rest_violations   = EXCLUDED.rest_violations,
      daily_schedule    = EXCLUDED.daily_schedule,
      computed_at       = EXCLUDED.computed_at;

    v_count := v_count + 1;
  END LOOP;

  -- Remove cache entries for employees no longer in the RPC result
  DELETE FROM public.working_hours_cache
  WHERE month = p_month
    AND employee_code NOT IN (
      SELECT whs.employee_code
      FROM public.get_working_hours_summary(p_month) whs
    );

  RETURN jsonb_build_object(
    'month',          p_month,
    'rows_refreshed', v_count,
    'computed_at',    v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_working_hours_cache(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_working_hours_cache(TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification:
--
--   -- Check updated schema:
--   SELECT column_name, data_type 
--   FROM information_schema.columns 
--   WHERE table_name = 'working_hours_cache' 
--   ORDER BY ordinal_position;
--
--   -- Test updated function:
--   SELECT * FROM get_working_hours_summary('2026-04') LIMIT 5;
--
--   -- Test cache refresh:
--   SELECT refresh_working_hours_cache('2026-04');
--
--   -- Verify cache was populated:
--   SELECT month, employee_code, total_hours, max_streak, streak_violation, computed_at
--   FROM working_hours_cache WHERE month = '2026-04' LIMIT 5;
-- ─────────────────────────────────────────────────────────────────────────────
