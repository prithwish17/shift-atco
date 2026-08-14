-- SARC — issued Annexure-2 statements
--
-- A statement is computed from employee_schedules, employee_training_records
-- and an uploaded IAMATC extract, all of which keep moving. Recomputing the
-- same period six months later will not necessarily reproduce the figures that
-- were issued, so an issued statement is snapshotted here.
--
-- Only the statement itself is stored. The day-by-day working is ~23,000 cells
-- per period and is reproducible from the schedule table, so it stays out.

CREATE TABLE IF NOT EXISTS public.sarc_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,
  title             TEXT NOT NULL,

  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Kept if the account is later deleted: an issued statement must stay
  -- attributable, so the name is denormalised alongside the reference.
  issued_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  issued_by_name    TEXT,

  employee_count    INTEGER NOT NULL DEFAULT 0,
  in_recovery_count INTEGER NOT NULL DEFAULT 0,
  note              TEXT,

  -- One object per employee: emp_id, name, designation, requirement, performed,
  -- performed_source, recovery. Durations are whole seconds, matching the engine.
  rows              JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT sarc_runs_period_ordered CHECK (period_end >= period_start)
);

COMMENT ON TABLE public.sarc_runs IS
  'Snapshots of issued Annexure-2 stress allowance recovery statements.';
COMMENT ON COLUMN public.sarc_runs.rows IS
  'Statement lines. Durations are whole seconds; recovery is a 0-1 fraction.';

CREATE INDEX IF NOT EXISTS sarc_runs_period_idx
  ON public.sarc_runs (period_start DESC, period_end DESC);
CREATE INDEX IF NOT EXISTS sarc_runs_issued_at_idx
  ON public.sarc_runs (issued_at DESC);

ALTER TABLE public.sarc_runs ENABLE ROW LEVEL SECURITY;

-- Read: supervisors and admins. Deliberately not employee-readable — a
-- statement carries every colleague's recovery position, so per-employee
-- access would need a filtered view rather than a row policy on this table.
DROP POLICY IF EXISTS "Supervisors view SARC runs" ON public.sarc_runs;
CREATE POLICY "Supervisors view SARC runs"
  ON public.sarc_runs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'));

-- Insert: supervisors and admins, and only as themselves.
DROP POLICY IF EXISTS "Supervisors issue SARC runs" ON public.sarc_runs;
CREATE POLICY "Supervisors issue SARC runs"
  ON public.sarc_runs FOR INSERT TO authenticated
  WITH CHECK (
    (has_role(auth.uid(), 'supervisor') OR has_role(auth.uid(), 'admin'))
    AND (issued_by IS NULL OR issued_by = auth.uid())
  );

-- No UPDATE policy: an issued statement is a record of what was issued, and
-- amending one in place would defeat the point of snapshotting it. Re-issue
-- instead — the period is not unique, so corrections stack as new rows.

-- Delete: admins only, for genuine mistakes.
DROP POLICY IF EXISTS "Admins delete SARC runs" ON public.sarc_runs;
CREATE POLICY "Admins delete SARC runs"
  ON public.sarc_runs FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));
