-- ─────────────────────────────────────────────────────────────────────────────
-- sync_employee_schedules — lock it down, and make duplicates deterministic.
--
-- A follow-up to 20260920170000_suppress_noop_schedule_sync.sql rather than an
-- edit of it, so it takes effect whether or not that migration has already run.
--
-- 1. Who can call it.
--    `REVOKE ... FROM PUBLIC` is not enough on Supabase: new functions in
--    `public` are granted EXECUTE to `anon` and `authenticated` explicitly, by
--    default privileges, and revoking from PUBLIC leaves those grants in place.
--    With SECURITY DEFINER the function also bypassed RLS, so anyone holding the
--    public anon key could have rewritten every employee's schedule. It is now
--    SECURITY INVOKER — the nightly sync runs as service_role, which bypasses
--    RLS anyway — and EXECUTE is revoked from anon and authenticated by name.
--
-- 2. Which duplicate wins.
--    DISTINCT ON ordered only by its own key keeps an arbitrary row, so a sheet
--    that repeats (employee_code, duty_date) with two duty codes could flip
--    between them from one run to the next — each flip a real write, and the
--    wrong duty on screen half the time. The first occurrence now wins, as it
--    does in fetch-roster and sync-roster. fetch-schedule also drops repeats
--    before batching, so duplicates in different batches agree with this.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_employee_schedules(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_changed INTEGER;
BEGIN
  INSERT INTO public.employee_schedules
    (employee_code, employee_name, duty_date, duty_code, duty_description)
  SELECT DISTINCT ON (r.employee_code, r.duty_date)
    r.employee_code,
    r.employee_name,
    r.duty_date,
    COALESCE(r.duty_code, ''),
    COALESCE(r.duty_description, '')
  FROM ROWS FROM (
    jsonb_to_recordset(p_rows) AS (
      employee_code    TEXT,
      employee_name    TEXT,
      duty_date        DATE,
      duty_code        TEXT,
      duty_description TEXT
    )
  ) WITH ORDINALITY AS r(employee_code, employee_name, duty_date, duty_code, duty_description, ord)
  WHERE r.employee_code IS NOT NULL
    AND r.employee_name IS NOT NULL
    AND r.duty_date     IS NOT NULL
  ORDER BY r.employee_code, r.duty_date, r.ord
  ON CONFLICT (employee_code, duty_date) DO UPDATE
  SET employee_name    = EXCLUDED.employee_name,
      duty_code        = EXCLUDED.duty_code,
      duty_description = EXCLUDED.duty_description
  WHERE employee_schedules.employee_name    IS DISTINCT FROM EXCLUDED.employee_name
     OR employee_schedules.duty_code        IS DISTINCT FROM EXCLUDED.duty_code
     OR employee_schedules.duty_description IS DISTINCT FROM EXCLUDED.duty_description;

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

COMMENT ON FUNCTION public.sync_employee_schedules(JSONB) IS
  'Batch upsert for fetch-schedule that skips rows whose values are unchanged; the first of any duplicate wins. Returns rows actually written. service_role only.';

REVOKE ALL ON FUNCTION public.sync_employee_schedules(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_employee_schedules(JSONB) TO service_role;
