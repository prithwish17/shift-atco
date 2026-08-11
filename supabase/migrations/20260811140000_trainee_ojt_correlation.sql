-- ─────────────────────────────────────────────────────────────────────────────
-- Correlate Trainee Details and OJT Progress.
--
-- The two pages track the same people through different lenses: Trainee Details
-- follows pre-board/board milestones, OJT Progress follows hours against a
-- deadline. They were entirely disconnected, so a supervisor could see that a
-- trainee's board was scheduled without seeing they were 40 hours short, or vice
-- versa.
--
-- This joins them in both directions, at the RPC layer only — no rows are copied
-- between employee_training_records and employee_ojt_progress. Each table keeps
-- its own sync as the single writer, so the two feeds can never fight.
--
--   → Trainee Details gains every employee with a live OJT cycle (excluding
--     completed hours and not-yet-started cycles) plus their OJT figures.
--   → OJT Progress gains the trainee milestone status and its date (excluding
--     the generic "Training Ongoing", which carries no information).
--
-- Note the shape mismatch: employee_training_records is UNIQUE (emp_id) while
-- employee_ojt_progress is keyed (emp_id, unit). Where an employee runs more
-- than one live cycle, Trainee Details shows the most pressing one — GM
-- escalation first, then the highest required burn rate, then nearest deadline.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Trainee Details, enriched with OJT and widened to OJT-only trainees ──
DROP FUNCTION IF EXISTS public.get_supervisor_trainee_records();

CREATE FUNCTION public.get_supervisor_trainee_records()
RETURNS TABLE (
  emp_id                    TEXT,
  name                      TEXT,
  designation               TEXT,
  unit                      TEXT,
  hours_required            INTEGER,
  status                    TEXT,
  preboard_completed_on     TEXT,
  preboard_scheduled_on     TEXT,
  board_scheduled_on        TEXT,
  highest_rating            TEXT,
  current_station           TEXT,
  -- OJT correlation
  ojt_unit                  TEXT,
  ojt_start_date            TEXT,
  ojt_deadline              TEXT,
  ojt_hours_left            DOUBLE PRECISION,
  ojt_days_left             INTEGER,
  ojt_ratio                 DOUBLE PRECISION,
  ojt_band                  TEXT,
  ojt_requires_gm_extension BOOLEAN,
  ojt_cycle_count           INTEGER,
  source                    TEXT
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
    RAISE EXCEPTION 'Not authorized to read trainee records'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH
  -- Live OJT cycles: everything except finished hours and cycles with no hours
  -- logged yet. Those two are deliberately out of scope for Trainee Details.
  live_ojt AS (
    SELECT v.*
    FROM public.v_ojt_progress v
    WHERE v.is_archived = FALSE
      AND v.band <> 'HOURS_COMPLETE'
      AND v.not_started = FALSE
  ),
  -- One cycle per employee: the one most at risk.
  ojt_pick AS (
    SELECT DISTINCT ON (l.emp_id)
      l.emp_id, l.unit, l.employee_name, l.designation,
      l.start_date, l.deadline, l.hours_left, l.days_left,
      l.ratio, l.band, l.requires_gm_extension
    FROM live_ojt l
    ORDER BY
      l.emp_id,
      l.requires_gm_extension DESC,
      l.ratio DESC NULLS LAST,
      l.deadline ASC NULLS LAST
  ),
  ojt_counts AS (
    SELECT l.emp_id, count(*)::INTEGER AS cycle_count
    FROM live_ojt l
    GROUP BY l.emp_id
  ),
  -- Existing trainee population.
  trainee AS (
    SELECT
      etr.emp_id,
      etr.employee_name,
      etr.trainee_designation,
      etr.trainee_unit,
      etr.trainee_hours_required,
      COALESCE(
        NULLIF(etr.trainee_status, ''),
        NULLIF(etr.trainee_hr_grade, ''),
        NULLIF(etr.raw_payload ->> 'trainee_status', '')
      ) AS status,
      COALESCE(
        etr.trainee_preboard_completed_on::TEXT,
        NULLIF(etr.raw_payload ->> 'trainee_preboard_completed_on', '')
      ) AS preboard_completed_on,
      COALESCE(
        etr.trainee_preboard_scheduled_on::TEXT,
        NULLIF(etr.raw_payload ->> 'trainee_preboard_scheduled_on', '')
      ) AS preboard_scheduled_on,
      COALESCE(
        etr.trainee_board_scheduled_on::TEXT,
        NULLIF(etr.raw_payload ->> 'trainee_board_scheduled_on', '')
      ) AS board_scheduled_on,
      etr.highest_rating
    FROM public.employee_training_records etr
    WHERE (etr.trainee_unit IS NOT NULL OR etr.trainee_hours_required IS NOT NULL)
      AND COALESCE(
        NULLIF(etr.trainee_status, ''),
        NULLIF(etr.trainee_hr_grade, ''),
        NULLIF(etr.raw_payload ->> 'trainee_status', '')
      ) IS DISTINCT FROM 'training_completed'
  ),
  -- Union of both populations, keyed by employee.
  ids AS (
    SELECT t.emp_id FROM trainee t
    UNION
    SELECT o.emp_id FROM ojt_pick o
  )
  SELECT
    i.emp_id::TEXT,
    COALESCE(t.employee_name, o.employee_name, etr.employee_name, i.emp_id)::TEXT AS name,
    COALESCE(t.trainee_designation, o.designation, p.designation)::TEXT AS designation,
    COALESCE(t.trainee_unit, o.unit)::TEXT AS unit,
    t.trainee_hours_required::INTEGER AS hours_required,
    t.status::TEXT,
    t.preboard_completed_on::TEXT,
    t.preboard_scheduled_on::TEXT,
    t.board_scheduled_on::TEXT,
    COALESCE(t.highest_rating, etr.highest_rating)::TEXT AS highest_rating,
    p.station::TEXT AS current_station,
    o.unit::TEXT AS ojt_unit,
    o.start_date::TEXT AS ojt_start_date,
    o.deadline::TEXT AS ojt_deadline,
    o.hours_left::DOUBLE PRECISION AS ojt_hours_left,
    o.days_left::INTEGER AS ojt_days_left,
    o.ratio::DOUBLE PRECISION AS ojt_ratio,
    o.band::TEXT AS ojt_band,
    COALESCE(o.requires_gm_extension, FALSE) AS ojt_requires_gm_extension,
    COALESCE(c.cycle_count, 0)::INTEGER AS ojt_cycle_count,
    (CASE
       WHEN t.emp_id IS NOT NULL AND o.emp_id IS NOT NULL THEN 'both'
       WHEN t.emp_id IS NOT NULL THEN 'trainee'
       ELSE 'ojt'
     END)::TEXT AS source
  FROM ids i
  LEFT JOIN trainee t     ON t.emp_id = i.emp_id
  LEFT JOIN ojt_pick o    ON o.emp_id = i.emp_id
  LEFT JOIN ojt_counts c  ON c.emp_id = i.emp_id
  LEFT JOIN public.employee_training_records etr ON etr.emp_id = i.emp_id
  LEFT JOIN public.profiles p ON p.employee_id = i.emp_id
  WHERE COALESCE(p.is_hidden, FALSE) = FALSE
  ORDER BY name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_supervisor_trainee_records() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supervisor_trainee_records() TO authenticated, service_role;

-- ─── 2. OJT Progress, enriched with the trainee milestone ────────────────────
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
  override_required_hours  DOUBLE PRECISION,
  override_required_days   INTEGER,
  override_performed_hours DOUBLE PRECISION,
  override_performed_days  INTEGER,
  override_start_date      TEXT,
  override_updated_at      TIMESTAMPTZ,
  override_updated_by_name TEXT,
  override_note            TEXT,
  -- Trainee milestone correlation
  trainee_status           TEXT,
  trainee_status_date      TEXT
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
  WITH milestone AS (
    SELECT
      etr.emp_id,
      -- 'training_continue' is the default "still going" value and says nothing
      -- a supervisor could act on, so it is not surfaced here.
      NULLIF(
        COALESCE(
          NULLIF(etr.trainee_status, ''),
          NULLIF(etr.trainee_hr_grade, ''),
          NULLIF(etr.raw_payload ->> 'trainee_status', '')
        ),
        'training_continue'
      ) AS status,
      COALESCE(
        etr.trainee_preboard_completed_on::TEXT,
        NULLIF(etr.raw_payload ->> 'trainee_preboard_completed_on', '')
      ) AS preboard_completed_on,
      COALESCE(
        etr.trainee_preboard_scheduled_on::TEXT,
        NULLIF(etr.raw_payload ->> 'trainee_preboard_scheduled_on', '')
      ) AS preboard_scheduled_on,
      COALESCE(
        etr.trainee_board_scheduled_on::TEXT,
        NULLIF(etr.raw_payload ->> 'trainee_board_scheduled_on', '')
      ) AS board_scheduled_on
    FROM public.employee_training_records etr
  )
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
    v.override_note::TEXT,
    m.status::TEXT AS trainee_status,
    -- The date that belongs to the status being shown.
    (CASE m.status
       WHEN 'preboard_complete'   THEN m.preboard_completed_on
       WHEN 'preboard_date_fixed' THEN m.preboard_scheduled_on
       WHEN 'board_date_fixed'    THEN m.board_scheduled_on
       ELSE COALESCE(m.board_scheduled_on, m.preboard_scheduled_on, m.preboard_completed_on)
     END)::TEXT AS trainee_status_date
  FROM public.v_ojt_progress v
  LEFT JOIN public.profiles p
    ON p.employee_id = v.emp_id
  LEFT JOIN public.employee_training_records etr
    ON etr.emp_id = v.emp_id
  LEFT JOIN public.profiles editor
    ON editor.id = v.override_updated_by
  LEFT JOIN milestone m
    ON m.emp_id = v.emp_id
  WHERE v.is_archived = FALSE
    AND COALESCE(p.is_hidden, FALSE) = FALSE
  ORDER BY v.employee_name ASC, v.unit ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ojt_progress_records() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ojt_progress_records() TO authenticated, service_role;
