-- ─────────────────────────────────────────────────────────────────────────────
-- Leave Backfill / Amendment / Balance-Recompute RPCs
--
-- All are SECURITY DEFINER and therefore bypass RLS; the supervisor+admin guard
-- inside each function body is the ONLY thing enforcing the role boundary.
--
--   is_leave_duty_code()          duty-code predicate shared by the schedule reconcile
--   backfill_leave_entry()        clear one backlog item, atomically
--   clear_backfilled_leave_records()  reversal leg for amendments
--   amend_leave_request()         cancel-and-supersede correction
--   recompute_leave_balance()     derive CL/RH from approved history
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- is_leave_duty_code — "is this roster cell already some form of leave?"
-- ═══════════════════════════════════════════════════════════════════════════
-- Mirrors the leave tokens in src/lib/compliance/rosterState.ts, minus the ones
-- that are not leave for this purpose: CO/SAT/SUN are rest days, G/GO are general
-- duty, TR/TRG is training, CH/NH are holidays.  Compound codes ('CO+N') are
-- split on '+' and match if ANY token is a leave marker.
--
-- Used to keep backfill from snapshotting a leave marker as a day's "original"
-- duty, which would make a later cancellation restore a phantom leave.
CREATE OR REPLACE FUNCTION public.is_leave_duty_code(p_duty_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(string_to_array(upper(COALESCE(p_duty_code, '')), '+')) AS token
    WHERE btrim(token) IN (
      'LEAVE', 'L', 'SL', 'CL', 'CL_1ST', 'CL_2ND', 'EL', 'HPL', 'NEE', 'COMM',
      'ML', 'PL', 'CCL', 'LWP', 'QL', 'SPL', 'OD'
    )
  )
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- try_parse_date — tolerant date cast
-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill chews through years of hand-maintained spreadsheet data, so a single
-- malformed date in a ch_comp_off_dates payload must not abort the entry (and
-- with it a supervisor's whole batch).  Returns NULL instead of raising.
CREATE OR REPLACE FUNCTION public.try_parse_date(p_value TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN p_value::DATE;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- backfill_leave_entry — clear one backlog item in a single transaction
-- ═══════════════════════════════════════════════════════════════════════════
-- Returns JSONB.  Data problems (unknown employee, overlapping leave, comp-off
-- shortfall) come back as {ok:false, conflict:{...}} so a 1000-item run reports
-- and continues; only a permission violation raises.
CREATE OR REPLACE FUNCTION public.backfill_leave_entry(
  p_employee_code         TEXT,
  p_leave_type            TEXT,
  p_start_date            DATE,
  p_end_date              DATE,
  p_total_days            NUMERIC,
  p_reason                TEXT        DEFAULT NULL,
  p_applied_at            TIMESTAMPTZ DEFAULT NULL,
  p_comp_off_record_ids   UUID[]      DEFAULT NULL,
  p_ch_comp_off_dates     JSONB       DEFAULT NULL,
  p_actual_rh_date        DATE        DEFAULT NULL,
  p_batch_id              UUID        DEFAULT NULL,
  p_audit_reason          TEXT        DEFAULT NULL,
  p_allow_used_comp_off   BOOLEAN     DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id        UUID := auth.uid();
  v_actor_name      TEXT;
  v_employee_id     UUID;
  v_employee_name   TEXT;
  v_team            TEXT;
  v_request_id      UUID;
  v_applied_at      TIMESTAMPTZ;
  v_conflict        RECORD;
  v_day             DATE;
  v_ch_dates        DATE[] := ARRAY[]::DATE[];
  v_leave_days      TEXT[] := ARRAY[]::TEXT[];
  v_existing        RECORD;
  v_records_written INT := 0;
  v_schedule_days   INT := 0;
  v_comp_off_count  INT := 0;
  v_ch_credits      INT := 0;
  v_warnings        JSONB := '[]'::JSONB;
  v_ch              JSONB;
  v_ch_date         DATE;
  v_holiday_id      UUID;
  v_bad_ids         INT;
  v_avail           INT;
BEGIN
  -- ── Permission (G3) ──────────────────────────────────────────────────────
  IF NOT public.can_manage_leave_backfill() THEN
    RAISE EXCEPTION 'Only an approved supervisor or admin may backfill leave'
      USING ERRCODE = '42501';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  -- ── Resolve the employee (profiles.employee_id is UNIQUE) ────────────────
  SELECT id, full_name, current_shift::TEXT
    INTO v_employee_id, v_employee_name, v_team
    FROM public.profiles
   WHERE employee_id = p_employee_code;

  IF v_employee_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'conflict', jsonb_build_object(
      'kind', 'unknown_employee',
      'message', format('No profile found for employee code %s', p_employee_code)));
  END IF;

  -- ── Basic shape ──────────────────────────────────────────────────────────
  IF p_end_date < p_start_date THEN
    RETURN jsonb_build_object('ok', false, 'conflict', jsonb_build_object(
      'kind', 'invalid_range', 'message', 'End date is before start date'));
  END IF;

  IF COALESCE(p_total_days, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'conflict', jsonb_build_object(
      'kind', 'invalid_range',
      'message', 'Total days must be greater than zero (all dates may be closed holidays)'));
  END IF;

  -- ── Overlap pre-check, mirroring check_leave_overlap() ───────────────────
  -- Done here so a genuine historical overlap is reported rather than aborting
  -- the batch on the trigger's exception.
  SELECT id, leave_type, start_date, end_date, status
    INTO v_conflict
    FROM public.leave_requests
   WHERE employee_id = v_employee_id
     AND status IN ('Pending WSO', 'Pending Supervisor', 'Approved')
     AND daterange(start_date, end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
   LIMIT 1;

  IF v_conflict.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'conflict', jsonb_build_object(
      'kind', 'overlap',
      'message', format('%s leave already recorded for %s to %s',
                        v_conflict.leave_type, v_conflict.start_date, v_conflict.end_date),
      'leave_request_id', v_conflict.id,
      'leave_type', v_conflict.leave_type,
      'start_date', v_conflict.start_date,
      'end_date', v_conflict.end_date,
      'status', v_conflict.status));
  END IF;

  -- ── Closed-holiday dates are not deducted and get no register row ────────
  IF p_ch_comp_off_dates IS NOT NULL AND jsonb_typeof(p_ch_comp_off_dates) = 'array' THEN
    SELECT COALESCE(array_agg(d), ARRAY[]::DATE[])
      INTO v_ch_dates
      FROM (
        SELECT public.try_parse_date(elem->>'date') AS d
          FROM jsonb_array_elements(p_ch_comp_off_dates) AS elem
      ) parsed
     WHERE d IS NOT NULL;
  END IF;

  FOR v_day IN SELECT generate_series(p_start_date, p_end_date, '1 day'::INTERVAL)::DATE
  LOOP
    IF NOT (v_day = ANY(v_ch_dates)) THEN
      v_leave_days := v_leave_days || to_char(v_day, 'YYYY-MM-DD');
    END IF;
  END LOOP;

  -- ── Comp-off: validate the explicit selection before writing anything ────
  IF p_leave_type = 'COMP_OFF' THEN
    IF p_comp_off_record_ids IS NULL OR array_length(p_comp_off_record_ids, 1) IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'conflict', jsonb_build_object(
        'kind', 'comp_off_required',
        'message', 'Select which earned comp-off entries this leave consumes'));
    END IF;

    IF array_length(p_comp_off_record_ids, 1) < array_length(v_leave_days, 1) THEN
      RETURN jsonb_build_object('ok', false, 'conflict', jsonb_build_object(
        'kind', 'comp_off_shortfall',
        'message', format('%s comp-off entries selected for %s leave day(s)',
                          array_length(p_comp_off_record_ids, 1), array_length(v_leave_days, 1))));
    END IF;

    -- Every selected row must belong to this employee.
    SELECT count(*) INTO v_bad_ids
      FROM unnest(p_comp_off_record_ids) AS rid
     WHERE NOT EXISTS (
       SELECT 1 FROM public.employee_leave_records r
        WHERE r.id = rid AND r.emp_id = p_employee_code);

    IF v_bad_ids > 0 THEN
      RETURN jsonb_build_object('ok', false, 'conflict', jsonb_build_object(
        'kind', 'comp_off_invalid',
        'message', format('%s selected comp-off entr(ies) do not belong to %s',
                          v_bad_ids, p_employee_code)));
    END IF;

    -- Entries consumed outside the app (leave_used_on set with no owning request)
    -- are refused unless the supervisor explicitly overrides.
    IF NOT p_allow_used_comp_off THEN
      SELECT count(*) INTO v_avail
        FROM public.employee_leave_records r
       WHERE r.id = ANY(p_comp_off_record_ids)
         AND r.leave_used_on IS NOT NULL
         AND (r.metadata->>'leave_request_id') IS NULL;

      IF v_avail > 0 THEN
        RETURN jsonb_build_object('ok', false, 'conflict', jsonb_build_object(
          'kind', 'comp_off_already_used',
          'message', format('%s selected entr(ies) are already marked used outside the app', v_avail),
          'count', v_avail));
      END IF;
    END IF;
  END IF;

  v_applied_at := COALESCE(p_applied_at, p_start_date::TIMESTAMPTZ);

  -- ── The leave request ────────────────────────────────────────────────────
  -- direct_supervisor_approved = true satisfies leave_requests_approval_path_check
  -- without inventing a WSO approval that never happened.
  INSERT INTO public.leave_requests (
    employee_id, employee_name, team, leave_type,
    start_date, end_date, total_days, reason, status, applied_at,
    supervisor_approved_by, supervisor_approved_at, supervisor_comments,
    direct_supervisor_approved, direct_supervisor_approved_by, direct_supervisor_approved_at,
    reviewed_by, reviewed_at,
    actual_rh_date, ch_comp_off_dates,
    origin, backfill_batch_id, comp_off_record_ids
  ) VALUES (
    v_employee_id, v_employee_name, v_team, p_leave_type,
    p_start_date, p_end_date, p_total_days, p_reason, 'Approved', v_applied_at,
    v_actor_id, now(), COALESCE(p_audit_reason, 'Backfilled from roster by supervisor'),
    TRUE, v_actor_id, now(),
    v_actor_id, now(),
    p_actual_rh_date, p_ch_comp_off_dates,
    'backfill', p_batch_id,
    CASE WHEN p_comp_off_record_ids IS NULL THEN NULL
         ELSE to_jsonb(p_comp_off_record_ids) END
  )
  RETURNING id INTO v_request_id;

  -- ── Register rows ────────────────────────────────────────────────────────
  -- COMP_OFF consumption is recorded by stamping the earned rows (below), not by
  -- adding new ones — a new COMP_OFF row here would double-count.
  --
  -- source_event_type = leave_category and duty_code = '' deliberately match what
  -- fetch-leave-data emits, so when the sheet is finally updated its row lands on
  -- the SAME unique key and the precedence trigger resolves it. A distinctive
  -- value here would create a second row and double-count the leave.
  IF p_leave_type <> 'COMP_OFF' THEN
    FOREACH v_day IN ARRAY (SELECT COALESCE(array_agg(d::DATE), ARRAY[]::DATE[])
                              FROM unnest(v_leave_days) AS d)
    LOOP
      INSERT INTO public.employee_leave_records (
        emp_id, employee_name, leave_category, source_event_type, event_kind,
        leave_date, duty_code, raw_date_value, raw_event, metadata, source
      ) VALUES (
        p_employee_code, v_employee_name, p_leave_type, p_leave_type, 'leave',
        v_day, '', to_char(v_day, 'YYYY-MM-DD'), '{}'::JSONB,
        jsonb_build_object(
          'leave_request_id', v_request_id::TEXT,
          'backfill_record',  true,
          'origin',           'backfill',
          'backfilled_by',    v_actor_id::TEXT,
          'backfilled_at',    to_jsonb(now())),
        'webapp'
      )
      ON CONFLICT (emp_id, leave_category, source_event_type, leave_date, duty_code)
      DO UPDATE SET
        source        = 'webapp',
        event_kind    = 'leave',
        employee_name = EXCLUDED.employee_name,
        metadata      = COALESCE(public.employee_leave_records.metadata, '{}'::JSONB)
                          || EXCLUDED.metadata;
      v_records_written := v_records_written + 1;
    END LOOP;
  END IF;

  -- ── Comp-off allocation (reuses the existing atomic RPC) ─────────────────
  IF p_leave_type = 'COMP_OFF' THEN
    PERFORM public.allocate_comp_off_for_leave(
      v_request_id,
      p_comp_off_record_ids[1:array_length(v_leave_days, 1)],
      v_leave_days,
      v_employee_name,
      to_char(p_start_date, 'YYYY-MM-DD'),
      to_char(p_end_date, 'YYYY-MM-DD'));
    v_comp_off_count := array_length(v_leave_days, 1);
  END IF;

  -- ── Schedule reconcile ───────────────────────────────────────────────────
  -- The backlog exists precisely because these days ALREADY read as leave.
  -- Snapshotting that and overwriting it would record 'LEAVE' as the day's
  -- original duty, so cancelling later would "restore" a phantom leave.
  FOR v_day IN SELECT generate_series(p_start_date, p_end_date, '1 day'::INTERVAL)::DATE
  LOOP
    SELECT employee_code, employee_name, duty_code, duty_description
      INTO v_existing
      FROM public.employee_schedules
     WHERE employee_code = p_employee_code AND duty_date = v_day;

    IF FOUND AND public.is_leave_duty_code(v_existing.duty_code) THEN
      CONTINUE;  -- already marked leave: leave the roster exactly as it is
    END IF;

    INSERT INTO public.leave_schedule_snapshots (
      leave_request_id, employee_id, duty_date, had_schedule,
      original_employee_code, original_employee_name,
      original_duty_code, original_duty_description
    ) VALUES (
      v_request_id, v_employee_id, v_day, FOUND,
      COALESCE(v_existing.employee_code, p_employee_code),
      COALESCE(v_existing.employee_name, v_employee_name),
      v_existing.duty_code, v_existing.duty_description
    )
    ON CONFLICT (leave_request_id, duty_date) DO UPDATE SET
      had_schedule              = EXCLUDED.had_schedule,
      original_employee_code    = EXCLUDED.original_employee_code,
      original_employee_name    = EXCLUDED.original_employee_name,
      original_duty_code        = EXCLUDED.original_duty_code,
      original_duty_description = EXCLUDED.original_duty_description;

    INSERT INTO public.employee_schedules (
      employee_code, employee_name, duty_date, duty_code, duty_description
    ) VALUES (
      p_employee_code, v_employee_name, v_day,
      'LEAVE', 'Approved Leave (' || p_leave_type || ')'
    )
    ON CONFLICT (employee_code, duty_date) DO UPDATE SET
      duty_code        = 'LEAVE',
      duty_description = 'Approved Leave (' || p_leave_type || ')';

    v_schedule_days := v_schedule_days + 1;
  END LOOP;

  -- ── CH comp-off credits ──────────────────────────────────────────────────
  -- comp_off_ledger.holiday_id is NOT NULL with an FK to holidays, so a CH date
  -- with no holiday row is skipped with a warning rather than failing the entry.
  IF p_ch_comp_off_dates IS NOT NULL AND jsonb_typeof(p_ch_comp_off_dates) = 'array' THEN
    FOR v_ch IN SELECT * FROM jsonb_array_elements(p_ch_comp_off_dates)
    LOOP
      v_ch_date := public.try_parse_date(v_ch->>'date');

      IF v_ch_date IS NULL THEN
        v_warnings := v_warnings || jsonb_build_object(
          'kind', 'ch_date_invalid',
          'date', v_ch->>'date',
          'message', 'Unreadable date — comp-off credit skipped');
        CONTINUE;
      END IF;

      v_holiday_id := NULLIF(v_ch->>'holiday_id', '')::UUID;

      IF v_holiday_id IS NULL THEN
        SELECT id INTO v_holiday_id
          FROM public.holidays
         WHERE holiday_date = v_ch_date
         ORDER BY (station = 'ALL') DESC
         LIMIT 1;
      END IF;

      IF v_holiday_id IS NULL THEN
        v_warnings := v_warnings || jsonb_build_object(
          'kind', 'ch_holiday_missing',
          'date', v_ch->>'date',
          'message', 'No holiday calendar entry — comp-off credit skipped');
        CONTINUE;
      END IF;

      INSERT INTO public.comp_off_ledger (
        employee_id, holiday_id, duty_date, days_granted, expiry_date, status
      ) VALUES (
        v_employee_id, v_holiday_id, v_ch_date, 1, v_ch_date + 89, 'available'
      )
      ON CONFLICT (employee_id, holiday_id, duty_date) DO NOTHING;

      v_ch_credits := v_ch_credits + 1;
    END LOOP;
  END IF;

  -- ── Audit ────────────────────────────────────────────────────────────────
  INSERT INTO public.leave_audit_log (
    action, actor_id, actor_name, actor_role, leave_request_id,
    employee_code, employee_name, leave_type, start_date, end_date,
    before, after, reason, batch_id
  ) VALUES (
    'backfill_entry', v_actor_id, v_actor_name, 'supervisor', v_request_id,
    p_employee_code, v_employee_name, p_leave_type, p_start_date, p_end_date,
    NULL,
    jsonb_build_object(
      'total_days', p_total_days,
      'records_written', v_records_written,
      'schedule_days_written', v_schedule_days,
      'comp_off_allocated', v_comp_off_count,
      'ch_credits', v_ch_credits,
      'comp_off_record_ids', to_jsonb(p_comp_off_record_ids),
      'used_comp_off_override', p_allow_used_comp_off,
      'warnings', v_warnings),
    p_audit_reason, p_batch_id
  );

  IF p_batch_id IS NOT NULL THEN
    UPDATE public.leave_backfill_batches
       SET entries_count = entries_count + 1
     WHERE id = p_batch_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'leave_request_id', v_request_id,
    'records_written', v_records_written,
    'schedule_days_written', v_schedule_days,
    'comp_off_allocated', v_comp_off_count,
    'ch_credits', v_ch_credits,
    'warnings', v_warnings);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- clear_backfilled_leave_records — reversal leg for amendments
-- ═══════════════════════════════════════════════════════════════════════════
-- Removes ONLY rows this system created (metadata.backfill_record = true).
-- Comp-off earned rows also carry metadata.leave_request_id once allocated, but
-- they are sheet-owned and must survive; clear_comp_off_for_leave un-stamps them.
CREATE OR REPLACE FUNCTION public.clear_backfilled_leave_records(
  p_leave_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
BEGIN
  DELETE FROM public.employee_leave_records
   WHERE (metadata->>'leave_request_id') = p_leave_request_id::TEXT
     AND COALESCE((metadata->>'backfill_record')::BOOLEAN, FALSE) = TRUE
     AND source = 'webapp';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('deleted', v_deleted);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- amend_leave_request — cancel-and-supersede correction
-- ═══════════════════════════════════════════════════════════════════════════
-- protect_leave_request_immutable_fields() blocks changing leave_type, dates,
-- total_days and friends on ANY row in ANY state (the pending escape hatch was
-- dropped in 20260408110000).  So a correction cannot be an UPDATE.  Instead the
-- old row is cancelled — touching only status/comments, which the trigger allows
-- — and a corrected row is inserted and linked.  History stays append-only and
-- the immutability trigger needs no change.
CREATE OR REPLACE FUNCTION public.amend_leave_request(
  p_leave_request_id      UUID,
  p_leave_type            TEXT,
  p_start_date            DATE,
  p_end_date              DATE,
  p_total_days            NUMERIC,
  p_reason                TEXT        DEFAULT NULL,
  p_comp_off_record_ids   UUID[]      DEFAULT NULL,
  p_ch_comp_off_dates     JSONB       DEFAULT NULL,
  p_actual_rh_date        DATE        DEFAULT NULL,
  p_audit_reason          TEXT        DEFAULT NULL,
  p_allow_used_comp_off   BOOLEAN     DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id     UUID := auth.uid();
  v_actor_name   TEXT;
  v_old          RECORD;
  v_emp_code     TEXT;
  v_result       JSONB;
  v_new_id       UUID;
BEGIN
  IF NOT public.can_manage_leave_backfill() THEN
    RAISE EXCEPTION 'Only an approved supervisor or admin may amend leave'
      USING ERRCODE = '42501';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  SELECT * INTO v_old FROM public.leave_requests WHERE id = p_leave_request_id;
  IF v_old.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'conflict', jsonb_build_object(
      'kind', 'not_found', 'message', 'Leave request not found'));
  END IF;

  IF v_old.status = 'Cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'conflict', jsonb_build_object(
      'kind', 'already_cancelled',
      'message', 'This request is already cancelled; amend the row that superseded it'));
  END IF;

  SELECT employee_id INTO v_emp_code FROM public.profiles WHERE id = v_old.employee_id;

  -- ── Reverse every side-effect of the original ────────────────────────────
  IF v_old.leave_type = 'COMP_OFF' THEN
    PERFORM public.clear_comp_off_for_leave(p_leave_request_id, v_emp_code);
  END IF;

  PERFORM public.clear_backfilled_leave_records(p_leave_request_id);
  PERFORM public.restore_schedule_after_cancellation(p_leave_request_id, v_old.employee_id);

  -- Only unwind a balance that was actually taken. Backfill never deducts.
  IF v_old.origin = 'employee' THEN
    PERFORM public.restore_leave_balance(
      v_old.employee_id,
      CASE WHEN v_old.leave_type IN ('CL','CL_CON','CL_1ST','CL_1ST_CON','CL_2ND','CL_2ND_CON') THEN 'cl'
           WHEN v_old.leave_type = 'RH' THEN 'rh' END,
      EXTRACT(YEAR FROM v_old.start_date)::INT,
      v_old.total_days)
    WHERE v_old.leave_type IN ('CL','CL_CON','CL_1ST','CL_1ST_CON','CL_2ND','CL_2ND_CON','RH');
  END IF;

  -- ── Cancel the old row (status/comments only — trigger-safe) ─────────────
  UPDATE public.leave_requests
     SET status = 'Cancelled',
         supervisor_comments = concat_ws(' ', '[Amended]',
                                 COALESCE(p_audit_reason, 'Superseded by a corrected entry'))
   WHERE id = p_leave_request_id;

  -- ── Insert the correction (reuses the backfill path wholesale) ───────────
  v_result := public.backfill_leave_entry(
    p_employee_code       => v_emp_code,
    p_leave_type          => p_leave_type,
    p_start_date          => p_start_date,
    p_end_date            => p_end_date,
    p_total_days          => p_total_days,
    p_reason              => COALESCE(p_reason, v_old.reason),
    p_applied_at          => v_old.applied_at,
    p_comp_off_record_ids => p_comp_off_record_ids,
    p_ch_comp_off_dates   => p_ch_comp_off_dates,
    p_actual_rh_date      => p_actual_rh_date,
    p_batch_id            => v_old.backfill_batch_id,
    p_audit_reason        => p_audit_reason,
    p_allow_used_comp_off => p_allow_used_comp_off);

  -- A failed correction must not leave the original cancelled.
  IF NOT COALESCE((v_result->>'ok')::BOOLEAN, FALSE) THEN
    RAISE EXCEPTION 'Amendment rejected: %', COALESCE(v_result->'conflict'->>'message', 'unknown')
      USING ERRCODE = '23514';
  END IF;

  v_new_id := (v_result->>'leave_request_id')::UUID;

  UPDATE public.leave_requests
     SET origin = 'amendment', supersedes_id = p_leave_request_id
   WHERE id = v_new_id;

  UPDATE public.leave_requests
     SET superseded_by_id = v_new_id
   WHERE id = p_leave_request_id;

  INSERT INTO public.leave_audit_log (
    action, actor_id, actor_name, actor_role, leave_request_id,
    employee_code, employee_name, leave_type, start_date, end_date,
    before, after, reason, batch_id
  ) VALUES (
    'amend_request', v_actor_id, v_actor_name, 'supervisor', v_new_id,
    v_emp_code, v_old.employee_name, p_leave_type, p_start_date, p_end_date,
    jsonb_build_object('leave_request_id', p_leave_request_id, 'leave_type', v_old.leave_type,
                       'start_date', v_old.start_date, 'end_date', v_old.end_date,
                       'total_days', v_old.total_days, 'status', v_old.status),
    jsonb_build_object('leave_request_id', v_new_id, 'leave_type', p_leave_type,
                       'start_date', p_start_date, 'end_date', p_end_date,
                       'total_days', p_total_days),
    p_audit_reason, v_old.backfill_batch_id
  );

  RETURN jsonb_build_object('ok', true, 'leave_request_id', v_new_id,
                            'superseded_id', p_leave_request_id,
                            'detail', v_result);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- recompute_leave_balance — derive CL/RH from approved history
-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill deliberately does not deduct: deduct_leave_balance() raises on
-- insufficient balance, so a thousand historical entries would abort constantly
-- and leave balances half-applied.  Instead balances are derived here, once, from
-- opening allocation minus approved days.  Idempotent; p_dry_run powers the
-- preview diff without committing.
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

  -- Superseded and cancelled rows are excluded by the status filter.
  SELECT
    COALESCE(SUM(total_days) FILTER (
      WHERE leave_type IN ('CL','CL_CON','CL_1ST','CL_1ST_CON','CL_2ND','CL_2ND_CON')), 0),
    COALESCE(SUM(total_days) FILTER (WHERE leave_type = 'RH'), 0)
  INTO v_cl_used, v_rh_used
  FROM public.leave_requests
  WHERE employee_id = p_user_id
    AND status = 'Approved'
    AND EXTRACT(YEAR FROM start_date)::INT = p_year;

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
      action, actor_id, actor_name, actor_role, before, after, reason
    ) VALUES (
      'recompute_balance', auth.uid(),
      (SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'supervisor',
      jsonb_build_object('cl', v_cl_before, 'rh', v_rh_before, 'year', p_year),
      jsonb_build_object('cl', v_cl_after,  'rh', v_rh_after,  'year', p_year),
      format('Recomputed from %s approved CL day(s) and %s approved RH day(s)', v_cl_used, v_rh_used)
    );
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id, 'year', p_year, 'dry_run', p_dry_run,
    'cl', jsonb_build_object('before', v_cl_before, 'after', v_cl_after, 'used', v_cl_used),
    'rh', jsonb_build_object('before', v_rh_before, 'after', v_rh_after, 'used', v_rh_used));
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- resolve_leave_sheet_conflict — settle one sheet-vs-app disagreement
-- ═══════════════════════════════════════════════════════════════════════════
-- protect_app_authored_leave_records() parks the sheet's version in
-- metadata.sheet_shadow instead of letting it overwrite an app-authored row.
-- This decides which side wins, and records the decision either way.
--
--   'keep_app'     — discard the shadow, app row stands
--   'accept_sheet' — apply the shadowed values, then discard the shadow
CREATE OR REPLACE FUNCTION public.resolve_leave_sheet_conflict(
  p_record_id  UUID,
  p_resolution TEXT,
  p_reason     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id   UUID := auth.uid();
  v_actor_name TEXT;
  v_row        RECORD;
  v_shadow     JSONB;
BEGIN
  IF NOT public.can_manage_leave_backfill() THEN
    RAISE EXCEPTION 'Only an approved supervisor or admin may resolve leave conflicts'
      USING ERRCODE = '42501';
  END IF;

  IF p_resolution NOT IN ('keep_app', 'accept_sheet') THEN
    RAISE EXCEPTION 'Unknown resolution %', p_resolution USING ERRCODE = '22023';
  END IF;

  SELECT full_name INTO v_actor_name FROM public.profiles WHERE id = v_actor_id;

  SELECT * INTO v_row FROM public.employee_leave_records WHERE id = p_record_id;
  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Leave record not found');
  END IF;

  v_shadow := v_row.metadata->'sheet_shadow';
  IF v_shadow IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'This record has no pending sheet conflict');
  END IF;

  IF p_resolution = 'accept_sheet' THEN
    -- Take the sheet's values but keep the row app-owned, so the stale-row purge
    -- in fetch-leave-data still cannot delete it.
    UPDATE public.employee_leave_records
       SET employee_name        = COALESCE(v_shadow->>'employee_name', employee_name),
           status               = COALESCE(v_shadow->>'status', status),
           leave_used_on        = COALESCE(public.try_parse_date(v_shadow->>'leave_used_on'), leave_used_on),
           raw_leave_used_value = COALESCE(v_shadow->>'raw_leave_used_value', raw_leave_used_value),
           raw_date_value       = COALESCE(v_shadow->>'raw_date_value', raw_date_value),
           raw_shift_value      = COALESCE(v_shadow->>'raw_shift_value', raw_shift_value),
           event_kind           = COALESCE(v_shadow->>'event_kind', event_kind),
           metadata             = (metadata - 'sheet_shadow' - 'sheet_seen_at')
                                    || jsonb_build_object('sheet_accepted_at', to_jsonb(now()))
     WHERE id = p_record_id;
  ELSE
    UPDATE public.employee_leave_records
       SET metadata = (metadata - 'sheet_shadow' - 'sheet_seen_at')
                        || jsonb_build_object('sheet_rejected_at', to_jsonb(now()))
     WHERE id = p_record_id;
  END IF;

  INSERT INTO public.leave_audit_log (
    action, actor_id, actor_name, actor_role,
    employee_code, employee_name, leave_type, start_date, end_date,
    before, after, reason
  ) VALUES (
    'resolve_conflict', v_actor_id, v_actor_name, 'supervisor',
    v_row.emp_id, v_row.employee_name, v_row.leave_category, v_row.leave_date, v_row.leave_date,
    jsonb_build_object('resolution', p_resolution, 'sheet_shadow', v_shadow),
    (SELECT jsonb_build_object(
              'employee_name', employee_name,
              'status', status,
              'leave_used_on', leave_used_on,
              'event_kind', event_kind)
       FROM public.employee_leave_records WHERE id = p_record_id),
    p_reason
  );

  RETURN jsonb_build_object('ok', true, 'resolution', p_resolution);
END;
$$;


GRANT EXECUTE ON FUNCTION public.is_leave_duty_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_leave_entry(
  TEXT, TEXT, DATE, DATE, NUMERIC, TEXT, TIMESTAMPTZ, UUID[], JSONB, DATE, UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_backfilled_leave_records(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.amend_leave_request(
  UUID, TEXT, DATE, DATE, NUMERIC, TEXT, UUID[], JSONB, DATE, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_leave_balance(UUID, INT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_leave_sheet_conflict(UUID, TEXT, TEXT) TO authenticated;
