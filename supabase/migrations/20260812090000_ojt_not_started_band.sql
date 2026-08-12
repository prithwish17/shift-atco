-- ─────────────────────────────────────────────────────────────────────────────
-- OJT progress: the NOT_STARTED band.
--
-- A cycle with zero performed hours has not begun. The sheet still carries a
-- nominal start date for it, and until now that date drove the whole engine:
-- the deadline was counted down, the required burn rate climbed every day the
-- trainee had not appeared, and once it crossed 1 hr/day inside 15 days the row
-- asked a supervisor to take a GM (ATM) extension to a trainee who had never
-- logged an hour.
--
-- NOT_STARTED is now resolved ahead of every other band — including
-- DEADLINE_PASSED — and hours_left, days_left and ratio are suppressed to NULL
-- with it, so nothing downstream can present a countdown against a clock that
-- is not running. requires_gm_extension follows for free: it tests for
-- CRITICAL, which a NOT_STARTED row can no longer be.
--
-- The TypeScript mirror is src/domain/ojt/progress.ts (resolveBand /
-- computeProgress), held in lockstep by the golden-fixture test in
-- src/domain/ojt/__tests__.
--
-- The not_started boolean column is unchanged: it is still the raw
-- "zero hours logged" flag. Trainee Details already filters on it
-- (get_supervisor_trainee_records), so that page needs no change.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_ojt_progress AS
SELECT
  r.*,
  m.required_months,
  d.deadline,
  (r.deadline_override IS NOT NULL)          AS deadline_is_overridden,
  -- Derived figures are withheld from a cycle that has not begun.
  CASE WHEN b.band = 'NOT_STARTED' THEN NULL ELSE h.hours_left END AS hours_left,
  CASE WHEN b.band = 'NOT_STARTED' THEN NULL ELSE h.days_left  END AS days_left,
  CASE WHEN b.band = 'NOT_STARTED' THEN NULL ELSE t.ratio      END AS ratio,
  b.band,
  (COALESCE(r.performed_hours, 0) = 0)       AS not_started,
  (
    r.performed_days IS NOT NULL
    AND r.required_days IS NOT NULL
    AND r.performed_days >= r.required_days
  )                                          AS days_requirement_met,
  (
    b.band = 'CRITICAL'
    AND h.days_left IS NOT NULL
    AND h.days_left < 15
  )                                          AS requires_gm_extension
FROM public.v_ojt_progress_resolved r
CROSS JOIN LATERAL (
  SELECT CASE WHEN r.required_hours IS NULL THEN NULL
              ELSE r.required_hours / 15.0
         END AS required_months
) m
CROSS JOIN LATERAL (
  SELECT CASE
           WHEN r.deadline_override IS NOT NULL THEN r.deadline_override
           WHEN r.start_date IS NULL OR m.required_months IS NULL THEN NULL
           ELSE (
             r.start_date
             + make_interval(
                 months => floor(m.required_months)::int,
                 days   => round((m.required_months - floor(m.required_months)) * 30)::int
               )
             - INTERVAL '1 day'
           )::date
         END AS deadline
) d
CROSS JOIN LATERAL (
  SELECT
    CASE WHEN r.required_hours IS NULL THEN NULL
         ELSE GREATEST(0, r.required_hours - COALESCE(r.performed_hours, 0))
    END AS hours_left,
    CASE WHEN d.deadline IS NULL THEN NULL
         ELSE d.deadline - public.ojt_today()
    END AS days_left
) h
CROSS JOIN LATERAL (
  SELECT CASE WHEN h.days_left IS NULL OR h.days_left <= 0 OR h.hours_left IS NULL THEN NULL
              ELSE h.hours_left / h.days_left::numeric
         END AS ratio
) t
CROSS JOIN LATERAL (
  SELECT CASE
           WHEN COALESCE(r.performed_hours, 0) = 0
                AND COALESCE(r.required_hours, 0) > 0        THEN 'NOT_STARTED'
           WHEN r.start_date IS NULL OR r.required_hours IS NULL THEN 'AWAITING_START_DATE'
           WHEN h.hours_left <= 0                                THEN 'HOURS_COMPLETE'
           WHEN h.days_left IS NULL                              THEN 'AWAITING_START_DATE'
           WHEN h.days_left <= 0                                 THEN 'DEADLINE_PASSED'
           WHEN t.ratio <= 0.4                                   THEN 'ON_TRACK'
           WHEN t.ratio <= 1                                     THEN 'WATCH'
           ELSE 'CRITICAL'
         END AS band
) b;
