-- ─────────────────────────────────────────────────────────────────────────────
-- Leave register: every approval is recorded in the app, not only in the sheet
--
-- Until now only backfill_leave_entry() wrote register rows. An employee's
-- approved CL reached employee_leave_records only after a clerk typed it into
-- the ATTENDANCE sheet and the next sync pulled it in. Balances, which are read
-- from the register, lagged the sheet. "Send to Google Sheets" had nothing to
-- send, and closing the sheet would have frozen every balance
-- (docs/leave/ARCHITECTURE.md R3).
--
--   1. write_register_rows_for_request()  An approval writes its register rows
--      in the same transaction as the status change, on the same key the sheet
--      uses, so the sheet's copy lands on the app's row when it catches up. If
--      the sheet already has the fact, the app row links to it instead.
--   2. Cancellation of an approved request (employee or backfill origin)
--      removes the rows it wrote, archiving them. That fixes R10: the Cancel
--      button used to leave a backfilled CL counted.
--   3. Existing approvals are written once, now.
--   4. recompute_leave_balance() derives CL/RH from the register — the same
--      figure the employee sees — instead of from leave_requests alone, which
--      ignored every leave that exists only in the sheet (R4).
--   5. The leave RPCs that change balances, comp-off allocations and the roster
--      get a staff check and a pinned search_path (R12).
--
-- Depends on 20261005100000_leave_sheet_sources_and_safe_sync.sql.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 0. HELPERS
-- ═══════════════════════════════════════════════════════════════════════════

-- WSO, supervisor or admin (approved), or a trusted backend session.
CREATE OR REPLACE FUNCTION public.leave_caller_is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.leave_caller_is_trusted_backend()
      OR EXISTS (
           SELECT 1 FROM public.user_roles
            WHERE user_id = auth.uid()
              AND role IN ('wso', 'supervisor', 'admin')
              AND approved = true)
$$;

-- Supabase grants anon and authenticated EXECUTE on new functions by default, so
-- every REVOKE in this file names them as well as PUBLIC.
REVOKE ALL ON FUNCTION public.leave_caller_is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_caller_is_staff() TO authenticated, service_role;

-- leave_requests.leave_type → register category. NULL means "no register row":
-- COMP_OFF is recorded by stamping the earned rows it consumes, never by a new
-- row, and an unknown type is skipped rather than failing the approval.
CREATE OR REPLACE FUNCTION public.register_category_for_leave_type(p_leave_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE upper(btrim(COALESCE(p_leave_type, '')))
    WHEN 'CL'         THEN 'CL'
    WHEN 'CL_CON'     THEN 'CL'
    WHEN 'CL_1ST'     THEN 'CL_1ST'
    WHEN 'CL_1ST_CON' THEN 'CL_1ST'
    WHEN 'CL_2ND'     THEN 'CL_2ND'
    WHEN 'CL_2ND_CON' THEN 'CL_2ND'
    WHEN 'RH'         THEN 'RH'
    WHEN 'EL'         THEN 'EL'
    WHEN 'NEE'        THEN 'NEE'
    WHEN 'HPL'        THEN 'HPL'
    WHEN 'COMM'       THEN 'COMM'
    WHEN 'ML'         THEN 'ML'
    WHEN 'PTL'        THEN 'PTL'
    WHEN 'CCL'        THEN 'CCL'
    WHEN 'SPL'        THEN 'SPL'
    WHEN 'EXOL'       THEN 'EXOL'
    WHEN 'LWP'        THEN 'LWP'
    ELSE NULL
  END
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. write_register_rows_for_request
-- ═══════════════════════════════════════════════════════════════════════════
-- Keys match what fetch-leave-data emits (source_event_type = category,
-- duty_code = ''), so the sheet's copy of the same fact lands on this row and
-- the guard trigger confirms it rather than adding a second one.
--
-- RH follows the sheet's convention: the row is keyed by the holiday the RH was
-- declared against (actual_rh_date), with the day taken in
-- metadata.leave_applied. A request with no RH date cannot be keyed that way;
-- it is skipped with a warning rather than written under the wrong date, which
-- would count the RH twice once the sheet caught up.
--
-- Closed-holiday dates inside a CL-family range are not leave days and get no
-- row, mirroring backfill_leave_entry().
--
-- Idempotent: re-running for the same request changes nothing.

CREATE OR REPLACE FUNCTION public.write_register_rows_for_request(p_request_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req       public.leave_requests;
  v_code      TEXT;
  v_name      TEXT;
  v_category  TEXT;
  v_ch_dates  DATE[] := ARRAY[]::DATE[];
  v_day       DATE;
  v_meta      JSONB;
  v_written   INTEGER := 0;
BEGIN
  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id;
  IF v_req.id IS NULL OR v_req.status IS DISTINCT FROM 'Approved' THEN
    RETURN 0;
  END IF;

  v_category := public.register_category_for_leave_type(v_req.leave_type);
  IF v_category IS NULL THEN
    RETURN 0;
  END IF;

  SELECT NULLIF(btrim(employee_id), ''), full_name
    INTO v_code, v_name
    FROM public.profiles
   WHERE id = v_req.employee_id;

  IF v_code IS NULL THEN
    RAISE WARNING 'Leave request % has no employee code on its profile; no register row written', p_request_id;
    RETURN 0;
  END IF;

  v_name := COALESCE(NULLIF(btrim(v_name), ''), v_req.employee_name, '');
  v_meta := jsonb_build_object(
    'leave_request_id',    v_req.id::TEXT,
    'app_register_record', true,
    'origin',              COALESCE(v_req.origin, 'employee'));

  IF v_category = 'RH' THEN
    IF v_req.actual_rh_date IS NULL THEN
      RAISE WARNING 'RH request % has no actual_rh_date; no register row written', p_request_id;
      RETURN 0;
    END IF;

    PERFORM public.upsert_app_register_row(
      p_request_id, v_code, v_name, 'RH', v_req.actual_rh_date,
      v_meta || jsonb_build_object(
        'rh_date',       to_char(v_req.actual_rh_date, 'YYYY-MM-DD'),
        'leave_applied', to_char(v_req.start_date, 'YYYY-MM-DD')));
    RETURN 1;
  END IF;

  IF v_category IN ('CL', 'CL_1ST', 'CL_2ND')
     AND jsonb_typeof(v_req.ch_comp_off_dates) = 'array' THEN
    SELECT COALESCE(array_agg(d), ARRAY[]::DATE[])
      INTO v_ch_dates
      FROM (SELECT public.try_parse_date(elem->>'date') AS d
              FROM jsonb_array_elements(v_req.ch_comp_off_dates) AS elem) parsed
     WHERE d IS NOT NULL;
  END IF;

  FOR v_day IN SELECT generate_series(v_req.start_date, v_req.end_date, INTERVAL '1 day')::DATE
  LOOP
    CONTINUE WHEN v_day = ANY (v_ch_dates);
    PERFORM public.upsert_app_register_row(p_request_id, v_code, v_name, v_category, v_day, v_meta);
    v_written := v_written + 1;
  END LOOP;

  RETURN v_written;
END;
$$;

-- One register row for an approval. A row the register already holds for the
-- same fact — normally the sheet's — is linked, never taken over: the sheet
-- keeps owning what it recorded first.
--
-- "Same fact" is employee, category and day. For plain leave the rest of the
-- unique key only says which feed shape wrote the row ('CL' from the legacy
-- feed, 'CASUAL_LEAVE' from the events feed), so it is not part of the match.
CREATE OR REPLACE FUNCTION public.upsert_app_register_row(
  p_request_id UUID,
  p_emp_id     TEXT,
  p_name       TEXT,
  p_category   TEXT,
  p_date       DATE,
  p_metadata   JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
BEGIN
  -- Prefer the sheet's row, then whichever came first.
  SELECT id INTO v_existing
    FROM public.employee_leave_records
   WHERE emp_id = p_emp_id
     AND leave_category = p_category
     AND leave_date = p_date
   ORDER BY (source = 'google_sheets') DESC, created_at
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.employee_leave_records r
       SET metadata = COALESCE(r.metadata, '{}'::JSONB)
                      || jsonb_build_object('register_link_request_id', p_request_id::TEXT)
     WHERE r.id = v_existing
       AND (r.metadata ->> 'leave_request_id') IS DISTINCT FROM p_request_id::TEXT
       AND (r.metadata ->> 'register_link_request_id') IS DISTINCT FROM p_request_id::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.employee_leave_records AS r (
    emp_id, employee_name, leave_category, source_event_type, event_kind,
    leave_date, duty_code, raw_date_value, raw_event, metadata, source
  ) VALUES (
    p_emp_id, p_name, p_category, p_category, 'leave',
    p_date, '', to_char(p_date, 'YYYY-MM-DD'), '{}'::JSONB, p_metadata, 'webapp'
  )
  ON CONFLICT (emp_id, leave_category, source_event_type, leave_date, duty_code)
  DO UPDATE SET
    metadata = COALESCE(r.metadata, '{}'::JSONB)
               || jsonb_build_object('register_link_request_id', p_request_id::TEXT)
  WHERE (r.metadata ->> 'leave_request_id') IS DISTINCT FROM p_request_id::TEXT
    AND (r.metadata ->> 'register_link_request_id') IS DISTINCT FROM p_request_id::TEXT;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. unlink_register_rows_for_request — the reverse, on cancellation
-- ═══════════════════════════════════════════════════════════════════════════
-- Removes rows this request created (approval or backfill) — archived by the
-- delete trigger — and drops its link from rows the sheet owns. Comp-off
-- allocations on earned rows are left to clear_comp_off_for_leave(), which the
-- cancellation flow already calls.

CREATE OR REPLACE FUNCTION public.unlink_register_rows_for_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted  INTEGER := 0;
  v_unlinked INTEGER := 0;
BEGIN
  PERFORM set_config('leave.delete_reason', 'request_cancelled', true);

  DELETE FROM public.employee_leave_records
   WHERE source = 'webapp'
     AND metadata @> jsonb_build_object('leave_request_id', p_request_id::TEXT)
     AND (metadata @> '{"app_register_record": true}'::JSONB
          OR metadata @> '{"backfill_record": true}'::JSONB);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  PERFORM set_config('leave.delete_reason', '', true);

  UPDATE public.employee_leave_records
     SET metadata = metadata - 'register_link_request_id'
   WHERE metadata @> jsonb_build_object('register_link_request_id', p_request_id::TEXT);
  GET DIAGNOSTICS v_unlinked = ROW_COUNT;

  RETURN jsonb_build_object('deleted', v_deleted, 'unlinked', v_unlinked);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. TRIGGER ON leave_requests
-- ═══════════════════════════════════════════════════════════════════════════
-- AFTER UPDATE OF status, so it runs inside the approving UPDATE's transaction:
-- a request cannot become Approved without its register rows, or stop being
-- Approved while they remain.
--
-- Backfill and amendment INSERT their rows already Approved and write their own
-- register rows, so only employee-origin approvals are written here. Any
-- origin is unlinked on leaving Approved; for an amendment the rows are already
-- gone by then and this is a no-op.

CREATE OR REPLACE FUNCTION public.sync_leave_register_on_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Approved' AND OLD.status IS DISTINCT FROM 'Approved' THEN
    IF COALESCE(NEW.origin, 'employee') = 'employee' THEN
      PERFORM public.write_register_rows_for_request(NEW.id);
    END IF;
  ELSIF OLD.status = 'Approved' AND NEW.status IS DISTINCT FROM 'Approved' THEN
    PERFORM public.unlink_register_rows_for_request(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_leave_register_on_status_change ON public.leave_requests;
CREATE TRIGGER sync_leave_register_on_status_change
  AFTER UPDATE OF status ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_leave_register_on_status_change();

-- Internal: reached only through the trigger (and the one-time backfill below).
-- Callable directly they would let any user write or remove register rows.
REVOKE ALL ON FUNCTION public.write_register_rows_for_request(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_app_register_row(UUID, TEXT, TEXT, TEXT, DATE, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unlink_register_rows_for_request(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_leave_register_on_status_change() FROM PUBLIC, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. WRITE EXISTING APPROVALS ONCE
-- ═══════════════════════════════════════════════════════════════════════════
-- Approvals made before this migration are in leave_requests only. Writing them
-- now makes the register complete; where the sheet already has the fact the
-- row is linked, not duplicated. Employees whose approved leave the clerk had
-- not yet typed in will see their balance drop to the correct figure.

DO $$
DECLARE
  v_req      RECORD;
  v_rows     INTEGER := 0;
  v_requests INTEGER := 0;
BEGIN
  FOR v_req IN
    SELECT id FROM public.leave_requests
     WHERE status = 'Approved'
       AND COALESCE(origin, 'employee') = 'employee'
     ORDER BY start_date
  LOOP
    v_rows := v_rows + public.write_register_rows_for_request(v_req.id);
    v_requests := v_requests + 1;
  END LOOP;

  INSERT INTO public.leave_audit_log (action, actor_role, after, reason)
  VALUES (
    'register_backfill_from_requests', 'system',
    jsonb_build_object('requests', v_requests, 'rows_written_or_linked', v_rows),
    'Migration 20261005110000: approved requests written to the register');

  RAISE NOTICE 'Register: % approved request(s), % row(s) written or linked', v_requests, v_rows;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. recompute_leave_balance — from the register
-- ═══════════════════════════════════════════════════════════════════════════
-- CL used = full-day CL rows + ½ per half-day row in the year; RH used = RH rows
-- in the year. This is exactly what the apply form and the leave page show,
-- so leave_balances now agrees with them. An employee with no employee code
-- (and so no register rows) keeps the old leave_requests-based figure.

CREATE OR REPLACE FUNCTION public.recompute_leave_balance(
  p_user_id UUID,
  p_year    INT,
  p_dry_run BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code      TEXT;
  v_basis     TEXT;
  v_cl_used   NUMERIC := 0;
  v_rh_used   NUMERIC := 0;
  v_cl_before NUMERIC;
  v_rh_before NUMERIC;
  v_cl_after  NUMERIC;
  v_rh_after  NUMERIC;
BEGIN
  IF NOT public.can_manage_leave_backfill() THEN
    RAISE EXCEPTION 'Only an approved supervisor or admin may recompute balances'
      USING ERRCODE = '42501';
  END IF;

  SELECT NULLIF(btrim(employee_id), '') INTO v_code FROM public.profiles WHERE id = p_user_id;

  IF v_code IS NOT NULL THEN
    v_basis := 'register';
    SELECT
      COALESCE(SUM(CASE WHEN leave_category = 'CL' THEN 1
                        WHEN leave_category IN ('CL_1ST', 'CL_2ND') THEN 0.5
                        ELSE 0 END), 0),
      COUNT(*) FILTER (WHERE leave_category = 'RH')
    INTO v_cl_used, v_rh_used
    FROM public.employee_leave_records
    WHERE emp_id = v_code
      AND leave_category IN ('CL', 'CL_1ST', 'CL_2ND', 'RH')
      AND leave_date >= make_date(p_year, 1, 1)
      AND leave_date <  make_date(p_year + 1, 1, 1);
  ELSE
    v_basis := 'leave_requests';
    SELECT
      COALESCE(SUM(total_days) FILTER (
        WHERE leave_type IN ('CL','CL_CON','CL_1ST','CL_1ST_CON','CL_2ND','CL_2ND_CON')), 0),
      COALESCE(SUM(total_days) FILTER (WHERE leave_type = 'RH'), 0)
    INTO v_cl_used, v_rh_used
    FROM public.leave_requests
    WHERE employee_id = p_user_id
      AND status = 'Approved'
      AND EXTRACT(YEAR FROM start_date)::INT = p_year;
  END IF;

  SELECT balance INTO v_cl_before FROM public.leave_balances
   WHERE user_id = p_user_id AND leave_type = 'cl'::leave_type AND year = p_year;
  SELECT balance INTO v_rh_before FROM public.leave_balances
   WHERE user_id = p_user_id AND leave_type = 'rh'::leave_type AND year = p_year;

  v_cl_after := 12 - v_cl_used;
  v_rh_after := 2  - v_rh_used;

  IF NOT p_dry_run THEN
    INSERT INTO public.leave_balances (user_id, leave_type, balance, year)
    VALUES (p_user_id, 'cl'::leave_type, v_cl_after, p_year)
    ON CONFLICT (user_id, leave_type, year)
    DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();

    INSERT INTO public.leave_balances (user_id, leave_type, balance, year)
    VALUES (p_user_id, 'rh'::leave_type, v_rh_after, p_year)
    ON CONFLICT (user_id, leave_type, year)
    DO UPDATE SET balance = EXCLUDED.balance, updated_at = now();

    INSERT INTO public.leave_audit_log (
      action, actor_id, actor_name, actor_role, employee_code, before, after, reason
    ) VALUES (
      'recompute_balance', auth.uid(),
      (SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'supervisor', v_code,
      jsonb_build_object('cl', v_cl_before, 'rh', v_rh_before, 'year', p_year),
      jsonb_build_object('cl', v_cl_after,  'rh', v_rh_after,  'year', p_year, 'basis', v_basis),
      format('Recomputed from %s: %s CL day(s) and %s RH day(s) used', v_basis, v_cl_used, v_rh_used)
    );
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id, 'year', p_year, 'dry_run', p_dry_run, 'basis', v_basis,
    'cl', jsonb_build_object('before', v_cl_before, 'after', v_cl_after, 'used', v_cl_used),
    'rh', jsonb_build_object('before', v_rh_before, 'after', v_rh_after, 'used', v_rh_used));
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. STAFF GUARD ON THE LEAVE SIDE-EFFECT RPCs (R12)
-- ═══════════════════════════════════════════════════════════════════════════
-- These are SECURITY DEFINER, so they bypass RLS, and until now had no role
-- check: any signed-in employee could call restore_leave_balance() on their own
-- account, clear another request's comp-off allocation, or write LEAVE over any
-- roster day. Every legitimate caller is a WSO, supervisor or admin approving
-- or cancelling leave, or backfill_leave_entry() / amend_leave_request() running
-- as one. Bodies are unchanged apart from the guard and a pinned search_path.

CREATE OR REPLACE FUNCTION public.deduct_leave_balance(
  p_user_id    UUID,
  p_leave_type TEXT,
  p_year       INT,
  p_days       NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance NUMERIC;
  v_default_balance NUMERIC;
  v_cast_type leave_type;
BEGIN
  IF NOT public.leave_caller_is_staff() THEN
    RAISE EXCEPTION 'Only leave staff may change a leave balance' USING ERRCODE = '42501';
  END IF;

  v_cast_type := p_leave_type::leave_type;

  CASE p_leave_type
    WHEN 'cl'  THEN v_default_balance := 12;
    WHEN 'rh'  THEN v_default_balance := 2;
    ELSE            v_default_balance := 0;
  END CASE;

  SELECT balance INTO v_current_balance
    FROM public.leave_balances
   WHERE user_id    = p_user_id
     AND leave_type = v_cast_type
     AND year       = p_year
   FOR UPDATE;

  IF FOUND THEN
    IF v_current_balance < p_days THEN
      RAISE EXCEPTION 'Insufficient % balance: have %, need %',
        p_leave_type, v_current_balance, p_days;
    END IF;

    UPDATE public.leave_balances
       SET balance    = balance - p_days,
           updated_at = NOW()
     WHERE user_id    = p_user_id
       AND leave_type = v_cast_type
       AND year       = p_year;
  ELSE
    IF v_default_balance < p_days THEN
      RAISE EXCEPTION 'Insufficient % balance: have % (default), need %',
        p_leave_type, v_default_balance, p_days;
    END IF;

    INSERT INTO public.leave_balances (user_id, leave_type, balance, year)
    VALUES (p_user_id, v_cast_type, v_default_balance - p_days, p_year);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_leave_balance(
  p_user_id    UUID,
  p_leave_type TEXT,
  p_year       INT,
  p_days       NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cast_type leave_type;
  v_default_balance NUMERIC;
BEGIN
  IF NOT public.leave_caller_is_staff() THEN
    RAISE EXCEPTION 'Only leave staff may change a leave balance' USING ERRCODE = '42501';
  END IF;

  v_cast_type := p_leave_type::leave_type;

  CASE p_leave_type
    WHEN 'cl'  THEN v_default_balance := 12;
    WHEN 'rh'  THEN v_default_balance := 2;
    ELSE            v_default_balance := 0;
  END CASE;

  UPDATE public.leave_balances
     SET balance    = balance + p_days,
         updated_at = NOW()
   WHERE user_id    = p_user_id
     AND leave_type = v_cast_type
     AND year       = p_year;

  IF NOT FOUND THEN
    INSERT INTO public.leave_balances (user_id, leave_type, balance, year)
    VALUES (p_user_id, v_cast_type, v_default_balance + p_days, p_year);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_comp_off_for_leave(
  p_leave_request_id UUID,
  p_record_ids UUID[],
  p_leave_dates TEXT[],
  p_employee_name TEXT,
  p_start_date TEXT,
  p_end_date TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record RECORD;
  v_index INT := 1;
  v_updated INT := 0;
BEGIN
  IF NOT public.leave_caller_is_staff() THEN
    RAISE EXCEPTION 'Only leave staff may allocate comp-off' USING ERRCODE = '42501';
  END IF;

  IF array_length(p_record_ids, 1) IS NULL OR array_length(p_record_ids, 1) < array_length(p_leave_dates, 1) THEN
    RAISE EXCEPTION 'Insufficient comp-off entries to cover requested leave days';
  END IF;

  FOR v_record IN
    SELECT id, metadata
    FROM public.employee_leave_records
    WHERE id = ANY(p_record_ids)
    ORDER BY leave_date ASC
    FOR UPDATE
  LOOP
    IF (v_record.metadata->>'leave_request_id') IS NOT NULL
       AND (v_record.metadata->>'leave_request_id') != p_leave_request_id::TEXT THEN
      RAISE EXCEPTION 'Comp-off entry % is already allocated to another leave request', v_record.id;
    END IF;

    IF (v_record.metadata->>'leave_request_id') = p_leave_request_id::TEXT THEN
      v_index := v_index + 1;
      CONTINUE;
    END IF;

    IF v_index <= array_length(p_leave_dates, 1) THEN
      UPDATE public.employee_leave_records
      SET
        employee_name = p_employee_name,
        leave_used_on = p_leave_dates[v_index]::DATE,
        raw_leave_used_value = p_leave_dates[v_index],
        metadata = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  COALESCE(metadata, '{}'::JSONB),
                  '{leave_request_id}', to_jsonb(p_leave_request_id::TEXT)
                ),
                '{leave_used_on}', to_jsonb(p_leave_dates[v_index])
              ),
              '{leave_applied}', to_jsonb(p_leave_dates[v_index])
            ),
            '{request_start_date}', to_jsonb(p_start_date)
          ),
          '{request_end_date}', to_jsonb(p_end_date)
        ),
        updated_at = NOW()
      WHERE id = v_record.id;
      v_updated := v_updated + 1;
    END IF;

    v_index := v_index + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_comp_off_for_leave(
  p_leave_request_id UUID,
  p_employee_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleared INT := 0;
BEGIN
  IF NOT public.leave_caller_is_staff() THEN
    RAISE EXCEPTION 'Only leave staff may clear a comp-off allocation' USING ERRCODE = '42501';
  END IF;

  UPDATE public.employee_leave_records
  SET
    leave_used_on = NULL,
    raw_leave_used_value = NULL,
    metadata = metadata - 'leave_request_id' - 'leave_used_on' - 'leave_applied' - 'request_start_date' - 'request_end_date',
    updated_at = NOW()
  WHERE emp_id = p_employee_code
    AND (metadata->>'leave_request_id') = p_leave_request_id::TEXT;

  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  RETURN jsonb_build_object('cleared', v_cleared);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_leave_to_schedule(
  p_leave_request_id UUID,
  p_employee_id UUID,
  p_employee_code TEXT,
  p_employee_name TEXT,
  p_start_date DATE,
  p_end_date DATE,
  p_leave_type TEXT DEFAULT 'Leave'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day DATE;
  v_existing RECORD;
  v_processed INT := 0;
BEGIN
  IF NOT public.leave_caller_is_staff() THEN
    RAISE EXCEPTION 'Only leave staff may write leave to the roster' USING ERRCODE = '42501';
  END IF;

  FOR v_day IN SELECT generate_series(p_start_date, p_end_date, '1 day'::INTERVAL)::DATE
  LOOP
    SELECT employee_code, employee_name, duty_code, duty_description
    INTO v_existing
    FROM public.employee_schedules
    WHERE employee_code = p_employee_code
      AND duty_date = v_day;

    INSERT INTO public.leave_schedule_snapshots (
      leave_request_id, employee_id, duty_date,
      had_schedule, original_employee_code, original_employee_name,
      original_duty_code, original_duty_description
    ) VALUES (
      p_leave_request_id, p_employee_id, v_day,
      v_existing IS NOT NULL,
      COALESCE(v_existing.employee_code, p_employee_code),
      COALESCE(v_existing.employee_name, p_employee_name),
      v_existing.duty_code,
      v_existing.duty_description
    )
    ON CONFLICT (leave_request_id, duty_date)
    DO UPDATE SET
      had_schedule = EXCLUDED.had_schedule,
      original_employee_code = EXCLUDED.original_employee_code,
      original_employee_name = EXCLUDED.original_employee_name,
      original_duty_code = EXCLUDED.original_duty_code,
      original_duty_description = EXCLUDED.original_duty_description;

    INSERT INTO public.employee_schedules (
      employee_code, employee_name, duty_date, duty_code, duty_description
    ) VALUES (
      p_employee_code, p_employee_name, v_day,
      'LEAVE', 'Approved Leave (' || p_leave_type || ')'
    )
    ON CONFLICT (employee_code, duty_date)
    DO UPDATE SET
      duty_code = 'LEAVE',
      duty_description = 'Approved Leave (' || p_leave_type || ')';

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed);
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_schedule_after_cancellation(
  p_leave_request_id UUID,
  p_employee_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot RECORD;
  v_restored INT := 0;
  v_has_other_leave BOOLEAN;
BEGIN
  IF NOT public.leave_caller_is_staff() THEN
    RAISE EXCEPTION 'Only leave staff may restore the roster' USING ERRCODE = '42501';
  END IF;

  FOR v_snapshot IN
    SELECT *
    FROM public.leave_schedule_snapshots
    WHERE leave_request_id = p_leave_request_id
      AND restored_at IS NULL
    ORDER BY duty_date ASC
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.leave_requests
      WHERE employee_id = p_employee_id
        AND id != p_leave_request_id
        AND status = 'Approved'
        AND start_date <= v_snapshot.duty_date
        AND end_date >= v_snapshot.duty_date
    ) INTO v_has_other_leave;

    IF v_has_other_leave THEN
      CONTINUE;
    END IF;

    IF v_snapshot.had_schedule THEN
      INSERT INTO public.employee_schedules (
        employee_code, employee_name, duty_date, duty_code, duty_description
      ) VALUES (
        v_snapshot.original_employee_code,
        COALESCE(v_snapshot.original_employee_name, ''),
        v_snapshot.duty_date,
        COALESCE(v_snapshot.original_duty_code, ''),
        COALESCE(v_snapshot.original_duty_description, '')
      )
      ON CONFLICT (employee_code, duty_date)
      DO UPDATE SET
        duty_code = COALESCE(v_snapshot.original_duty_code, ''),
        duty_description = COALESCE(v_snapshot.original_duty_description, '');
    ELSE
      DELETE FROM public.employee_schedules
      WHERE employee_code = v_snapshot.original_employee_code
        AND duty_date = v_snapshot.duty_date
        AND duty_code = 'LEAVE';
    END IF;

    v_restored := v_restored + 1;
  END LOOP;

  UPDATE public.leave_schedule_snapshots
  SET restored_at = NOW()
  WHERE leave_request_id = p_leave_request_id
    AND restored_at IS NULL;

  RETURN jsonb_build_object('restored', v_restored);
END;
$$;

-- Default PUBLIC execute included anon. Keep them callable by signed-in users
-- (the guard decides) and the service role only.
REVOKE ALL ON FUNCTION public.deduct_leave_balance(UUID, TEXT, INT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_leave_balance(UUID, TEXT, INT, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.allocate_comp_off_for_leave(UUID, UUID[], TEXT[], TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_comp_off_for_leave(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_leave_to_schedule(UUID, UUID, TEXT, TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_schedule_after_cancellation(UUID, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.deduct_leave_balance(UUID, TEXT, INT, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_leave_balance(UUID, TEXT, INT, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.allocate_comp_off_for_leave(UUID, UUID[], TEXT[], TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_comp_off_for_leave(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_leave_to_schedule(UUID, UUID, TEXT, TEXT, DATE, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_schedule_after_cancellation(UUID, UUID) TO authenticated, service_role;
