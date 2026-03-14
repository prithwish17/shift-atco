-- Speed up employee leave-summary reads by indexing the common employee-scoped lookup path.
-- Employee pages now query employee_leave_records with emp_id filtering instead of scanning
-- the full table client-side.

CREATE INDEX IF NOT EXISTS idx_elr_emp_id_leave_dates
  ON public.employee_leave_records (emp_id, leave_date DESC, leave_used_on DESC);
