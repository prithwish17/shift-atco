-- ─────────────────────────────────────────────────────────────────────────────
-- Earned Leave (EL) records synced from external webapp
-- Stores per-employee EL periods only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_el_records (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  emp_id          text        NOT NULL,
  employee_name   text        NOT NULL,
  leave_from      date        NOT NULL,
  leave_to        date        NOT NULL,
  sync_batch_id   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_el_records_pkey PRIMARY KEY (id),
  CONSTRAINT employee_el_records_unique UNIQUE (emp_id, leave_from, leave_to)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_el_records_emp_id ON public.employee_el_records(emp_id);

-- RLS
ALTER TABLE public.employee_el_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read employee_el_records" ON public.employee_el_records
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Service role write employee_el_records" ON public.employee_el_records
  FOR ALL USING (true);
