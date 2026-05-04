-- Add actual_rh_date_2 column to leave_requests
-- Allows employees to claim against a second Restricted Holiday date in a single RH leave request
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS actual_rh_date_2 DATE;

COMMENT ON COLUMN leave_requests.actual_rh_date_2 IS
  'Optional second Restricted Holiday date this leave is claimed against. Used when an RH leave request covers two restricted holidays.';

-- Protect the new column from being changed after insertion (match existing immutable-fields trigger)
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

  RETURN NEW;
END;
$$;
