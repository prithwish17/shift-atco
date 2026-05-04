-- Extend employee_leave_records to better represent event-based leave sync payloads.
-- This keeps the existing flat record model for the UI while preserving source event detail
-- for future parsing and reporting improvements.

ALTER TABLE public.employee_leave_records
  ADD COLUMN IF NOT EXISTS source_event_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS event_kind TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS duty_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS raw_date_value TEXT,
  ADD COLUMN IF NOT EXISTS raw_shift_value TEXT,
  ADD COLUMN IF NOT EXISTS raw_event JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.employee_leave_records
SET
  source_event_type = COALESCE(NULLIF(source_event_type, ''), leave_category),
  event_kind = CASE
    WHEN event_kind IS NULL OR event_kind = '' OR event_kind = 'other' THEN
      CASE
        WHEN leave_category IN ('CL', 'RH', 'NH', 'CH') THEN 'leave'
        WHEN leave_category IN ('COMP_OFF', 'COMP_OFF_EARNED', 'LAST_YEAR_CH_DUTY') THEN 'comp_off_earned'
        WHEN leave_category IN ('COMP_OFF_USED', 'LAST_YEAR_COMP_OFF', 'OPE_COMP_OFF') THEN 'comp_off_used'
        WHEN leave_category = 'OPE' THEN 'ope_duty'
        ELSE 'other'
      END
    ELSE event_kind
  END,
  duty_code = COALESCE(NULLIF(duty_code, ''), COALESCE(metadata->>'duty_performed', metadata->>'shift', '')),
  raw_date_value = COALESCE(raw_date_value, leave_date::TEXT),
  raw_shift_value = COALESCE(raw_shift_value, metadata->>'shift'),
  raw_event = CASE
    WHEN raw_event = '{}'::jsonb THEN COALESCE(metadata, '{}'::jsonb)
    ELSE raw_event
  END;

ALTER TABLE public.employee_leave_records
  ALTER COLUMN source_event_type SET NOT NULL,
  ALTER COLUMN event_kind SET NOT NULL;

ALTER TABLE public.employee_leave_records
  DROP CONSTRAINT IF EXISTS employee_leave_records_unique;

ALTER TABLE public.employee_leave_records
  ADD CONSTRAINT employee_leave_records_unique
  UNIQUE (emp_id, leave_category, source_event_type, leave_date, duty_code);

CREATE INDEX IF NOT EXISTS idx_elr_event_type
  ON public.employee_leave_records(source_event_type);

CREATE INDEX IF NOT EXISTS idx_elr_event_kind
  ON public.employee_leave_records(event_kind);

CREATE INDEX IF NOT EXISTS idx_elr_duty_code
  ON public.employee_leave_records(duty_code);
