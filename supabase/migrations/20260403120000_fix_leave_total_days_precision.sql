-- Change total_days from INTEGER to NUMERIC(4,1) so that half-day leaves (0.5)
-- are stored accurately instead of being silently rounded to 1.
-- All existing whole-number values (1, 2, 3…) cast cleanly to NUMERIC(4,1).

ALTER TABLE public.leave_requests
  ALTER COLUMN total_days TYPE NUMERIC(4,1)
  USING total_days::NUMERIC(4,1);

COMMENT ON COLUMN public.leave_requests.total_days IS
  'Duration in days. Supports 0.5 for half-day leave types (CL_1ST, CL_2ND).';
