-- Faster supervisor trainee list reads via one normalized RPC.

ALTER TABLE public.employee_training_records
  ADD COLUMN IF NOT EXISTS trainee_status TEXT,
  ADD COLUMN IF NOT EXISTS trainee_hr_grade TEXT,
  ADD COLUMN IF NOT EXISTS trainee_preboard_completed_on DATE,
  ADD COLUMN IF NOT EXISTS trainee_preboard_scheduled_on DATE,
  ADD COLUMN IF NOT EXISTS trainee_board_scheduled_on DATE;

CREATE INDEX IF NOT EXISTS idx_training_active_trainees_name
  ON public.employee_training_records(employee_name, emp_id)
  WHERE (trainee_unit IS NOT NULL OR trainee_hours_required IS NOT NULL);

CREATE OR REPLACE FUNCTION public.get_supervisor_trainee_records()
RETURNS TABLE (
  emp_id TEXT,
  name TEXT,
  designation TEXT,
  unit TEXT,
  hours_required INTEGER,
  status TEXT,
  preboard_completed_on TEXT,
  preboard_scheduled_on TEXT,
  board_scheduled_on TEXT,
  highest_rating TEXT,
  current_station TEXT
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
  SELECT
    etr.emp_id::TEXT,
    etr.employee_name::TEXT AS name,
    etr.trainee_designation::TEXT AS designation,
    etr.trainee_unit::TEXT AS unit,
    etr.trainee_hours_required::INTEGER AS hours_required,
    COALESCE(
      NULLIF(etr.trainee_status, ''),
      NULLIF(etr.trainee_hr_grade, ''),
      NULLIF(etr.raw_payload ->> 'trainee_status', '')
    )::TEXT AS status,
    COALESCE(
      etr.trainee_preboard_completed_on::TEXT,
      NULLIF(etr.raw_payload ->> 'trainee_preboard_completed_on', '')
    )::TEXT AS preboard_completed_on,
    COALESCE(
      etr.trainee_preboard_scheduled_on::TEXT,
      NULLIF(etr.raw_payload ->> 'trainee_preboard_scheduled_on', '')
    )::TEXT AS preboard_scheduled_on,
    COALESCE(
      etr.trainee_board_scheduled_on::TEXT,
      NULLIF(etr.raw_payload ->> 'trainee_board_scheduled_on', '')
    )::TEXT AS board_scheduled_on,
    etr.highest_rating::TEXT,
    p.station::TEXT AS current_station
  FROM public.employee_training_records etr
  LEFT JOIN public.profiles p
    ON p.employee_id = etr.emp_id
  WHERE (etr.trainee_unit IS NOT NULL OR etr.trainee_hours_required IS NOT NULL)
    AND COALESCE(p.is_hidden, FALSE) = FALSE
    AND COALESCE(
      NULLIF(etr.trainee_status, ''),
      NULLIF(etr.trainee_hr_grade, ''),
      NULLIF(etr.raw_payload ->> 'trainee_status', '')
    ) IS DISTINCT FROM 'training_completed'
  ORDER BY etr.employee_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_supervisor_trainee_records() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supervisor_trainee_records() TO authenticated, service_role;