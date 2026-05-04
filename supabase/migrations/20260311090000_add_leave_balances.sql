-- Store cached leave data fetched from Google Apps Script
-- Note: we use a dedicated cache table to avoid conflicts with existing leave_balances schema.

CREATE TABLE IF NOT EXISTS public.leave_balances_cache (
  id bigserial PRIMARY KEY,
  emp_id text NOT NULL,
  name text,
  status text,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_balances_cache_emp_id_key
  ON public.leave_balances_cache (emp_id);

CREATE INDEX IF NOT EXISTS leave_balances_cache_updated_at_idx
  ON public.leave_balances_cache (updated_at DESC);
