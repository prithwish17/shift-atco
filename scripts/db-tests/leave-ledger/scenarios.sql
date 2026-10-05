-- ─────────────────────────────────────────────────────────────────────────────
-- Scenario tests for the leave ledger migrations (20261005100000, 20261005110000).
-- Each block raises on the first failed expectation; run.sh stops there.
-- Risk numbers refer to docs/leave/ARCHITECTURE.md §6.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA t;

CREATE FUNCTION t.ok(p_cond BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'FAIL: %', p_msg;
  END IF;
  RAISE NOTICE 'ok   %', p_msg;
END $$;

-- Act as a signed-in user (PostgREST sets these claims), or as a backend.
CREATE FUNCTION t.as_user(p_id UUID) RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::TEXT, false)
$$;
CREATE FUNCTION t.as_backend() RETURNS VOID LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '', false)
$$;

CREATE FUNCTION t.uid(p_name TEXT) RETURNS UUID LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_name
    WHEN 'admin' THEN '00000000-0000-0000-0000-00000000000a'
    WHEN 'sup'   THEN '00000000-0000-0000-0000-00000000000b'
    WHEN 'wso'   THEN '00000000-0000-0000-0000-00000000000c'
    WHEN 'e1'    THEN '00000000-0000-0000-0000-0000000000e1'
    WHEN 'e2'    THEN '00000000-0000-0000-0000-0000000000e2'
    WHEN 'e3'    THEN '00000000-0000-0000-0000-0000000000e3'
    WHEN 'e5'    THEN '00000000-0000-0000-0000-0000000000e5'
  END::UUID
$$;

-- The sheet as the read feed would serve it. Starts as the sheet's own view.
CREATE TABLE t.feed AS SELECT * FROM public.__test_sheet_snapshot;
ALTER TABLE t.feed ADD PRIMARY KEY (emp_id, leave_category, source_event_type, leave_date, duty_code);

-- One sync run, exactly as the edge function performs it.
CREATE FUNCTION t.sync(p_source TEXT DEFAULT NULL) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_run UUID;
BEGIN
  PERFORM t.as_backend();
  INSERT INTO public.leave_sheet_sync_runs (source_key, triggered_by)
  VALUES (COALESCE(p_source, (SELECT source_key FROM public.leave_sheet_sources WHERE status = 'active')), 'test')
  RETURNING id INTO v_run;

  INSERT INTO public.leave_sheet_sync_staging (
    run_id, emp_id, employee_name, sl_no, status, leave_category, source_event_type,
    event_kind, leave_date, leave_used_on, duty_code, raw_date_value, raw_shift_value,
    raw_leave_used_value, raw_event, metadata)
  SELECT v_run, emp_id, employee_name, sl_no, status, leave_category, source_event_type,
         event_kind, leave_date, leave_used_on, duty_code, raw_date_value, raw_shift_value,
         raw_leave_used_value, raw_event, metadata
    FROM t.feed;

  RETURN public.commit_leave_sheet_sync(v_run);
END $$;

CREATE FUNCTION t.rec(p_emp TEXT, p_cat TEXT, p_date DATE)
RETURNS public.employee_leave_records LANGUAGE sql AS $$
  SELECT * FROM public.employee_leave_records
   WHERE emp_id = p_emp AND leave_category = p_cat AND leave_date = p_date
$$;

CREATE FUNCTION t.count_rec(p_emp TEXT, p_cat TEXT, p_date DATE) RETURNS BIGINT LANGUAGE sql AS $$
  SELECT count(*) FROM public.employee_leave_records
   WHERE emp_id = p_emp AND leave_category = p_cat AND leave_date = p_date
$$;


-- ═══ After migration ═════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE '── after migration';
  PERFORM t.ok((SELECT count(*) = 0 FROM public.employee_leave_records
                 WHERE source = 'google_sheets' AND sheet_source IS DISTINCT FROM 'ATTENDANCE-2026'),
               'every sheet row is tagged with the active workbook');

  PERFORM t.ok((t.rec('10000001', 'CL', '2026-03-05')).source = 'google_sheets'
               AND (t.rec('10000001', 'CL', '2026-03-05')).metadata->>'register_link_request_id'
                   = '11111111-0000-0000-0000-000000000001',
               'an approval the sheet already has is linked, not duplicated (R3)');

  PERFORM t.ok((SELECT count(*) = 2 FROM public.employee_leave_records
                 WHERE source = 'webapp'
                   AND metadata->>'leave_request_id' = '11111111-0000-0000-0000-000000000002'
                   AND (metadata->>'app_register_record')::BOOLEAN),
               'an approval missing from the sheet gets app rows (R3)');

  PERFORM t.ok((t.rec('10000002', 'RH', '2026-01-01')).metadata->>'leave_applied' = '2026-06-10',
               'RH is keyed by its holiday date, day taken in metadata (R9)');

  PERFORM t.ok((SELECT count(*) = 0 FROM public.employee_leave_records
                 WHERE metadata->>'leave_request_id' = '11111111-0000-0000-0000-000000000004'),
               'an RH with no RH date is skipped rather than keyed wrongly');

  PERFORM t.ok((SELECT count(*) = 0 FROM public.employee_leave_records
                 WHERE metadata->>'leave_request_id' = '11111111-0000-0000-0000-000000000006'),
               'cancelled requests write nothing');

  PERFORM t.ok((SELECT count(*) = 2 FROM public.employee_leave_records
                 WHERE emp_id = '10000003' AND leave_category = 'EL' AND source = 'webapp'),
               'leave types with no sheet column are still recorded');

  PERFORM t.ok((SELECT count(*) = 0 FROM public.employee_leave_records
                 WHERE emp_id = '10000002' AND leave_category = 'COMP_OFF'),
               'COMP_OFF approvals add no row (the stamp records them)');

  PERFORM t.ok(EXISTS (SELECT 1 FROM public.leave_sheet_push_queue WHERE emp_id = '10000001')
               AND NOT EXISTS (SELECT 1 FROM public.leave_sheet_push_queue WHERE emp_id = '10000003'),
               'push queue holds employees with sheet-representable app rows only');

  PERFORM t.ok(EXISTS (SELECT 1 FROM public.leave_audit_log WHERE action = 'register_backfill_from_requests'),
               'the one-time register backfill is audited');

  PERFORM t.ok((SELECT NOT is_active FROM public.sync_jobs WHERE job_name = 'sync-leave-records'),
               'legacy sync-leave-records job is deactivated (R13)');
END $$;


-- ═══ S1 — an unchanged feed changes nothing, and keeps the app's comp-off ═══
DO $$
DECLARE
  r JSONB;
  v_before TIMESTAMPTZ;
BEGIN
  RAISE NOTICE '── S1 unchanged feed';
  SELECT last_queued_at INTO v_before FROM public.leave_sheet_push_queue WHERE emp_id = '10000002';

  r := t.sync();
  PERFORM t.ok(r->>'status' = 'committed', 'run committed');
  PERFORM t.ok((r->>'inserted')::INT = 0 AND (r->>'updated')::INT = 0,
               format('no inserts or updates (got %s / %s)', r->>'inserted', r->>'updated'));
  PERFORM t.ok((r->>'retired')::INT = 0 AND r->>'retire_status' = 'none', 'nothing retired');

  PERFORM t.ok((t.rec('10000002', 'COMP_OFF_EARNED', '2026-03-04')).leave_used_on = '2026-05-02'
               AND (t.rec('10000002', 'COMP_OFF_EARNED', '2026-03-04')).metadata->>'leave_request_id'
                   = '11111111-0000-0000-0000-000000000005',
               'the sheet not having the comp-off date yet does not undo the allocation (R2)');

  PERFORM t.ok((SELECT last_queued_at FROM public.leave_sheet_push_queue WHERE emp_id = '10000002')
               IS NOT DISTINCT FROM v_before,
               'a sync write never queues a push');
END $$;


-- ═══ S2 — the clerk catches up with an app approval ═══════════════════════════
DO $$
DECLARE
  r JSONB;
  v RECORD;
BEGIN
  RAISE NOTICE '── S2 sheet catches up';
  INSERT INTO t.feed (emp_id, employee_name, status, leave_category, source_event_type, event_kind,
                      leave_date, duty_code, raw_date_value, raw_event, metadata)
  VALUES ('10000001', 'ALPHA ONE', 'Active', 'CL', 'CL', 'leave', '2026-05-11', '', '11-May-2026', '{}', '{}');

  r := t.sync();
  PERFORM t.ok((r->>'inserted')::INT = 0 AND (r->>'updated')::INT = 1,
               format('lands on the app row (inserted %s, updated %s)', r->>'inserted', r->>'updated'));

  v := t.rec('10000001', 'CL', '2026-05-11');
  PERFORM t.ok(t.count_rec('10000001', 'CL', '2026-05-11') = 1, 'still one row for the fact');
  PERFORM t.ok(v.source = 'webapp', 'row stays app-owned');
  PERFORM t.ok(v.metadata ? 'sheet_confirmed_at' AND NOT v.metadata ? 'sheet_shadow',
               'agreement recorded, no spurious conflict over formatting (R16)');
  PERFORM t.ok(v.raw_date_value = '11-May-2026' AND v.status = 'Active',
               'informational columns follow the sheet');

  -- The events-shaped feed files a CL under source_event_type 'CASUAL_LEAVE',
  -- a different unique key from the app's 'CL'. It must still be one fact.
  INSERT INTO t.feed (emp_id, employee_name, status, leave_category, source_event_type, event_kind,
                      leave_date, duty_code, raw_date_value, raw_event, metadata)
  VALUES ('10000001', 'ALPHA ONE', 'Active', 'CL', 'CASUAL_LEAVE', 'leave', '2026-05-12', '',
          '12-May-2026', '{"type":"CASUAL_LEAVE"}', '{}');

  r := t.sync();
  v := t.rec('10000001', 'CL', '2026-05-12');
  PERFORM t.ok(t.count_rec('10000001', 'CL', '2026-05-12') = 1 AND (r->>'inserted')::INT = 0,
               'an events-shaped sheet row meets the app row instead of duplicating it');
  PERFORM t.ok(v.source = 'webapp' AND v.source_event_type = 'CASUAL_LEAVE'
               AND v.metadata ? 'sheet_confirmed_at',
               'the app row moves onto the sheet''s key and is confirmed');
END $$;


-- ═══ S3 — the sheet disagrees with an app allocation ═════════════════════════
DO $$
DECLARE
  r JSONB;
  v RECORD;
BEGIN
  RAISE NOTICE '── S3 conflicting comp-off date';
  UPDATE t.feed SET leave_used_on = '2026-05-20', raw_leave_used_value = '20-May-2026'
   WHERE emp_id = '10000002' AND leave_category = 'COMP_OFF_EARNED';

  r := t.sync();
  v := t.rec('10000002', 'COMP_OFF_EARNED', '2026-03-04');
  PERFORM t.ok(v.leave_used_on = '2026-05-02', 'app allocation date kept');
  PERFORM t.ok(v.metadata->'sheet_shadow'->>'leave_used_on' = '2026-05-20',
               'sheet value parked as a conflict');

  -- A supervisor keeps the app's value …
  PERFORM t.as_user(t.uid('sup'));
  PERFORM public.resolve_leave_sheet_conflict(v.id, 'keep_app', 'test');
  PERFORM t.ok(NOT (t.rec('10000002', 'COMP_OFF_EARNED', '2026-03-04')).metadata ? 'sheet_shadow',
               'resolve_leave_sheet_conflict still clears the shadow');

  -- … and the clerk corrects the sheet.
  UPDATE t.feed SET leave_used_on = '2026-05-02', raw_leave_used_value = '02-May-2026'
   WHERE emp_id = '10000002' AND leave_category = 'COMP_OFF_EARNED';
  r := t.sync();
  v := t.rec('10000002', 'COMP_OFF_EARNED', '2026-03-04');
  PERFORM t.ok(v.metadata ? 'sheet_confirmed_at' AND NOT v.metadata ? 'sheet_shadow',
               'agreement confirmed once the sheet matches');
END $$;


-- ═══ S4 — a row removed from the sheet is retired to the archive ═════════════
DO $$
DECLARE
  r JSONB;
BEGIN
  RAISE NOTICE '── S4 legitimate removal';
  DELETE FROM t.feed WHERE emp_id = '10000001' AND leave_category = 'CL' AND leave_date = '2026-02-10';

  r := t.sync();
  PERFORM t.ok((r->>'retired')::INT = 1 AND r->>'retire_status' = 'applied', 'one row retired');
  PERFORM t.ok(t.count_rec('10000001', 'CL', '2026-02-10') = 0, 'gone from the register');
  PERFORM t.ok(EXISTS (SELECT 1 FROM public.employee_leave_records_archive
                        WHERE emp_id = '10000001' AND leave_date = '2026-02-10'
                          AND reason = 'missing_from_sheet' AND run_id = (r->>'run_id')::UUID),
               'archived with its run (R1)');
END $$;


-- ═══ S5 — a sheet row linked to an approval is never retired ═════════════════
DO $$
DECLARE
  r JSONB;
BEGIN
  RAISE NOTICE '── S5 linked row missing from sheet';
  DELETE FROM t.feed WHERE emp_id = '10000001' AND leave_category = 'CL' AND leave_date = '2026-03-05';

  r := t.sync();
  PERFORM t.ok((r->>'protected_missing')::INT = 1 AND (r->>'retired')::INT = 0,
               'flagged, not retired');
  PERFORM t.ok((t.rec('10000001', 'CL', '2026-03-05')).metadata ? 'sheet_missing_since',
               'marked missing from the sheet');

  INSERT INTO t.feed SELECT * FROM public.__test_sheet_snapshot
   WHERE emp_id = '10000001' AND leave_category = 'CL' AND leave_date = '2026-03-05';
  r := t.sync();
  PERFORM t.ok(NOT (t.rec('10000001', 'CL', '2026-03-05')).metadata ? 'sheet_missing_since'
               AND (t.rec('10000001', 'CL', '2026-03-05')).metadata ? 'register_link_request_id',
               'flag clears when it reappears; the link survives');
END $$;


-- ═══ S6 — approving writes the register in the same transaction ═════════════
DO $$
DECLARE
  v_id UUID := '22222222-0000-0000-0000-000000000001';
  v_sup UUID := t.uid('sup');
  r JSONB;
BEGIN
  RAISE NOTICE '── S6 approval and cancellation';
  -- The clerk already typed the first day in (events-shaped key).
  INSERT INTO t.feed (emp_id, employee_name, status, leave_category, source_event_type, event_kind,
                      leave_date, duty_code, raw_date_value, raw_event, metadata)
  VALUES ('10000003', 'GAMMA THREE', 'Active', 'CL', 'CASUAL_LEAVE', 'leave', '2026-07-01', '',
          '01-Jul-2026', '{"type":"CASUAL_LEAVE"}', '{}');
  r := t.sync();

  PERFORM t.as_backend();
  INSERT INTO public.leave_requests (id, employee_id, employee_name, leave_type, start_date, end_date,
                                     total_days, status, ch_comp_off_dates)
  VALUES (v_id, t.uid('e3'), 'GAMMA THREE', 'CL', '2026-07-01', '2026-07-03', 2, 'Pending WSO',
          '[{"date":"2026-07-02","holiday_id":null,"holiday_name":"CH"}]');

  PERFORM t.ok((SELECT count(*) = 0 FROM public.employee_leave_records
                 WHERE metadata->>'leave_request_id' = v_id::TEXT
                    OR metadata->>'register_link_request_id' = v_id::TEXT),
               'pending requests write nothing');

  -- As PostgREST runs it: role authenticated, which cannot execute the register
  -- helpers itself. The SECURITY DEFINER trigger must still write the rows.
  PERFORM t.as_user(t.uid('sup'));
  SET LOCAL ROLE authenticated;
  UPDATE public.leave_requests
     SET status = 'Approved', supervisor_approved_by = v_sup, supervisor_approved_at = now(),
         direct_supervisor_approved = true, direct_supervisor_approved_by = v_sup,
         direct_supervisor_approved_at = now()
   WHERE id = v_id;
  RESET ROLE;

  PERFORM t.ok((SELECT array_agg(leave_date ORDER BY leave_date) FROM public.employee_leave_records
                 WHERE metadata->>'leave_request_id' = v_id::TEXT AND source = 'webapp')
               = ARRAY['2026-07-03']::DATE[],
               'approval writes a row for the day the sheet lacks …');
  PERFORM t.ok((t.rec('10000003', 'CL', '2026-07-01')).metadata->>'register_link_request_id' = v_id::TEXT
               AND t.count_rec('10000003', 'CL', '2026-07-01') = 1,
               '… links the day the sheet has, whatever its key …');
  PERFORM t.ok(t.count_rec('10000003', 'CL', '2026-07-02') = 0, '… and skips the closed holiday');
  PERFORM t.ok(EXISTS (SELECT 1 FROM public.leave_sheet_push_queue WHERE emp_id = '10000003'),
               'approval queues a push');

  SET LOCAL ROLE authenticated;
  UPDATE public.leave_requests SET status = 'Cancelled' WHERE id = v_id;
  RESET ROLE;

  PERFORM t.ok(t.count_rec('10000003', 'CL', '2026-07-03') = 0,
               'cancellation removes the app row');
  PERFORM t.ok(t.count_rec('10000003', 'CL', '2026-07-01') = 1
               AND NOT (t.rec('10000003', 'CL', '2026-07-01')).metadata ? 'register_link_request_id',
               '… and only unlinks the sheet''s row');
  PERFORM t.ok((SELECT count(*) = 1 FROM public.employee_leave_records_archive
                 WHERE row_data->'metadata'->>'leave_request_id' = v_id::TEXT
                   AND reason = 'request_cancelled'),
               'the removed row is archived');
  PERFORM t.ok((SELECT removals @> '[{"category":"CL","date":"2026-07-03","reason":"request_cancelled"}]'
                  FROM public.leave_sheet_push_queue WHERE emp_id = '10000003'),
               'the removal is queued for the clerk');
END $$;


-- ═══ S7 — cancelling a backfilled leave through the normal path (R10) ═══════
DO $$
DECLARE
  r JSONB;
BEGIN
  RAISE NOTICE '── S7 backfill then cancel';
  PERFORM t.as_user(t.uid('sup'));
  r := public.backfill_leave_entry('10000005', 'CL', '2026-08-03', '2026-08-04', 2);
  PERFORM t.ok((r->>'ok')::BOOLEAN AND (r->>'records_written')::INT = 2, 'backfill wrote two rows');

  UPDATE public.leave_requests SET status = 'Cancelled' WHERE id = (r->>'leave_request_id')::UUID;
  PERFORM t.ok(t.count_rec('10000005', 'CL', '2026-08-03') = 0
               AND t.count_rec('10000005', 'CL', '2026-08-04') = 0,
               'cancel removes backfilled rows too');
END $$;


-- ═══ S8 — RPC role guards (R12) ═════════════════════════════════════════════
DO $$
DECLARE
  v_denied BOOLEAN;
BEGIN
  RAISE NOTICE '── S8 role guards';
  PERFORM t.as_user(t.uid('e1'));

  v_denied := FALSE;
  BEGIN
    PERFORM public.restore_leave_balance(t.uid('e1'), 'cl', 2026, 50);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  PERFORM t.ok(v_denied, 'an employee cannot raise their own balance');

  v_denied := FALSE;
  BEGIN
    PERFORM public.clear_comp_off_for_leave('11111111-0000-0000-0000-000000000005', '10000002');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  PERFORM t.ok(v_denied, 'an employee cannot clear someone''s comp-off allocation');

  v_denied := FALSE;
  BEGIN
    PERFORM public.apply_leave_to_schedule(gen_random_uuid(), t.uid('e2'), '10000002', 'BETA TWO',
                                           '2026-09-01', '2026-09-01', 'CL');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  PERFORM t.ok(v_denied, 'an employee cannot write LEAVE onto the roster');

  v_denied := FALSE;
  BEGIN
    PERFORM public.close_leave_sheet_source('ATTENDANCE-2026', 'nope');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  PERFORM t.ok(v_denied, 'an employee cannot close the sheet');

  PERFORM t.as_user(t.uid('wso'));
  PERFORM public.restore_leave_balance(t.uid('e1'), 'cl', 2026, 1);
  PERFORM public.deduct_leave_balance(t.uid('e1'), 'cl', 2026, 1);
  PERFORM t.ok(TRUE, 'WSO can still restore and deduct (cancel / approve flows)');

  v_denied := FALSE;
  BEGIN
    PERFORM public.close_leave_sheet_source('ATTENDANCE-2026', 'nope');
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  PERFORM t.ok(v_denied, 'a WSO cannot close the sheet (admin only)');

  PERFORM t.as_backend();
END $$;

-- Internal functions are closed at the privilege level to the API roles, not
-- just to PUBLIC: Supabase's default privileges grant anon and authenticated
-- EXECUTE on every new function (reproduced in fixture.sql).
CREATE FUNCTION t.denied_to(p_role TEXT, p_call TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    EXECUTE 'SELECT ' || p_call;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    RETURN TRUE;
  END;
  RESET ROLE;
  RETURN FALSE;
END $$;
GRANT USAGE ON SCHEMA t TO anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA t TO anon, authenticated;

DO $$
DECLARE
  v_call TEXT;
  v_role TEXT;
BEGIN
  RAISE NOTICE '── S8b privileges';
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    FOREACH v_call IN ARRAY ARRAY[
      'public.commit_leave_sheet_sync(gen_random_uuid())',
      'public.prune_leave_sheet_staging(1)',
      'public.write_register_rows_for_request(gen_random_uuid())',
      'public.upsert_app_register_row(gen_random_uuid(), ''10000001'', ''X'', ''CL'', ''2026-12-01'', ''{}'')',
      'public.unlink_register_rows_for_request(gen_random_uuid())'
    ] LOOP
      PERFORM t.ok(t.denied_to(v_role, v_call), format('%s cannot call %s', v_role, split_part(v_call, '(', 1)));
    END LOOP;
  END LOOP;

  FOREACH v_call IN ARRAY ARRAY[
    'public.deduct_leave_balance(gen_random_uuid(), ''cl'', 2026, 1)',
    'public.close_leave_sheet_source(''ATTENDANCE-2026'', ''x'')'
  ] LOOP
    PERFORM t.ok(t.denied_to('anon', v_call), format('anon cannot call %s', split_part(v_call, '(', 1)));
  END LOOP;
END $$;


-- ═══ S9 — the old purge, and deletes in general (R1, R14) ═══════════════════
DO $$
DECLARE
  v_denied BOOLEAN := FALSE;
  v_before BIGINT;
  v_arch   UUID;
BEGIN
  RAISE NOTICE '── S9 delete guard';
  PERFORM t.as_backend();
  SELECT count(*) INTO v_before FROM public.employee_leave_records;

  BEGIN
    -- What the pre-migration fetch-leave-data runs after every sync.
    DELETE FROM public.employee_leave_records
     WHERE source = 'google_sheets' AND sync_batch_id <> 'leave-sync-999';
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  PERFORM t.ok(v_denied, 'the legacy stale-row purge is refused');
  PERFORM t.ok((SELECT count(*) FROM public.employee_leave_records) = v_before, 'nothing deleted');

  -- An app row can be deleted, but lands in the archive and can be restored.
  DELETE FROM public.employee_leave_records WHERE emp_id = '10000001' AND leave_category = 'CL'
     AND leave_date = '2026-05-12';
  SELECT archive_id INTO v_arch FROM public.employee_leave_records_archive
   WHERE emp_id = '10000001' AND leave_date = '2026-05-12' AND reason = 'deleted';
  PERFORM t.ok(v_arch IS NOT NULL, 'a deleted app row is archived');

  PERFORM t.as_user(t.uid('sup'));
  v_denied := FALSE;
  BEGIN
    PERFORM public.restore_archived_leave_record(v_arch);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  PERFORM t.ok(v_denied, 'restoring is admin-only');

  PERFORM t.as_user(t.uid('admin'));
  PERFORM t.ok((public.restore_archived_leave_record(v_arch, 'test')->>'ok')::BOOLEAN,
               'admin restores it');
  PERFORM t.ok(t.count_rec('10000001', 'CL', '2026-05-12') = 1, 'row is back');
  PERFORM t.as_backend();
END $$;


-- ═══ S10 — a legacy-style overwrite of an allocated row (R2) ════════════════
DO $$
DECLARE
  v RECORD;
BEGIN
  RAISE NOTICE '── S10 legacy upsert';
  PERFORM t.as_backend();
  -- The shape of the old edge function's upsert: new batch, whole metadata.
  UPDATE public.employee_leave_records
     SET leave_used_on = NULL, raw_leave_used_value = NULL, metadata = '{"duty_date":"2026-03-04"}',
         sync_batch_id = 'leave-sync-legacy', source = 'google_sheets'
   WHERE emp_id = '10000002' AND leave_category = 'COMP_OFF_EARNED';

  v := t.rec('10000002', 'COMP_OFF_EARNED', '2026-03-04');
  PERFORM t.ok(v.leave_used_on = '2026-05-02'
               AND v.metadata->>'leave_request_id' = '11111111-0000-0000-0000-000000000005',
               'allocation survives any sync writer, not only the new one');
END $$;


-- ═══ S11 — balance is derived from the register (R4) ════════════════════════
DO $$
DECLARE
  r JSONB;
  v_expected NUMERIC;
BEGIN
  RAISE NOTICE '── S11 recompute';
  SELECT count(*) INTO v_expected FROM public.employee_leave_records
   WHERE emp_id = '10000001' AND leave_category = 'CL'
     AND leave_date BETWEEN '2026-01-01' AND '2026-12-31';

  PERFORM t.as_user(t.uid('sup'));
  r := public.recompute_leave_balance(t.uid('e1'), 2026, true);
  PERFORM t.ok(r->>'basis' = 'register' AND (r->'cl'->>'used')::NUMERIC = v_expected,
               format('CL used = register rows (%s)', v_expected));
  PERFORM t.ok((r->'rh'->>'used')::NUMERIC = 1, 'RH used = register RH rows');
  PERFORM t.as_backend();
END $$;


-- ═══ S12 — a truncated feed cannot empty the register (R1) ══════════════════
DO $$
DECLARE
  r JSONB;
  v_before BIGINT;
BEGIN
  RAISE NOTICE '── S12 truncated feed';
  CREATE TABLE t.full_feed AS SELECT * FROM t.feed;
  DELETE FROM t.feed WHERE emp_id NOT IN ('10000001', '10000002', '10000100');

  SELECT count(*) INTO v_before FROM public.employee_leave_records WHERE source = 'google_sheets';
  r := t.sync();
  PERFORM t.ok(r->>'status' = 'committed' AND r->>'retire_status' = 'blocked',
               'run commits but retirement is blocked: ' || COALESCE(r->>'blocked_reason', ''));
  PERFORM t.ok((SELECT count(*) FROM public.employee_leave_records WHERE source = 'google_sheets') = v_before,
               'no row retired');

  -- Supervisors cannot force it through; an admin can, and it is archived.
  PERFORM t.as_user(t.uid('sup'));
  BEGIN
    PERFORM public.approve_leave_sheet_retirement((r->>'run_id')::UUID);
    RAISE EXCEPTION 'FAIL: supervisor approved a retirement';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok   only an admin approves a blocked retirement';
  END;

  PERFORM t.as_user(t.uid('admin'));
  PERFORM t.ok((public.approve_leave_sheet_retirement((r->>'run_id')::UUID, 'test')->>'retired')::INT
               = (r->>'retire_candidates')::INT,
               'admin approval retires the candidates');
  PERFORM t.ok((SELECT count(*) FROM public.employee_leave_records_archive
                 WHERE reason = 'missing_from_sheet_approved') = (r->>'retire_candidates')::INT,
               '… every one of them archived');

  -- Put the sheet back; the rows return.
  PERFORM t.as_backend();
  DELETE FROM t.feed;
  INSERT INTO t.feed SELECT * FROM t.full_feed;
  r := t.sync();
  PERFORM t.ok((r->>'inserted')::INT = (SELECT count(*) FROM public.employee_leave_records_archive
                                         WHERE reason = 'missing_from_sheet_approved'),
               'a restored sheet re-inserts them');
END $$;


-- ═══ S13 — feeds that must write nothing at all ═════════════════════════════
DO $$
DECLARE
  r JSONB;
  v_before BIGINT;
BEGIN
  RAISE NOTICE '── S13 empty and wrong-year feeds';
  SELECT count(*) INTO v_before FROM public.employee_leave_records;

  CREATE TABLE t.saved_feed AS SELECT * FROM t.feed;
  DELETE FROM t.feed;
  r := t.sync();
  PERFORM t.ok(r->>'status' = 'failed', 'empty feed fails');

  -- Someone re-points the URL at next year's workbook.
  INSERT INTO t.feed (emp_id, employee_name, leave_category, source_event_type, event_kind,
                      leave_date, duty_code, raw_event, metadata)
  SELECT (10000100 + e)::TEXT, 'SHEET ONLY ' || e, 'CL', 'CL', 'leave', '2027-01-06', '', '{}', '{}'
    FROM generate_series(0, 39) e;
  r := t.sync();
  PERFORM t.ok(r->>'status' = 'rejected' AND r->>'error' LIKE '%2027 workbook%',
               'a next-year feed on this year''s source is rejected');
  PERFORM t.ok((SELECT count(*) FROM public.employee_leave_records) = v_before, 'nothing written');

  DELETE FROM t.feed;
  INSERT INTO t.feed SELECT * FROM t.saved_feed;
END $$;


-- ═══ S14 — closing the sheet, opening the next one ══════════════════════════
DO $$
DECLARE
  r JSONB;
  v_2026 BIGINT;
  v RECORD;
  v_run UUID;
  v_denied BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '── S14 year end';
  SELECT count(*) INTO v_2026 FROM public.employee_leave_records WHERE sheet_source = 'ATTENDANCE-2026';

  PERFORM t.as_user(t.uid('admin'));
  r := public.close_leave_sheet_source('ATTENDANCE-2026', 'Year end');
  PERFORM t.ok((r->>'ok')::BOOLEAN AND (r->>'frozen_rows')::BIGINT = v_2026, 'closed; rows frozen');
  PERFORM t.ok(NOT EXISTS (SELECT 1 FROM public.leave_sheet_push_queue), 'push queue cleared');

  -- A late run against the closed source writes nothing.
  r := t.sync('ATTENDANCE-2026');
  PERFORM t.ok(r->>'status' = 'rejected', 'sync against a closed source is rejected');

  PERFORM t.as_user(t.uid('admin'));
  PERFORM t.ok((public.activate_leave_sheet_source('ATTENDANCE-2027', 'ATTENDANCE-2027', 2027)->>'ok')::BOOLEAN,
               'next workbook activated');
  PERFORM t.ok(NOT (public.activate_leave_sheet_source('X-2028', 'X', 2028)->>'ok')::BOOLEAN,
               'only one live workbook at a time');

  -- The 2027 feed: one new CL, and last year's OPE comp-off now taken.
  DELETE FROM t.feed;
  INSERT INTO t.feed (emp_id, employee_name, status, leave_category, source_event_type, event_kind,
                      leave_date, leave_used_on, duty_code, raw_date_value, raw_event, metadata)
  VALUES
    ('10000001', 'ALPHA ONE', 'Active', 'CL', 'CL', 'leave', '2027-01-10', NULL, '', '10-Jan-2027', '{}', '{}'),
    ('10000001', 'ALPHA ONE', 'Active', 'OPE', 'OPE', 'comp_off_earned', '2025-12-03', '2027-01-15', '',
     '03-Dec-2025', '{}', '{"duty_date":"2025-12-03"}');
  r := t.sync();
  PERFORM t.ok(r->>'status' = 'committed' AND (r->>'retired')::INT = 0, '2027 run commits, retires nothing');

  PERFORM t.ok((SELECT count(*) FROM public.employee_leave_records WHERE sheet_source = 'ATTENDANCE-2026') = v_2026,
               'every 2026 row survives a 2027 feed that does not carry it');

  v := t.rec('10000001', 'OPE', '2025-12-03');
  PERFORM t.ok(v.leave_used_on = '2027-01-15' AND v.sheet_source = 'ATTENDANCE-2026'
               AND v.metadata->>'filled_from_source' = 'ATTENDANCE-2027',
               'a frozen row accepts a blank being filled, and stays 2026''s');

  UPDATE t.feed SET leave_used_on = '2027-02-01' WHERE leave_category = 'OPE';
  r := t.sync();
  v := t.rec('10000001', 'OPE', '2025-12-03');
  PERFORM t.ok(v.leave_used_on = '2027-01-15' AND v.metadata->'sheet_shadow'->>'leave_used_on' = '2027-02-01',
               'but never a change: that is a conflict');

  PERFORM t.as_backend();
  BEGIN
    DELETE FROM public.employee_leave_records WHERE sheet_source = 'ATTENDANCE-2026';
  EXCEPTION WHEN insufficient_privilege THEN v_denied := TRUE;
  END;
  PERFORM t.ok(v_denied, 'frozen rows cannot be deleted');
END $$;

DO $$ BEGIN RAISE NOTICE '── all scenarios passed'; END $$;
