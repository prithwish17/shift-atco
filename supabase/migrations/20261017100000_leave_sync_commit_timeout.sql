-- ─────────────────────────────────────────────────────────────────────────────
-- Leave sync: the commit timed out on every run from 2026-10-15
--
-- Every fetch-leave-data run since then, from the cron jobs and from the admin
-- button, ended in "Commit failed: canceling statement due to statement
-- timeout". The register was left as of the 2026-10-14 17:50 UTC sync.
--
-- Cause: commit_leave_sheet_sync() reads a run the planner has never seen. The
-- edge function stages the feed moments before the commit, after the last
-- ANALYZE, so the planner takes the new run_id for a rare value and estimates
-- it at about one row. The register was last analyzed on 2026-10-05, in the
-- minute 20261005100000 was applied and filled sheet_source, and has changed
-- too little since for autovacuum to analyze it again. Statistics taken before the
-- column was filled put this source's rows at about one row as well. With both
-- sides at "one row", the retirement step's NOT EXISTS becomes a nested loop
-- that compares every register row with every staged row: 9,700 x 4,850 = 47
-- million comparisons. Reproduced locally with production's row counts, that
-- takes 4 s, against 60 ms for the hash join the planner picks once either
-- table is analyzed. The project's smaller instance runs past the API's
-- statement timeout.
--
-- Each failed run also left its ~9,700 staged rows behind, because only a
-- successful commit prunes. By 2026-10-17 staging held 30 such runs: 400k rows,
-- 171 MB.
--
--   1. commit_leave_sheet_sync() analyzes staging.run_id before it reads the
--      run, so every run is planned with its real size.
--   2. prune_leave_sheet_staging() keeps what something still reads: the
--      newest committed runs per source (the newest backs a held-retirement
--      approval) and each closed source's final snapshot. Failed and rejected
--      runs are dropped, and a run is treated as abandoned after 15 minutes
--      instead of an hour. The default keep count goes from 12 runs to 3.
--   3. Once, now: the runs the timeouts left in 'staging' are marked failed,
--      staging is cut down to what prune keeps, and both tables are analyzed.
--
-- The edge function also stops leaving a run's rows behind when its commit
-- fails (supabase/functions/fetch-leave-data). Nothing here changes what a
-- sync writes to the register.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. commit_leave_sheet_sync — plan the run with its real size
-- ═══════════════════════════════════════════════════════════════════════════
-- Unchanged from 20261005100000 apart from the ANALYZE before the first read
-- of the staged run.

CREATE OR REPLACE FUNCTION public.commit_leave_sheet_sync(p_run_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run          public.leave_sheet_sync_runs;
  v_source       public.leave_sheet_sources;
  v_staged       INTEGER;
  v_employees    INTEGER;
  v_prev_emps    INTEGER;
  v_feed_year    INTEGER;
  v_source_rows  INTEGER;
  v_limit        INTEGER;
  v_inserted     INTEGER := 0;
  v_updated      INTEGER := 0;
  v_candidates   INTEGER := 0;
  v_protected    INTEGER := 0;
  v_retired      INTEGER := 0;
  v_block        TEXT;
  v_retire       TEXT;
  v_message      TEXT;
BEGIN
  -- One commit (or retirement approval, or source close) at a time.
  PERFORM pg_advisory_xact_lock(hashtext('leave_sheet_sync'));

  SELECT * INTO v_run FROM public.leave_sheet_sync_runs WHERE id = p_run_id FOR UPDATE;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Sync run % not found', p_run_id USING ERRCODE = 'P0002';
  END IF;
  IF v_run.status <> 'staging' THEN
    RAISE EXCEPTION 'Sync run % is %, not staging', p_run_id, v_run.status USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_source FROM public.leave_sheet_sources WHERE source_key = v_run.source_key;

  -- ── Refusals: nothing is written ─────────────────────────────────────────
  IF v_source.status <> 'active' THEN
    v_message := format('Source %s is closed — the sheet no longer feeds the register, nothing was written',
                        v_source.source_key);
    UPDATE public.leave_sheet_sync_runs
       SET status = 'rejected', finished_at = now(), error = v_message
     WHERE id = p_run_id;
    RETURN jsonb_build_object('ok', false, 'status', 'rejected', 'error', v_message);
  END IF;

  -- The edge function staged this run after the last ANALYZE, so the planner
  -- would take it for about one row and plan the joins below as nested loops
  -- over the whole feed (see the header of 20261017100000). run_id is the
  -- column it misjudges; the whole table costs 100x more, all of it in the
  -- JSONB columns.
  ANALYZE public.leave_sheet_sync_staging (run_id);

  SELECT count(*), count(DISTINCT emp_id) INTO v_staged, v_employees
    FROM public.leave_sheet_sync_staging WHERE run_id = p_run_id;

  IF v_staged = 0 THEN
    v_message := 'The feed produced no rows — nothing was written';
    UPDATE public.leave_sheet_sync_runs
       SET status = 'failed', finished_at = now(), rows_staged = 0, employees_count = 0, error = v_message
     WHERE id = p_run_id;
    RETURN jsonb_build_object('ok', false, 'status', 'failed', 'error', v_message);
  END IF;

  -- The workbook's own year, read from the dated leave it carries. A feed from
  -- a different year means the URL was re-pointed without registering a new
  -- source; writing it would attribute next year's rows to this one.
  SELECT mode() WITHIN GROUP (ORDER BY EXTRACT(YEAR FROM leave_date)::INTEGER)
    INTO v_feed_year
    FROM public.leave_sheet_sync_staging
   WHERE run_id = p_run_id AND leave_category IN ('CL', 'RH', 'NH');

  IF v_feed_year IS NOT NULL AND v_feed_year <> v_source.leave_year THEN
    v_message := format(
      'The feed looks like a %s workbook but the active source %s is for %s. '
      'Close %s and register the new workbook as its own source (docs/leave/RUNBOOK.md) '
      'instead of re-pointing the URL. Nothing was written.',
      v_feed_year, v_source.source_key, v_source.leave_year, v_source.source_key);
    UPDATE public.leave_sheet_sync_runs
       SET status = 'rejected', finished_at = now(), rows_staged = v_staged,
           employees_count = v_employees, error = v_message,
           stats = stats || jsonb_build_object('feed_year', v_feed_year)
     WHERE id = p_run_id;
    RETURN jsonb_build_object('ok', false, 'status', 'rejected', 'error', v_message);
  END IF;

  -- ── Re-key app rows onto the sheet's key ─────────────────────────────────
  -- For plain leave the key's source_event_type / duty_code only record which
  -- feed shape produced the row: the legacy feed files a CL as 'CL', the events
  -- feed as 'CASUAL_LEAVE'. An app-written row for the same employee, category
  -- and day is the same fact, so move it onto the key the sheet uses and let
  -- the upsert below meet it, rather than insert a second row that would count
  -- the leave twice.
  UPDATE public.employee_leave_records r
     SET source_event_type = s.source_event_type,
         duty_code         = s.duty_code
    FROM public.leave_sheet_sync_staging s
   WHERE s.run_id = p_run_id
     AND r.source = 'webapp'
     AND NOT public.is_comp_off_leave_category(r.leave_category)
     AND r.emp_id = s.emp_id
     AND r.leave_category = s.leave_category
     AND r.leave_date = s.leave_date
     AND (r.source_event_type, r.duty_code) IS DISTINCT FROM (s.source_event_type, s.duty_code)
     AND NOT EXISTS (
       SELECT 1 FROM public.employee_leave_records x
        WHERE x.emp_id = s.emp_id
          AND x.leave_category = s.leave_category
          AND x.source_event_type = s.source_event_type
          AND x.leave_date = s.leave_date
          AND x.duty_code = s.duty_code);

  -- ── Upsert: insert new facts, update changed ones, skip the rest ─────────
  -- The guard trigger decides what a sync may change on each existing row.
  WITH upserted AS (
    INSERT INTO public.employee_leave_records AS r (
      emp_id, employee_name, sl_no, status, leave_category, source_event_type,
      event_kind, leave_date, leave_used_on, duty_code, raw_date_value,
      raw_shift_value, raw_leave_used_value, raw_event, metadata,
      source, sheet_source, sync_batch_id
    )
    SELECT s.emp_id, s.employee_name, s.sl_no, s.status, s.leave_category, s.source_event_type,
           s.event_kind, s.leave_date, s.leave_used_on, s.duty_code, s.raw_date_value,
           s.raw_shift_value, s.raw_leave_used_value, s.raw_event, s.metadata,
           'google_sheets', v_source.source_key, p_run_id::TEXT
      FROM public.leave_sheet_sync_staging s
     WHERE s.run_id = p_run_id
    ON CONFLICT (emp_id, leave_category, source_event_type, leave_date, duty_code)
    DO UPDATE SET
      employee_name        = EXCLUDED.employee_name,
      sl_no                = EXCLUDED.sl_no,
      status               = EXCLUDED.status,
      event_kind           = EXCLUDED.event_kind,
      leave_used_on        = EXCLUDED.leave_used_on,
      raw_date_value       = EXCLUDED.raw_date_value,
      raw_shift_value      = EXCLUDED.raw_shift_value,
      raw_leave_used_value = EXCLUDED.raw_leave_used_value,
      raw_event            = EXCLUDED.raw_event,
      metadata             = EXCLUDED.metadata,
      source               = EXCLUDED.source,
      sheet_source         = EXCLUDED.sheet_source,
      sync_batch_id        = EXCLUDED.sync_batch_id
    WHERE (r.employee_name, r.sl_no, r.status, r.event_kind, r.leave_used_on,
           r.raw_date_value, r.raw_shift_value, r.raw_leave_used_value,
           r.raw_event, r.metadata, r.source, r.sheet_source)
          IS DISTINCT FROM
          (EXCLUDED.employee_name, EXCLUDED.sl_no, EXCLUDED.status, EXCLUDED.event_kind,
           EXCLUDED.leave_used_on, EXCLUDED.raw_date_value, EXCLUDED.raw_shift_value,
           EXCLUDED.raw_leave_used_value, EXCLUDED.raw_event, EXCLUDED.metadata,
           EXCLUDED.source, EXCLUDED.sheet_source)
    RETURNING (xmax = 0) AS was_inserted
  )
  SELECT count(*) FILTER (WHERE was_inserted), count(*) FILTER (WHERE NOT was_inserted)
    INTO v_inserted, v_updated
    FROM upserted;

  -- ── Retirement: this source's rows the feed no longer carries ────────────
  -- Rows linked to an app request are never retired: the sheet dropping them
  -- does not undo an approval. They are flagged instead.
  IF to_regclass('pg_temp.leave_retire_candidates') IS NULL THEN
    CREATE TEMP TABLE leave_retire_candidates (
      id UUID PRIMARY KEY,
      is_protected BOOLEAN NOT NULL
    ) ON COMMIT DROP;
  ELSE
    TRUNCATE pg_temp.leave_retire_candidates;
  END IF;

  INSERT INTO pg_temp.leave_retire_candidates (id, is_protected)
  SELECT r.id,
         (r.metadata ? 'leave_request_id' OR r.metadata ? 'register_link_request_id')
    FROM public.employee_leave_records r
   WHERE r.source = 'google_sheets'
     AND r.sheet_source = v_source.source_key
     AND NOT EXISTS (
       SELECT 1 FROM public.leave_sheet_sync_staging s
        WHERE s.run_id            = p_run_id
          AND s.emp_id            = r.emp_id
          AND s.leave_category    = r.leave_category
          AND s.source_event_type = r.source_event_type
          AND s.leave_date        = r.leave_date
          AND s.duty_code         = r.duty_code);

  SELECT count(*) FILTER (WHERE NOT is_protected), count(*) FILTER (WHERE is_protected)
    INTO v_candidates, v_protected
    FROM pg_temp.leave_retire_candidates;

  UPDATE public.employee_leave_records r
     SET metadata = COALESCE(r.metadata, '{}'::JSONB)
                    || jsonb_build_object('sheet_missing_since', to_jsonb(now()))
    FROM pg_temp.leave_retire_candidates c
   WHERE c.id = r.id
     AND c.is_protected
     AND NOT (COALESCE(r.metadata, '{}'::JSONB) ? 'sheet_missing_since');

  SELECT count(*) INTO v_source_rows
    FROM public.employee_leave_records
   WHERE source = 'google_sheets' AND sheet_source = v_source.source_key;

  v_limit := GREATEST(v_source.retire_max_rows,
                      floor(v_source_rows * v_source.retire_max_pct / 100.0)::INTEGER);

  SELECT employees_count INTO v_prev_emps
    FROM public.leave_sheet_sync_runs
   WHERE source_key = v_source.source_key
     AND status = 'committed'
     AND id <> p_run_id
   ORDER BY started_at DESC
   LIMIT 1;

  IF v_candidates > 0 THEN
    IF v_prev_emps IS NOT NULL
       AND v_employees < ceil(v_prev_emps * v_source.min_employee_ratio) THEN
      v_block := format(
        'The feed carries %s employees against %s in the last good run — it looks truncated.',
        v_employees, v_prev_emps);
    ELSIF v_candidates > v_limit THEN
      v_block := format(
        '%s rows would be retired, above this source''s limit of %s.',
        v_candidates, v_limit);
    END IF;
  END IF;

  IF v_block IS NULL AND v_candidates > 0 THEN
    PERFORM set_config('leave.sheet_retire', 'on', true);
    PERFORM set_config('leave.delete_reason', 'missing_from_sheet', true);
    PERFORM set_config('leave.delete_run_id', p_run_id::TEXT, true);

    DELETE FROM public.employee_leave_records r
     USING pg_temp.leave_retire_candidates c
     WHERE c.id = r.id AND NOT c.is_protected;
    GET DIAGNOSTICS v_retired = ROW_COUNT;

    PERFORM set_config('leave.sheet_retire', 'off', true);
    PERFORM set_config('leave.delete_reason', '', true);
    PERFORM set_config('leave.delete_run_id', '', true);
  END IF;

  v_retire := CASE
    WHEN v_block IS NOT NULL THEN 'blocked'
    WHEN v_retired > 0       THEN 'applied'
    ELSE 'none'
  END;

  UPDATE public.leave_sheet_sync_runs
     SET status            = 'committed',
         finished_at       = now(),
         rows_staged       = v_staged,
         employees_count   = v_employees,
         inserted          = v_inserted,
         updated           = v_updated,
         unchanged         = v_staged - v_inserted - v_updated,
         retire_status     = v_retire,
         retire_candidates = v_candidates,
         retired           = v_retired,
         protected_missing = v_protected,
         blocked_reason    = v_block,
         stats             = stats || jsonb_build_object(
                               'feed_year', v_feed_year,
                               'retire_limit', v_limit,
                               'previous_employees', v_prev_emps)
   WHERE id = p_run_id;

  UPDATE public.leave_sheet_sources
     SET last_run_id = p_run_id, last_synced_at = now()
   WHERE source_key = v_source.source_key;

  PERFORM public.prune_leave_sheet_staging();

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'committed',
    'run_id', p_run_id,
    'source', v_source.source_key,
    'rows_staged', v_staged,
    'employees', v_employees,
    'inserted', v_inserted,
    'updated', v_updated,
    'unchanged', v_staged - v_inserted - v_updated,
    'retire_status', v_retire,
    'retire_candidates', v_candidates,
    'retired', v_retired,
    'protected_missing', v_protected,
    'blocked_reason', v_block);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. prune_leave_sheet_staging — keep only what is still read
-- ═══════════════════════════════════════════════════════════════════════════
-- Staged rows are read by the commit of their own run, by
-- approve_leave_sheet_retirement() (the newest committed run only), by the
-- RUNBOOK §3 query (the same run), and as a closed source's final snapshot.
-- A failed or rejected run is never read again.

CREATE OR REPLACE FUNCTION public.prune_leave_sheet_staging(p_keep_runs INTEGER DEFAULT 3)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- An edge function lives at most a few minutes, so a run still staging after
  -- 15 minutes was abandoned by one that crashed or timed out.
  UPDATE public.leave_sheet_sync_runs
     SET status = 'failed', finished_at = now(),
         error = COALESCE(error, 'Abandoned: staged but never committed')
   WHERE status = 'staging'
     AND started_at < now() - INTERVAL '15 minutes';

  -- Keep the newest committed runs per source and every closed source's final
  -- snapshot. Runs still staging belong to a sync in progress.
  DELETE FROM public.leave_sheet_sync_staging st
   USING public.leave_sheet_sync_runs r
   WHERE r.id = st.run_id
     AND r.status <> 'staging'
     AND NOT EXISTS (
       SELECT 1
         FROM (SELECT id, row_number() OVER (PARTITION BY source_key ORDER BY started_at DESC) AS rn
                 FROM public.leave_sheet_sync_runs
                WHERE status = 'committed') kept
        WHERE kept.id = r.id AND kept.rn <= p_keep_runs)
     AND NOT EXISTS (
       SELECT 1 FROM public.leave_sheet_sources s WHERE s.final_run_id = r.id);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Once: clear what the timed-out runs left behind
-- ═══════════════════════════════════════════════════════════════════════════

-- One block, so it is atomic under psql's autocommit as well as in the CLI's
-- per-migration transaction.
DO $$
DECLARE
  v_failed INTEGER;
  v_before BIGINT;
  v_kept   BIGINT;
BEGIN
  UPDATE public.leave_sheet_sync_runs
     SET status = 'failed', finished_at = now(),
         error = COALESCE(error, 'Commit timed out (statement timeout); cleared by 20261017100000')
   WHERE status = 'staging'
     AND started_at < now() - INTERVAL '15 minutes';
  GET DIAGNOSTICS v_failed = ROW_COUNT;

  -- A DELETE would leave the 171 MB file in place until autovacuum got to it,
  -- and the ANALYZE every commit now runs would sample all of it. Copy out what
  -- prune keeps, plus any run still staging, and truncate.
  SELECT count(*) INTO v_before FROM public.leave_sheet_sync_staging;

  CREATE TEMP TABLE leave_staging_keep AS
  SELECT st.*
    FROM public.leave_sheet_sync_staging st
    JOIN public.leave_sheet_sync_runs r ON r.id = st.run_id
   WHERE r.status = 'staging'
      OR EXISTS (SELECT 1 FROM public.leave_sheet_sources s WHERE s.final_run_id = r.id)
      OR r.id IN (
        SELECT id
          FROM (SELECT id, row_number() OVER (PARTITION BY source_key ORDER BY started_at DESC) AS rn
                  FROM public.leave_sheet_sync_runs
                 WHERE status = 'committed') c
         WHERE c.rn <= 3);

  TRUNCATE public.leave_sheet_sync_staging;
  INSERT INTO public.leave_sheet_sync_staging SELECT * FROM leave_staging_keep;
  GET DIAGNOSTICS v_kept = ROW_COUNT;
  DROP TABLE leave_staging_keep;

  RAISE NOTICE 'Leave sync staging: % stuck run(s) marked failed, % staged row(s) cut to %',
    v_failed, v_before, v_kept;
END $$;

ANALYZE public.leave_sheet_sync_staging;
ANALYZE public.employee_leave_records;
