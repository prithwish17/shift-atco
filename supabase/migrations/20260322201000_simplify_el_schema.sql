-- Simplify EL storage to raw leave periods only.
-- days availed and employee totals are now derived in the app from leave_from and leave_to.

ALTER TABLE IF EXISTS public.employee_el_records
  DROP COLUMN IF EXISTS days_availed;

DROP TABLE IF EXISTS public.employee_el_summary;