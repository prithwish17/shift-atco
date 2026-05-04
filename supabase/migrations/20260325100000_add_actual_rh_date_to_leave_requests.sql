-- Add actual_rh_date column to leave_requests
-- Used when an employee applies for RH leave on a different date than the original holiday
ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS actual_rh_date DATE;

COMMENT ON COLUMN leave_requests.actual_rh_date IS
  'The actual Reserved Holiday date this leave is being claimed against. Required for RH leave type.';
