-- ─────────────────────────────────────────────────────────────────────────────
-- OJT progress: precedence resolution + derived progress + read RPCs.
--
-- The math lives in exactly one SQL place (v_ojt_progress). Neither view is
-- granted to `authenticated`; both RPCs below are SECURITY DEFINER and apply
-- their own authorization, mirroring get_supervisor_trainee_records().
--
-- The TypeScript mirror of this math is src/domain/ojt/progress.ts, held in
-- lockstep by the golden-fixture test in src/domain/ojt/__tests__.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Precedence resolution ────────────────────────────────────────────────
--
--   start_date       PIN — the app value is absolute; the sheet never wins.
--   everything else  LWW — whichever side was written last wins, field by field,
--                    falling back to the other side when the winner is null.
--
DROP VIEW IF EXISTS public.v_ojt_progress CASCADE;
DROP VIEW IF EXISTS public.v_ojt_progress_resolved CASCADE;

CREATE VIEW public.v_ojt_progress_resolved AS
SELECT
  o.id,
  o.emp_id,
  o.unit,
  o.employee_name,
  o.designation,
  o.profile_linked,
  o.is_archived,

  -- PIN: app value is absolute over the sheet.
  COALESCE(o.override_start_date, o.sheet_start_date)          AS start_date,
  CASE
    WHEN o.override_start_date IS NOT NULL THEN 'app'
    WHEN o.sheet_start_date    IS NOT NULL THEN 'sheet'
    ELSE NULL
  END                                                          AS start_date_source,

  -- LWW for the rest.
  CASE WHEN ow.override_is_newer
       THEN COALESCE(o.override_required_hours,  o.sheet_required_hours)
       ELSE COALESCE(o.sheet_required_hours,     o.override_required_hours)
  END                                                          AS required_hours,
  CASE WHEN ow.override_is_newer
       THEN COALESCE(o.override_required_days,   o.sheet_required_days)
       ELSE COALESCE(o.sheet_required_days,      o.override_required_days)
  END                                                          AS required_days,
  CASE WHEN ow.override_is_newer
       THEN COALESCE(o.override_performed_hours, o.sheet_performed_hours)
       ELSE COALESCE(o.sheet_performed_hours,    o.override_performed_hours)
  END                                                          AS performed_hours,
  CASE WHEN ow.override_is_newer
       THEN COALESCE(o.override_performed_days,  o.sheet_performed_days)
       ELSE COALESCE(o.sheet_performed_days,     o.override_performed_days)
  END                                                          AS performed_days,

  o.sheet_marking_date       AS marking_date,
  o.deadline_override,
  o.deadline_override_reason,

  -- Raw sides, so the UI can say "Sheet: 58:30 · you entered 61:00".
  o.sheet_required_hours,
  o.sheet_required_days,
  o.sheet_performed_hours,
  o.sheet_performed_days,
  o.sheet_start_date,
  o.sheet_synced_at,
  o.override_required_hours,
  o.override_required_days,
  o.override_performed_hours,
  o.override_performed_days,
  o.override_start_date,
  o.override_updated_at,
  o.override_updated_by,
  o.override_note,
  ow.override_is_newer
FROM public.employee_ojt_progress o
CROSS JOIN LATERAL (
  SELECT (
    o.override_updated_at IS NOT NULL
    AND (o.sheet_synced_at IS NULL OR o.override_updated_at > o.sheet_synced_at)
  ) AS override_is_newer
) ow;

-- ─── 2. Derived progress ─────────────────────────────────────────────────────
--
--   required_months = required_hours / 15
--   deadline        = start + whole months + round(frac * 30) days − 1 day
--                     (Postgres clamps month arithmetic to month end, matching
--                      the sheet's EDATE; the fractional part is what the sheet
--                      truncates to zero, producing deadlines before the start
--                      date on sub-month cycles. We do not reproduce that bug.)
--   hours_left      = max(0, required − performed)
--   days_left       = deadline − today (IST)
--   ratio           = hours_left / days_left, NULL once days_left <= 0
--
-- Band ordering matters: DEADLINE_PASSED is evaluated before any ratio test,
-- because a negative days_left yields a negative ratio that would otherwise
-- read as "on track".
--
CREATE VIEW public.v_ojt_progress AS
SELECT
  r.*,
  m.required_months,
  d.deadline,
  (r.deadline_override IS NOT NULL)          AS deadline_is_overridden,
  h.hours_left,
  h.days_left,
  t.ratio,
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
           WHEN r.start_date IS NULL OR r.required_hours IS NULL THEN 'AWAITING_START_DATE'
           WHEN h.hours_left <= 0                                THEN 'HOURS_COMPLETE'
           WHEN h.days_left IS NULL                              THEN 'AWAITING_START_DATE'
           WHEN h.days_left <= 0                                 THEN 'DEADLINE_PASSED'
           WHEN t.ratio <= 0.4                                   THEN 'ON_TRACK'
           WHEN t.ratio <= 1                                     THEN 'WATCH'
           ELSE 'CRITICAL'
         END AS band
) b;

REVOKE ALL ON public.v_ojt_progress_resolved FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_ojt_progress          FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ojt_progress_resolved TO service_role;
GRANT SELECT ON public.v_ojt_progress          TO service_role;

-- ─── 3. Supervisor read ──────────────────────────────────────────────────────
-- Dropped rather than replaced: CREATE OR REPLACE cannot change a function's
-- return type, so adding a column to the RETURNS TABLE would fail on re-apply.
DROP FUNCTION IF EXISTS public.get_ojt_progress_records();

CREATE FUNCTION public.get_ojt_progress_records()
RETURNS TABLE (
  emp_id                   TEXT,
  unit                     TEXT,
  employee_name            TEXT,
  designation              TEXT,
  required_hours           DOUBLE PRECISION,
  required_days            INTEGER,
  performed_hours          DOUBLE PRECISION,
  performed_days           INTEGER,
  start_date               TEXT,
  start_date_source        TEXT,
  marking_date             TEXT,
  required_months          DOUBLE PRECISION,
  deadline                 TEXT,
  deadline_is_overridden   BOOLEAN,
  hours_left               DOUBLE PRECISION,
  days_left                INTEGER,
  ratio                    DOUBLE PRECISION,
  band                     TEXT,
  not_started              BOOLEAN,
  days_requirement_met     BOOLEAN,
  requires_gm_extension    BOOLEAN,
  profile_linked           BOOLEAN,
  current_station          TEXT,
  highest_rating           TEXT,
  sheet_required_hours     DOUBLE PRECISION,
  sheet_required_days      INTEGER,
  sheet_performed_hours    DOUBLE PRECISION,
  sheet_performed_days     INTEGER,
  sheet_start_date         TEXT,
  sheet_synced_at          TIMESTAMPTZ,
  -- Raw override values, so the edit dialog can seed its fields from what is
  -- actually overridden. Without these it cannot tell "follows the sheet" from
  -- "overridden to the same value", and saving would silently drop overrides.
  override_required_hours  DOUBLE PRECISION,
  override_required_days   INTEGER,
  override_performed_hours DOUBLE PRECISION,
  override_performed_days  INTEGER,
  override_start_date      TEXT,
  override_updated_at      TIMESTAMPTZ,
  override_updated_by_name TEXT,
  override_note            TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT (
       public.has_role(auth.uid(), 'supervisor')
       OR public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'wso')
     ) THEN
    RAISE EXCEPTION 'Not authorized to read OJT progress records'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    v.emp_id::TEXT,
    v.unit::TEXT,
    v.employee_name::TEXT,
    v.designation::TEXT,
    v.required_hours::DOUBLE PRECISION,
    v.required_days::INTEGER,
    v.performed_hours::DOUBLE PRECISION,
    v.performed_days::INTEGER,
    v.start_date::TEXT,
    v.start_date_source::TEXT,
    v.marking_date::TEXT,
    v.required_months::DOUBLE PRECISION,
    v.deadline::TEXT,
    v.deadline_is_overridden,
    v.hours_left::DOUBLE PRECISION,
    v.days_left::INTEGER,
    v.ratio::DOUBLE PRECISION,
    v.band::TEXT,
    v.not_started,
    v.days_requirement_met,
    v.requires_gm_extension,
    v.profile_linked,
    p.station::TEXT,
    etr.highest_rating::TEXT,
    v.sheet_required_hours::DOUBLE PRECISION,
    v.sheet_required_days::INTEGER,
    v.sheet_performed_hours::DOUBLE PRECISION,
    v.sheet_performed_days::INTEGER,
    v.sheet_start_date::TEXT,
    v.sheet_synced_at,
    v.override_required_hours::DOUBLE PRECISION,
    v.override_required_days::INTEGER,
    v.override_performed_hours::DOUBLE PRECISION,
    v.override_performed_days::INTEGER,
    v.override_start_date::TEXT,
    v.override_updated_at,
    editor.full_name::TEXT,
    v.override_note::TEXT
  FROM public.v_ojt_progress v
  LEFT JOIN public.profiles p
    ON p.employee_id = v.emp_id
  LEFT JOIN public.employee_training_records etr
    ON etr.emp_id = v.emp_id
  LEFT JOIN public.profiles editor
    ON editor.id = v.override_updated_by
  WHERE v.is_archived = FALSE
    AND COALESCE(p.is_hidden, FALSE) = FALSE
  ORDER BY v.employee_name ASC, v.unit ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ojt_progress_records() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ojt_progress_records() TO authenticated, service_role;

-- ─── 4. Employee read — own rows only ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_my_ojt_progress();

CREATE FUNCTION public.get_my_ojt_progress()
RETURNS TABLE (
  emp_id                 TEXT,
  unit                   TEXT,
  employee_name          TEXT,
  designation            TEXT,
  required_hours         DOUBLE PRECISION,
  required_days          INTEGER,
  performed_hours        DOUBLE PRECISION,
  performed_days         INTEGER,
  start_date             TEXT,
  marking_date           TEXT,
  required_months        DOUBLE PRECISION,
  deadline               TEXT,
  hours_left             DOUBLE PRECISION,
  days_left              INTEGER,
  ratio                  DOUBLE PRECISION,
  band                   TEXT,
  not_started            BOOLEAN,
  days_requirement_met   BOOLEAN,
  requires_gm_extension  BOOLEAN,
  sheet_synced_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id TEXT;
BEGIN
  SELECT employee_id INTO v_emp_id
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_emp_id IS NULL OR v_emp_id = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v.emp_id::TEXT,
    v.unit::TEXT,
    v.employee_name::TEXT,
    v.designation::TEXT,
    v.required_hours::DOUBLE PRECISION,
    v.required_days::INTEGER,
    v.performed_hours::DOUBLE PRECISION,
    v.performed_days::INTEGER,
    v.start_date::TEXT,
    v.marking_date::TEXT,
    v.required_months::DOUBLE PRECISION,
    v.deadline::TEXT,
    v.hours_left::DOUBLE PRECISION,
    v.days_left::INTEGER,
    v.ratio::DOUBLE PRECISION,
    v.band::TEXT,
    v.not_started,
    v.days_requirement_met,
    v.requires_gm_extension,
    v.sheet_synced_at
  FROM public.v_ojt_progress v
  WHERE v.emp_id = v_emp_id
    AND v.is_archived = FALSE
  ORDER BY v.unit ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_ojt_progress() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_ojt_progress() TO authenticated, service_role;
