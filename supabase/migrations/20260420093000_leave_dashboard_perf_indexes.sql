-- Additive performance indexes for leave dashboards.
-- Safe: does not modify existing schema objects, only adds indexes if missing.

-- employee_leave_records: speed up common dashboard segmentations
CREATE INDEX IF NOT EXISTS idx_elr_source_leave_date
  ON public.employee_leave_records(source, leave_date);

CREATE INDEX IF NOT EXISTS idx_elr_emp_created_at_desc
  ON public.employee_leave_records(emp_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_elr_source_created_at_desc
  ON public.employee_leave_records(source, created_at DESC);

-- employee_el_records: speed up recent EL sync/audit queries (if any UI uses it)
CREATE INDEX IF NOT EXISTS idx_employee_el_records_created_at_desc
  ON public.employee_el_records(created_at DESC);

