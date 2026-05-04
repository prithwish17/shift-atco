-- Add ch_comp_off_dates JSONB column to leave_requests
-- Stores an array of Closed Holiday dates within the leave range that should earn comp-off credit
-- instead of being deducted from the employee's CL or COMP_OFF balance.
-- Example: [{"date": "2026-04-14", "holiday_name": "Ambedkar Jayanti", "holiday_id": "uuid"}]

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS ch_comp_off_dates JSONB;

COMMENT ON COLUMN leave_requests.ch_comp_off_dates IS
  'Array of Closed Holiday dates within the leave range that earn comp-off credit instead of balance deduction. Only applicable for CL and COMP_OFF leave types.';

-- Protect the new column from being changed after insertion
CREATE OR REPLACE FUNCTION public.protect_leave_request_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.employee_id   IS DISTINCT FROM OLD.employee_id THEN
    RAISE EXCEPTION 'Cannot change employee_id on a leave request';
  END IF;
  IF NEW.leave_type    IS DISTINCT FROM OLD.leave_type THEN
    RAISE EXCEPTION 'Cannot change leave_type on a leave request';
  END IF;
  IF NEW.start_date    IS DISTINCT FROM OLD.start_date THEN
    RAISE EXCEPTION 'Cannot change start_date on a leave request';
  END IF;
  IF NEW.end_date      IS DISTINCT FROM OLD.end_date THEN
    RAISE EXCEPTION 'Cannot change end_date on a leave request';
  END IF;
  IF NEW.total_days    IS DISTINCT FROM OLD.total_days THEN
    RAISE EXCEPTION 'Cannot change total_days on a leave request';
  END IF;
  IF NEW.applied_at    IS DISTINCT FROM OLD.applied_at THEN
    RAISE EXCEPTION 'Cannot change applied_at on a leave request';
  END IF;
  IF NEW.actual_rh_date IS DISTINCT FROM OLD.actual_rh_date THEN
    RAISE EXCEPTION 'Cannot change actual_rh_date on a leave request';
  END IF;
  IF NEW.actual_rh_date_2 IS DISTINCT FROM OLD.actual_rh_date_2 THEN
    RAISE EXCEPTION 'Cannot change actual_rh_date_2 on a leave request';
  END IF;
  IF NEW.ch_comp_off_dates IS DISTINCT FROM OLD.ch_comp_off_dates THEN
    RAISE EXCEPTION 'Cannot change ch_comp_off_dates on a leave request';
  END IF;

  RETURN NEW;
END;
$$;
