-- ─────────────────────────────────────────────────────────────────────────────
-- sync_employee_schedules — write only the rows that actually changed.
--
-- fetch-schedule re-fetches the whole roster from Apps Script every night and
-- pushed all ~84k rows back through PostgREST `.upsert()`.  `ON CONFLICT DO
-- UPDATE` writes a new row version unconditionally — identical values still
-- cost a heap tuple, an entry in every index, the WAL for both, and a dead
-- tuple for autovacuum to clean up later.  Two of the indexes on this table are
-- GIN trigram, the most write-expensive kind there is, and the
-- update_employee_schedules_updated_at trigger bumps updated_at on every row,
-- so no update could ever take the cheap HOT path.
--
-- One nightly run therefore rewrote the entire table and roughly half a million
-- index entries to record the handful of duty changes a published roster
-- actually sees.  That sustained write amplification is what drains the
-- project's disk IO budget (and is the `employee_schedules` "re-sync bloat"
-- measured in STORAGE_RECLAMATION.md).
--
-- The `WHERE` on DO UPDATE is the fix: an unchanged row is skipped outright —
-- no tuple, no index write, no WAL, no dead row.  PostgREST cannot express that
-- clause, which is the only reason this has to be an RPC rather than a flag on
-- the existing `.upsert()` call.
--
-- Returns the number of rows actually inserted or updated, so the caller can
-- log changed-vs-processed and the win is visible in api_call_logs.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_employee_schedules(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed INTEGER;
BEGIN
  -- DISTINCT ON guards against a duplicate (employee_code, duty_date) inside a
  -- single batch: ON CONFLICT cannot touch the same row twice in one statement
  -- and would abort the whole batch. The source sheet has produced duplicates
  -- before — fetch-roster and sync-roster both dedupe for the same reason.
  INSERT INTO public.employee_schedules
    (employee_code, employee_name, duty_date, duty_code, duty_description)
  SELECT DISTINCT ON (r.employee_code, r.duty_date)
    r.employee_code,
    r.employee_name,
    r.duty_date,
    COALESCE(r.duty_code, ''),
    COALESCE(r.duty_description, '')
  FROM jsonb_to_recordset(p_rows) AS r(
    employee_code    TEXT,
    employee_name    TEXT,
    duty_date        DATE,
    duty_code        TEXT,
    duty_description TEXT
  )
  WHERE r.employee_code IS NOT NULL
    AND r.employee_name IS NOT NULL
    AND r.duty_date     IS NOT NULL
  ORDER BY r.employee_code, r.duty_date
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
  'Batch upsert for fetch-schedule that skips rows whose values are unchanged. Returns rows actually written.';

-- Only the nightly sync (service_role) may call this; it bypasses RLS.
REVOKE ALL ON FUNCTION public.sync_employee_schedules(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_employee_schedules(JSONB) TO service_role;
