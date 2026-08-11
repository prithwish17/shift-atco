-- ─────────────────────────────────────────────────────────────────────────────
-- OJT progress tracking.
--
-- Child of employee_training_records, keyed (emp_id, unit) because an employee
-- can run more than one OJT cycle at a time in different units (e.g. emp 10003134
-- holds APP+APP(S) 90h from 2025-10-20 and ADC 60h from 2026-06-29 concurrently).
-- employee_training_records is UNIQUE (emp_id) and cannot represent that.
--
-- Central design rule: sheet values and app edits NEVER share a column.
--   sheet_*    written only by the fetch-ojt-data sync
--   override_* written only by the update-ojt-progress edge function
-- Resolution happens at read time in v_ojt_progress_resolved (see the RPC
-- migration) under two policies:
--   start_date       PIN — app value is absolute, sheet never overwrites it
--   everything else  LWW — newest of (override_updated_at, sheet_synced_at) wins
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_ojt_progress (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_id                    TEXT NOT NULL,
  unit                      TEXT NOT NULL,
  employee_name             TEXT NOT NULL,
  designation               TEXT,

  -- ── sheet landing zone ───────────────────────────────────────────────────
  sheet_required_hours      NUMERIC(7,2),
  sheet_required_days       INTEGER,
  sheet_performed_hours     NUMERIC(7,2),   -- decimal hours parsed from HH:MM[:SS]
  sheet_performed_days      INTEGER,
  sheet_start_date          DATE,           -- "Date of start of OJT" (OJT data tab)
  sheet_marking_date        DATE,           -- "Date of marking for OJT"
  sheet_synced_at           TIMESTAMPTZ,
  sync_batch_id             TEXT,

  -- ── app override zone ────────────────────────────────────────────────────
  override_required_hours   NUMERIC(7,2),
  override_required_days    INTEGER,
  override_performed_hours  NUMERIC(7,2),
  override_performed_days   INTEGER,
  override_start_date       DATE,           -- PIN policy: absolute over sheet
  override_updated_at       TIMESTAMPTZ,
  override_updated_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  override_note             TEXT,

  -- ── reserved for the GM (ATM) extension workflow; unused today ───────────
  deadline_override         DATE,
  deadline_override_reason  TEXT,

  profile_linked            BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT employee_ojt_progress_emp_unit_key UNIQUE (emp_id, unit)
);

CREATE INDEX IF NOT EXISTS idx_ojt_progress_emp
  ON public.employee_ojt_progress(emp_id);

CREATE INDEX IF NOT EXISTS idx_ojt_progress_active
  ON public.employee_ojt_progress(unit, employee_name)
  WHERE is_archived = FALSE;

DROP TRIGGER IF EXISTS update_employee_ojt_progress_updated_at ON public.employee_ojt_progress;
CREATE TRIGGER update_employee_ojt_progress_updated_at
  BEFORE UPDATE ON public.employee_ojt_progress
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- "Today" is India time, not UTC. Between 00:00 and 05:30 IST a UTC CURRENT_DATE
-- is still yesterday, which would put days_left off by one for every trainee.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ojt_today()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date;
$$;

GRANT EXECUTE ON FUNCTION public.ojt_today() TO authenticated, service_role;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.employee_ojt_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Employees view own ojt progress" ON public.employee_ojt_progress;
CREATE POLICY "Employees view own ojt progress"
  ON public.employee_ojt_progress FOR SELECT TO authenticated
  USING (
    emp_id = (SELECT employee_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Staff view all ojt progress" ON public.employee_ojt_progress;
CREATE POLICY "Staff view all ojt progress"
  ON public.employee_ojt_progress FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'supervisor')
    OR has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'wso')
  );

-- Writes go through the update-ojt-progress / fetch-ojt-data edge functions so
-- that the sheet landing zone can never be written by a client.
DROP POLICY IF EXISTS "Service role manage ojt progress" ON public.employee_ojt_progress;
CREATE POLICY "Service role manage ojt progress"
  ON public.employee_ojt_progress FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ─── Settings key for the Apps Script web app ────────────────────────────────
INSERT INTO public.app_settings (key, value, label)
VALUES ('ojt_data_webapp_url', '', 'OJT Progress Data Webapp URL')
ON CONFLICT (key) DO NOTHING;
