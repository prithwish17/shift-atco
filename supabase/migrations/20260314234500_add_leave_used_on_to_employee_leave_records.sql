-- Normalize comp-off usage dates so one earned row can also track when it was used.

ALTER TABLE public.employee_leave_records
  ADD COLUMN IF NOT EXISTS leave_used_on DATE,
  ADD COLUMN IF NOT EXISTS raw_leave_used_value TEXT;

UPDATE public.employee_leave_records
SET raw_leave_used_value = COALESCE(
  raw_leave_used_value,
  NULLIF(BTRIM(raw_event->>'leaveUsedOn'), ''),
  NULLIF(BTRIM(metadata->>'leave_used_on'), ''),
  NULLIF(BTRIM(metadata->>'leave_applied'), '')
)
WHERE raw_leave_used_value IS NULL;

UPDATE public.employee_leave_records
SET leave_used_on = COALESCE(
  employee_leave_records.leave_used_on,
  CASE
    WHEN derived.raw_value ~ '^\d{4}-\d{2}-\d{2}$' THEN derived.raw_value::DATE
    WHEN derived.raw_value ~ '^\d{2}-\d{2}-\d{4}$' THEN TO_DATE(derived.raw_value, 'DD-MM-YYYY')
    WHEN derived.raw_value ~ '^\d{1,2}-[A-Za-z]{3}-\d{4}$' THEN TO_DATE(derived.raw_value, 'DD-Mon-YYYY')
    ELSE NULL
  END
)
FROM (
  SELECT
    id,
    COALESCE(
      NULLIF(BTRIM(raw_leave_used_value), ''),
      NULLIF(BTRIM(raw_event->>'leaveUsedOn'), ''),
      NULLIF(BTRIM(metadata->>'leave_used_on'), ''),
      NULLIF(BTRIM(metadata->>'leave_applied'), '')
    ) AS raw_value
  FROM public.employee_leave_records
) AS derived
WHERE employee_leave_records.id = derived.id
  AND employee_leave_records.leave_used_on IS NULL
  AND derived.raw_value IS NOT NULL;

UPDATE public.employee_leave_records
SET
  leave_used_on = COALESCE(leave_used_on, leave_date),
  raw_leave_used_value = COALESCE(raw_leave_used_value, leave_date::TEXT)
WHERE leave_category IN ('COMP_OFF_USED', 'LAST_YEAR_COMP_OFF', 'OPE_COMP_OFF')
  AND leave_used_on IS NULL;

UPDATE public.employee_leave_records
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
  'source_type', 'FROM_LAST_YEAR',
  'source_label', 'From Last Year'
)
WHERE leave_category = 'LAST_YEAR_CH_DUTY'
  AND COALESCE(NULLIF(BTRIM(metadata->>'source_type'), ''), 'LAST_YEAR_CH_DUTY') = 'LAST_YEAR_CH_DUTY';

UPDATE public.employee_leave_records
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
  'source_type', 'OPE_DUTY',
  'source_label', 'OPE Duty',
  'duty_date', COALESCE(metadata->>'duty_date', metadata->>'ope_duty_date', leave_date::TEXT),
  'duty_performed', COALESCE(NULLIF(BTRIM(metadata->>'duty_performed'), ''), 'OPE'),
  'comp_off_eligible', true,
  'leave_used_on', COALESCE(metadata->>'leave_used_on', metadata->>'leave_applied', raw_leave_used_value),
  'leave_applied', COALESCE(metadata->>'leave_used_on', metadata->>'leave_applied', raw_leave_used_value)
)
WHERE leave_category = 'OPE'
  AND COALESCE(NULLIF(BTRIM(metadata->>'source_type'), ''), 'OPE') = 'OPE';

CREATE INDEX IF NOT EXISTS idx_elr_leave_used_on
  ON public.employee_leave_records(leave_used_on);
