-- ─────────────────────────────────────────────────────────────────────────────
-- Leave register: the database is the system of record, the sheet is a source
--
-- Until now fetch-leave-data treated the ATTENDANCE workbook as the owner of the
-- register: every run upserted every column and then hard-deleted any
-- sheet-sourced row the feed did not carry. That made the app's leave history
-- only as durable as the sheet — re-point the URL at next year's workbook, or
-- let the feed come back short, and the history was gone. It also overwrote the
-- comp-off usage the app stamps onto sheet rows. See docs/leave/ARCHITECTURE.md
-- risks R1, R2, R13, R14, R16.
--
-- This migration changes the contract, additively:
--
--   1. leave_sheet_sources      A workbook is a registered source with a
--                               lifecycle (active → closed). Closing it freezes
--                               every row it contributed; nothing the sync does
--                               afterwards can change or remove them.
--   2. sheet_source column      Which source a sheet row came from, so a sync
--                               only ever reasons about its own rows.
--   3. Staged, atomic sync      The edge function stages the parsed feed and
--                               commit_leave_sheet_sync() applies it in one
--                               transaction.
--   4. No hard deletes          A row the feed stops carrying is *retired*: moved
--                               to employee_leave_records_archive, and only when
--                               the run passes circuit breakers (row count,
--                               employee count, workbook year). Otherwise the
--                               run is committed with retirement blocked until
--                               an admin approves it.
--   5. Guard triggers           Sync writes can never overwrite app facts (comp-
--                               off usage, register links), never touch a closed
--                               source except to fill a blank, and every delete
--                               of any register row is archived first.
--   6. Push queue + push log    Which employees have app-side changes the sheet
--                               has not been sent, and a durable record of every
--                               write made to the sheet.
--   7. Legacy sync-leave-records is unscheduled.
--
-- Deploy order: this migration, then 20261005110000, then the fetch-leave-data
-- edge function, then the Vercel API. Until the new edge function is deployed
-- the old one keeps upserting (now guarded) and its stale-row purge fails
-- loudly instead of deleting — see the delete guard in section 5.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 0. ACCESS HELPERS
-- ═══════════════════════════════════════════════════════════════════════════

-- True for a direct database session (SQL editor, migrations, pg_cron SQL) and
-- for the service role. PostgREST always sets request.jwt.claims — even for
-- anon — so an unset value can only be a direct connection.
CREATE OR REPLACE FUNCTION public.leave_caller_is_trusted_backend()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''),
                  NULLIF(current_setting('request.jwt.claim.role', true), '')) IS NULL
      OR COALESCE(auth.role(), '') = 'service_role'
$$;

-- Sheet lifecycle operations (close, activate, approve a retirement, restore
-- from the archive) are admin-only.
CREATE OR REPLACE FUNCTION public.can_manage_leave_sheet_sources()
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
              AND role = 'admin'
              AND approved = true)
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_leave_sheet_sources() TO authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. leave_sheet_sources — one row per workbook
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.leave_sheet_sources (
  source_key          TEXT PRIMARY KEY,
  label               TEXT NOT NULL,
  leave_year          INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  -- Read feed for this workbook. NULL falls back to app_settings.leave_data_webapp_url.
  read_url            TEXT,
  activated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by        UUID,
  closed_at           TIMESTAMPTZ,
  closed_by           UUID,
  close_reason        TEXT,
  -- The last committed run before closing: its staged snapshot is kept forever.
  final_run_id        UUID,
  last_run_id         UUID,
  last_synced_at      TIMESTAMPTZ,
  -- Circuit breakers for retirement. A run may retire up to
  -- GREATEST(retire_max_rows, retire_max_pct% of this source's rows) without
  -- approval, and only if it carries at least min_employee_ratio of the
  -- employees the previous committed run did.
  retire_max_rows     INTEGER NOT NULL DEFAULT 50 CHECK (retire_max_rows >= 0),
  retire_max_pct      NUMERIC(5,2) NOT NULL DEFAULT 2.00 CHECK (retire_max_pct >= 0),
  min_employee_ratio  NUMERIC(4,3) NOT NULL DEFAULT 0.900 CHECK (min_employee_ratio BETWEEN 0 AND 1),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one workbook is live at a time.
CREATE UNIQUE INDEX IF NOT EXISTS leave_sheet_sources_one_active
  ON public.leave_sheet_sources (status) WHERE status = 'active';

COMMENT ON TABLE public.leave_sheet_sources IS
  'Google Sheet workbooks the leave register is synced from. Closing one freezes every register row it contributed.';

-- The workbook every existing sheet row came from.
INSERT INTO public.leave_sheet_sources (source_key, label, leave_year, status)
VALUES ('ATTENDANCE-2026', 'ATTENDANCE-2026 · LEAVE_DATA', 2026, 'active')
ON CONFLICT (source_key) DO NOTHING;

ALTER TABLE public.leave_sheet_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_sheet_sources_staff_read ON public.leave_sheet_sources;
CREATE POLICY leave_sheet_sources_staff_read ON public.leave_sheet_sources
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_roles.user_id = auth.uid()
         AND user_roles.role IN ('wso', 'supervisor', 'admin')
         AND user_roles.approved = true)
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. employee_leave_records.sheet_source
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.employee_leave_records
  ADD COLUMN IF NOT EXISTS sheet_source TEXT
    REFERENCES public.leave_sheet_sources (source_key) ON UPDATE CASCADE;

COMMENT ON COLUMN public.employee_leave_records.sheet_source IS
  'Workbook that last supplied this row. Sheet rows are only ever retired by a sync of the same source, and are frozen once that source is closed.';

-- Every sheet row present today came from the one workbook the sync has read.
UPDATE public.employee_leave_records
   SET sheet_source = 'ATTENDANCE-2026'
 WHERE source = 'google_sheets'
   AND sheet_source IS NULL;

CREATE INDEX IF NOT EXISTS idx_elr_sheet_source
  ON public.employee_leave_records (sheet_source)
  WHERE source = 'google_sheets';


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. SYNC RUNS AND STAGING
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.leave_sheet_sync_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key          TEXT NOT NULL REFERENCES public.leave_sheet_sources (source_key) ON UPDATE CASCADE,
  status              TEXT NOT NULL DEFAULT 'staging'
                        CHECK (status IN ('staging', 'committed', 'failed', 'rejected')),
  triggered_by        TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  employees_count     INTEGER,
  rows_parsed         INTEGER,
  rows_staged         INTEGER,
  inserted            INTEGER,
  updated             INTEGER,
  unchanged           INTEGER,
  retire_status       TEXT CHECK (retire_status IN ('none', 'applied', 'blocked', 'approved')),
  retire_candidates   INTEGER,
  retired             INTEGER,
  protected_missing   INTEGER,
  blocked_reason      TEXT,
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,
  error               TEXT,
  stats               JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_leave_sheet_sync_runs_source
  ON public.leave_sheet_sync_runs (source_key, started_at DESC);

ALTER TABLE public.leave_sheet_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_sheet_sync_runs_staff_read ON public.leave_sheet_sync_runs;
CREATE POLICY leave_sheet_sync_runs_staff_read ON public.leave_sheet_sync_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_roles.user_id = auth.uid()
         AND user_roles.role IN ('wso', 'supervisor', 'admin')
         AND user_roles.approved = true)
  );

-- One parsed feed per run, keyed exactly like the register so a run can never
-- carry two rows for one fact. Service role only: no policies.
CREATE TABLE IF NOT EXISTS public.leave_sheet_sync_staging (
  run_id                UUID NOT NULL REFERENCES public.leave_sheet_sync_runs (id) ON DELETE CASCADE,
  emp_id                TEXT NOT NULL,
  employee_name         TEXT NOT NULL DEFAULT '',
  sl_no                 INTEGER,
  status                TEXT,
  leave_category        TEXT NOT NULL,
  source_event_type     TEXT NOT NULL DEFAULT '',
  event_kind            TEXT NOT NULL DEFAULT 'other',
  leave_date            DATE NOT NULL,
  leave_used_on         DATE,
  duty_code             TEXT NOT NULL DEFAULT '',
  raw_date_value        TEXT,
  raw_shift_value       TEXT,
  raw_leave_used_value  TEXT,
  raw_event             JSONB NOT NULL DEFAULT '{}'::JSONB,
  metadata              JSONB NOT NULL DEFAULT '{}'::JSONB,
  PRIMARY KEY (run_id, emp_id, leave_category, source_event_type, leave_date, duty_code)
);

ALTER TABLE public.leave_sheet_sync_staging ENABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. employee_leave_records_archive — nothing is deleted without a copy
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.employee_leave_records_archive (
  archive_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id           UUID NOT NULL,
  emp_id              TEXT NOT NULL,
  leave_category      TEXT NOT NULL,
  leave_date          DATE NOT NULL,
  source              TEXT,
  sheet_source        TEXT,
  row_data            JSONB NOT NULL,
  -- missing_from_sheet | missing_from_sheet_approved | request_cancelled | deleted
  reason              TEXT NOT NULL,
  run_id              UUID,
  archived_by         UUID,
  archived_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at         TIMESTAMPTZ,
  restored_by         UUID
);

CREATE INDEX IF NOT EXISTS idx_elr_archive_emp_date
  ON public.employee_leave_records_archive (emp_id, leave_date);
CREATE INDEX IF NOT EXISTS idx_elr_archive_archived_at
  ON public.employee_leave_records_archive (archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_elr_archive_run
  ON public.employee_leave_records_archive (run_id) WHERE run_id IS NOT NULL;

ALTER TABLE public.employee_leave_records_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS elr_archive_staff_read ON public.employee_leave_records_archive;
CREATE POLICY elr_archive_staff_read ON public.employee_leave_records_archive
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_roles.user_id = auth.uid()
         AND user_roles.role IN ('wso', 'supervisor', 'admin')
         AND user_roles.approved = true)
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. DELETE GUARD — archive every delete; sheet rows only via retirement
-- ═══════════════════════════════════════════════════════════════════════════
-- A sheet row may only leave the register through commit_leave_sheet_sync() or
-- approve_leave_sheet_retirement(), which set leave.sheet_retire for the
-- duration of their DELETE. Anything else — the old edge function's stale-row
-- purge, a staff member deleting through the "Staff manage leave records"
-- policy — is refused. App-owned rows may be deleted (amendment, cancellation)
-- but are copied to the archive first, with the reason the caller set.

CREATE OR REPLACE FUNCTION public.archive_deleted_leave_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason TEXT := NULLIF(current_setting('leave.delete_reason', true), '');
  v_run    TEXT := NULLIF(current_setting('leave.delete_run_id', true), '');
BEGIN
  IF OLD.source = 'google_sheets'
     AND COALESCE(current_setting('leave.sheet_retire', true), '') <> 'on' THEN
    RAISE EXCEPTION
      'Sheet-sourced leave record % (% % %) cannot be deleted directly',
      OLD.id, OLD.emp_id, OLD.leave_category, OLD.leave_date
      USING ERRCODE = '42501',
            HINT = 'Rows the sheet stops carrying are retired and archived by commit_leave_sheet_sync(). See docs/leave/RUNBOOK.md.';
  END IF;

  INSERT INTO public.employee_leave_records_archive (
    record_id, emp_id, leave_category, leave_date, source, sheet_source,
    row_data, reason, run_id, archived_by
  ) VALUES (
    OLD.id, OLD.emp_id, OLD.leave_category, OLD.leave_date, OLD.source, OLD.sheet_source,
    to_jsonb(OLD), COALESCE(v_reason, 'deleted'), v_run::UUID, auth.uid()
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS archive_deleted_leave_record ON public.employee_leave_records;
CREATE TRIGGER archive_deleted_leave_record
  BEFORE DELETE ON public.employee_leave_records
  FOR EACH ROW
  EXECUTE FUNCTION public.archive_deleted_leave_record();


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. UPDATE GUARD — what a sync write may change
-- ═══════════════════════════════════════════════════════════════════════════
-- Replaces the body of the trigger added in 20260816100000, keeping its name so
-- there is still exactly one policing trigger, firing before the updated_at one.
--
-- A sync write is recognised by NEW.source = 'google_sheets' together with a
-- new sync_batch_id (every run stamps its own) or an attempt to take over an
-- app-owned row. Nothing else in the app sets sync_batch_id, so app-side writes
-- — allocate_comp_off_for_leave, backfill, conflict resolution — pass through.
--
-- For a sync write:
--
--   A. App-owned row (source = 'webapp')
--      The app's facts stand. Informational columns (name, status, raw text)
--      follow the sheet. A blank used-date is filled; a different used-date or
--      event kind is parked in metadata.sheet_shadow. Agreement is recorded as
--      metadata.sheet_confirmed_at.
--
--   B. Row from a closed source
--      Frozen. The live workbook may fill a blank used-date — a carried-over
--      comp-off taken in the new year — and nothing else. The row stays
--      attributed to the closed source.
--
--   C. Sheet row carrying an app comp-off allocation (metadata.leave_request_id)
--      The sheet owns the row, the app owns the allocation: the used-date and
--      allocation keys are kept; a different used-date from the sheet is a
--      conflict, a blank one just means the clerk has not caught up.
--
--   D. Plain sheet row
--      The sheet's version is taken, keeping any app-only metadata keys (a
--      register link from an approval, for instance).
--
-- A write that changes nothing but the batch id is skipped entirely.
--
-- Conflicts are only raised on facts — the used-date and the event kind — not
-- on formatting. The previous version compared raw text and status and flagged
-- every app row the sheet caught up with.

CREATE OR REPLACE FUNCTION public.protect_app_authored_leave_records()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Keys only the app ever writes into metadata.
  c_app_only_keys CONSTANT TEXT[] := ARRAY[
    'leave_request_id', 'request_start_date', 'request_end_date',
    'backfill_record', 'origin', 'backfilled_by', 'backfilled_at',
    'register_link_request_id', 'app_register_record', 'restored_from_archive',
    'sheet_shadow', 'sheet_seen_at', 'sheet_accepted_at', 'sheet_rejected_at',
    'sheet_confirmed_at', 'sheet_missing_since', 'filled_from_source'];
  v_old_meta      JSONB := COALESCE(OLD.metadata, '{}'::JSONB);
  v_app_meta      JSONB;
  v_in_used       DATE  := NEW.leave_used_on;
  v_in_raw_used   TEXT  := NEW.raw_leave_used_value;
  v_in_kind       TEXT  := NEW.event_kind;
  v_in_meta       JSONB := COALESCE(NEW.metadata, '{}'::JSONB);
  v_in_source     TEXT  := NEW.sheet_source;
  v_in_batch      TEXT  := NEW.sync_batch_id;
  v_incoming      JSONB;
  v_conflict      BOOLEAN := FALSE;
  v_agrees        BOOLEAN := FALSE;
  v_closed        BOOLEAN;
BEGIN
  IF NEW.source IS DISTINCT FROM 'google_sheets'
     OR (OLD.source IS DISTINCT FROM 'webapp'
         AND NEW.sync_batch_id IS NOT DISTINCT FROM OLD.sync_batch_id) THEN
    RETURN NEW;   -- not a sync write
  END IF;

  -- What the sheet sent, in the shape resolve_leave_sheet_conflict() applies.
  v_incoming := jsonb_strip_nulls(jsonb_build_object(
    'employee_name',        NEW.employee_name,
    'status',               NEW.status,
    'leave_used_on',        NEW.leave_used_on,
    'raw_leave_used_value', NEW.raw_leave_used_value,
    'raw_date_value',       NEW.raw_date_value,
    'raw_shift_value',      NEW.raw_shift_value,
    'event_kind',           NEW.event_kind));

  SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::JSONB)
    INTO v_app_meta
    FROM jsonb_each(v_old_meta) AS e(key, value)
   WHERE e.key = ANY (c_app_only_keys);

  -- The row is in this feed, so it is no longer missing from the sheet.
  v_app_meta := v_app_meta - 'sheet_missing_since';

  v_closed := OLD.source = 'google_sheets' AND EXISTS (
    SELECT 1 FROM public.leave_sheet_sources s
     WHERE s.source_key = OLD.sheet_source AND s.status = 'closed');

  IF OLD.source = 'webapp' THEN
    -- ── A. app-owned row ────────────────────────────────────────────────────
    v_conflict := (v_in_used IS NOT NULL AND OLD.leave_used_on IS NOT NULL
                   AND v_in_used <> OLD.leave_used_on)
               OR v_in_kind IS DISTINCT FROM OLD.event_kind;

    NEW.source               := 'webapp';
    NEW.event_kind           := OLD.event_kind;
    NEW.leave_used_on        := COALESCE(OLD.leave_used_on, v_in_used);
    NEW.raw_leave_used_value := CASE WHEN OLD.leave_used_on IS NOT NULL
                                     THEN OLD.raw_leave_used_value ELSE v_in_raw_used END;
    NEW.metadata             := v_old_meta - 'sheet_missing_since';
    v_agrees := NOT v_conflict AND v_in_used IS NOT DISTINCT FROM NEW.leave_used_on;

  ELSIF v_closed THEN
    -- ── B. frozen row from a closed workbook ───────────────────────────────
    v_conflict := v_in_used IS NOT NULL AND OLD.leave_used_on IS NOT NULL
                  AND v_in_used <> OLD.leave_used_on;

    NEW := OLD;
    -- Keep the run's batch id so every trigger downstream still sees a sync
    -- write; sheet_source stays the closed one, which is what keeps the row
    -- out of the live source's retirement.
    NEW.sync_batch_id := v_in_batch;
    IF OLD.leave_used_on IS NULL AND v_in_used IS NOT NULL THEN
      NEW.leave_used_on        := v_in_used;
      NEW.raw_leave_used_value := v_in_raw_used;
      NEW.metadata := v_old_meta
        || jsonb_build_object('leave_used_on', to_char(v_in_used, 'YYYY-MM-DD'),
                              'leave_applied', to_char(v_in_used, 'YYYY-MM-DD'))
        || jsonb_strip_nulls(jsonb_build_object('filled_from_source', v_in_source));
    END IF;
    v_agrees := NOT v_conflict AND v_in_used IS NOT DISTINCT FROM NEW.leave_used_on;

  ELSIF v_old_meta ? 'leave_request_id' THEN
    -- ── C. sheet row the app has allocated to a leave request ──────────────
    v_conflict := v_in_used IS NOT NULL AND v_in_used IS DISTINCT FROM OLD.leave_used_on;

    NEW.leave_used_on        := OLD.leave_used_on;
    NEW.raw_leave_used_value := OLD.raw_leave_used_value;
    NEW.metadata := v_in_meta
      || jsonb_strip_nulls(jsonb_build_object(
           'leave_used_on', v_old_meta->'leave_used_on',
           'leave_applied', v_old_meta->'leave_applied'))
      || v_app_meta;
    v_agrees := NOT v_conflict AND v_in_used IS NOT DISTINCT FROM OLD.leave_used_on;

  ELSE
    -- ── D. plain sheet row ──────────────────────────────────────────────────
    NEW.metadata := v_in_meta || v_app_meta;
    IF (to_jsonb(NEW) - 'sync_batch_id' - 'updated_at')
       = (to_jsonb(OLD) - 'sync_batch_id' - 'updated_at') THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Record agreement or disagreement for A-C.
  IF v_conflict THEN
    NEW.metadata := (NEW.metadata - 'sheet_confirmed_at')
      || jsonb_build_object(
           'sheet_shadow',  v_incoming,
           'sheet_seen_at', COALESCE(
             CASE WHEN v_old_meta->'sheet_shadow' = v_incoming THEN v_old_meta->'sheet_seen_at' END,
             to_jsonb(now())));
  ELSIF v_agrees THEN
    NEW.metadata := (NEW.metadata - 'sheet_shadow' - 'sheet_seen_at')
      || jsonb_build_object('sheet_confirmed_at',
           COALESCE(v_old_meta->'sheet_confirmed_at', to_jsonb(now())));
  ELSE
    -- The sheet has not caught up with the app yet: neither a conflict nor a
    -- confirmation.
    NEW.metadata := NEW.metadata - 'sheet_shadow' - 'sheet_seen_at' - 'sheet_confirmed_at';
  END IF;

  IF (to_jsonb(NEW) - 'sync_batch_id' - 'updated_at')
     = (to_jsonb(OLD) - 'sync_batch_id' - 'updated_at') THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged; recreate it in case it was dropped.
DROP TRIGGER IF EXISTS protect_app_authored_leave_records ON public.employee_leave_records;
CREATE TRIGGER protect_app_authored_leave_records
  BEFORE UPDATE ON public.employee_leave_records
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_app_authored_leave_records();


-- ═══════════════════════════════════════════════════════════════════════════
-- 7. PUSH QUEUE — employees with app changes the sheet has not been sent
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.leave_sheet_push_queue (
  emp_id            TEXT PRIMARY KEY,
  first_queued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_queued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_reason       TEXT,
  -- App-side removals (a cancelled leave). A push never deletes from the sheet,
  -- so these are listed for the clerk to remove by hand.
  removals          JSONB NOT NULL DEFAULT '[]'::JSONB,
  attempts          INTEGER NOT NULL DEFAULT 0,
  last_attempt_at   TIMESTAMPTZ,
  last_error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_leave_sheet_push_queue_queued
  ON public.leave_sheet_push_queue (last_queued_at);

ALTER TABLE public.leave_sheet_push_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_sheet_push_queue_staff_read ON public.leave_sheet_push_queue;
CREATE POLICY leave_sheet_push_queue_staff_read ON public.leave_sheet_push_queue
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_roles.user_id = auth.uid()
         AND user_roles.role IN ('wso', 'supervisor', 'admin')
         AND user_roles.approved = true)
  );

-- Categories whose leave_date is the duty that earned a comp-off, and whose
-- source_event_type / duty_code are part of what identifies the fact. For every
-- other category they only record which feed shape produced the row.
CREATE OR REPLACE FUNCTION public.is_comp_off_leave_category(p_category TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_category IN ('CH', 'COMP_OFF', 'COMP_OFF_EARNED', 'COMP_OFF_USED',
                        'LAST_YEAR_CH_DUTY', 'LAST_YEAR_COMP_OFF', 'OPE', 'OPE_COMP_OFF')
$$;

-- Categories the LEAVE_DATA tab has columns for (see lib/leaveSheetPayload.ts).
CREATE OR REPLACE FUNCTION public.is_sheet_leave_category(p_category TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_category IN ('CL', 'CL_1ST', 'CL_2ND', 'RH', 'NH',
                        'COMP_OFF_EARNED', 'COMP_OFF', 'LAST_YEAR_CH_DUTY', 'OPE')
$$;

CREATE OR REPLACE FUNCTION public.queue_leave_sheet_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp      TEXT;
  v_category TEXT;
  v_removal  JSONB := NULL;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Retirements mirror the sheet; there is nothing to send back.
    IF OLD.source IS DISTINCT FROM 'webapp' THEN RETURN NULL; END IF;
    v_emp := OLD.emp_id;
    v_category := OLD.leave_category;
    v_removal := jsonb_build_object(
      'category', OLD.leave_category,
      'date', to_char(OLD.leave_date, 'YYYY-MM-DD'),
      'reason', COALESCE(NULLIF(current_setting('leave.delete_reason', true), ''), 'deleted'),
      'at', now());
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.source IS DISTINCT FROM 'webapp' THEN RETURN NULL; END IF;
    v_emp := NEW.emp_id;
    v_category := NEW.leave_category;
  ELSE
    -- The sync's own writes are what the sheet already says. Only a sync run
    -- changes sync_batch_id, including when the guard keeps a row app-owned.
    IF NEW.sync_batch_id IS DISTINCT FROM OLD.sync_batch_id THEN
      RETURN NULL;
    END IF;
    IF NEW.leave_used_on IS NOT DISTINCT FROM OLD.leave_used_on
       AND NEW.source IS NOT DISTINCT FROM OLD.source
       AND (NEW.metadata -> 'leave_request_id') IS NOT DISTINCT FROM (OLD.metadata -> 'leave_request_id')
       AND (NEW.metadata -> 'register_link_request_id') IS NOT DISTINCT FROM (OLD.metadata -> 'register_link_request_id') THEN
      RETURN NULL;
    END IF;
    v_emp := NEW.emp_id;
    v_category := NEW.leave_category;
  END IF;

  IF NOT public.is_sheet_leave_category(v_category) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.leave_sheet_push_queue (emp_id, last_reason, removals)
  VALUES (
    v_emp,
    lower(TG_OP) || ' ' || v_category,
    CASE WHEN v_removal IS NULL THEN '[]'::JSONB ELSE jsonb_build_array(v_removal) END)
  ON CONFLICT (emp_id) DO UPDATE SET
    last_queued_at = now(),
    last_reason    = EXCLUDED.last_reason,
    removals       = public.leave_sheet_push_queue.removals || EXCLUDED.removals;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS queue_leave_sheet_push ON public.employee_leave_records;
CREATE TRIGGER queue_leave_sheet_push
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_leave_records
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_leave_sheet_push();


-- ═══════════════════════════════════════════════════════════════════════════
-- 8. PUSH LOG — every write made to the sheet
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.leave_sheet_push_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pushed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id        UUID,
  actor_email     TEXT,
  source_key      TEXT,
  sheet_tab       TEXT,
  mode            TEXT,
  dry_run         BOOLEAN NOT NULL,
  leave_year      INTEGER,
  emp_ids         TEXT[],
  payload_hash    TEXT,
  employees_sent  INTEGER,
  cells_changed   INTEGER,
  rows_written    INTEGER,
  conflicts       INTEGER,
  unmatched       INTEGER,
  -- The Apps Script response, including every cell's before/after.
  result          JSONB,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_leave_sheet_push_log_pushed
  ON public.leave_sheet_push_log (pushed_at DESC);

ALTER TABLE public.leave_sheet_push_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_sheet_push_log_staff_read ON public.leave_sheet_push_log;
CREATE POLICY leave_sheet_push_log_staff_read ON public.leave_sheet_push_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_roles.user_id = auth.uid()
         AND user_roles.role IN ('supervisor', 'admin')
         AND user_roles.approved = true)
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 9. commit_leave_sheet_sync — apply one staged feed atomically
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prune_leave_sheet_staging(p_keep_runs INTEGER DEFAULT 12)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  -- A run left in staging for an hour was abandoned by a crashed edge function.
  UPDATE public.leave_sheet_sync_runs
     SET status = 'failed', finished_at = now(),
         error = COALESCE(error, 'Abandoned: staged but never committed')
   WHERE status = 'staging'
     AND started_at < now() - INTERVAL '1 hour';

  -- Keep the newest runs per source, and every closed source's final snapshot.
  DELETE FROM public.leave_sheet_sync_staging st
   WHERE st.run_id IN (
     SELECT r.id
       FROM (SELECT id, row_number() OVER (PARTITION BY source_key ORDER BY started_at DESC) AS rn
               FROM public.leave_sheet_sync_runs) r
      WHERE r.rn > p_keep_runs
        AND r.id NOT IN (SELECT final_run_id FROM public.leave_sheet_sources
                          WHERE final_run_id IS NOT NULL));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

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
-- 10. approve_leave_sheet_retirement — let a blocked retirement through
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.approve_leave_sheet_retirement(
  p_run_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run      public.leave_sheet_sync_runs;
  v_latest   UUID;
  v_status   TEXT;
  v_staged   INTEGER;
  v_retired  INTEGER;
BEGIN
  IF NOT public.can_manage_leave_sheet_sources() THEN
    RAISE EXCEPTION 'Only an admin may approve a leave sheet retirement' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('leave_sheet_sync'));

  SELECT * INTO v_run FROM public.leave_sheet_sync_runs WHERE id = p_run_id FOR UPDATE;
  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sync run not found');
  END IF;
  IF v_run.retire_status IS DISTINCT FROM 'blocked' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'This run has no blocked retirement');
  END IF;

  SELECT status INTO v_status FROM public.leave_sheet_sources WHERE source_key = v_run.source_key;
  IF v_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'The source is closed; its rows are frozen');
  END IF;

  -- Only the newest committed run speaks for the sheet as it is now.
  SELECT id INTO v_latest
    FROM public.leave_sheet_sync_runs
   WHERE source_key = v_run.source_key AND status = 'committed'
   ORDER BY started_at DESC
   LIMIT 1;
  IF v_latest IS DISTINCT FROM p_run_id THEN
    RETURN jsonb_build_object('ok', false,
      'message', 'A newer sync has run since; review that run instead');
  END IF;

  SELECT count(*) INTO v_staged FROM public.leave_sheet_sync_staging WHERE run_id = p_run_id;
  IF v_staged = 0 THEN
    RETURN jsonb_build_object('ok', false,
      'message', 'The staged feed for this run has been pruned; wait for the next sync');
  END IF;

  PERFORM set_config('leave.sheet_retire', 'on', true);
  PERFORM set_config('leave.delete_reason', 'missing_from_sheet_approved', true);
  PERFORM set_config('leave.delete_run_id', p_run_id::TEXT, true);

  DELETE FROM public.employee_leave_records r
   WHERE r.source = 'google_sheets'
     AND r.sheet_source = v_run.source_key
     AND NOT (COALESCE(r.metadata, '{}'::JSONB) ? 'leave_request_id')
     AND NOT (COALESCE(r.metadata, '{}'::JSONB) ? 'register_link_request_id')
     AND NOT EXISTS (
       SELECT 1 FROM public.leave_sheet_sync_staging s
        WHERE s.run_id            = p_run_id
          AND s.emp_id            = r.emp_id
          AND s.leave_category    = r.leave_category
          AND s.source_event_type = r.source_event_type
          AND s.leave_date        = r.leave_date
          AND s.duty_code         = r.duty_code);
  GET DIAGNOSTICS v_retired = ROW_COUNT;

  PERFORM set_config('leave.sheet_retire', 'off', true);
  PERFORM set_config('leave.delete_reason', '', true);
  PERFORM set_config('leave.delete_run_id', '', true);

  UPDATE public.leave_sheet_sync_runs
     SET retire_status = 'approved', retired = v_retired,
         approved_by = auth.uid(), approved_at = now()
   WHERE id = p_run_id;

  INSERT INTO public.leave_audit_log (action, actor_id, actor_name, actor_role, before, after, reason)
  VALUES (
    'approve_sheet_retirement', auth.uid(),
    (SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'admin',
    jsonb_build_object('run_id', p_run_id, 'blocked_reason', v_run.blocked_reason,
                       'candidates', v_run.retire_candidates),
    jsonb_build_object('retired', v_retired),
    p_reason);

  RETURN jsonb_build_object('ok', true, 'retired', v_retired);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 11. restore_archived_leave_record — undo a retirement or a deletion
-- ═══════════════════════════════════════════════════════════════════════════
-- The restored row is app-owned: an admin has decided the fact stands, so a
-- sheet that still lacks it must not retire it again.

CREATE OR REPLACE FUNCTION public.restore_archived_leave_record(
  p_archive_id UUID,
  p_reason     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_arc  public.employee_leave_records_archive;
  v_row  public.employee_leave_records;
BEGIN
  IF NOT public.can_manage_leave_sheet_sources() THEN
    RAISE EXCEPTION 'Only an admin may restore an archived leave record' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_arc FROM public.employee_leave_records_archive
   WHERE archive_id = p_archive_id FOR UPDATE;
  IF v_arc.archive_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Archive entry not found');
  END IF;
  IF v_arc.restored_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Already restored');
  END IF;

  v_row := jsonb_populate_record(NULL::public.employee_leave_records, v_arc.row_data);

  IF EXISTS (
    SELECT 1 FROM public.employee_leave_records r
     WHERE r.emp_id = v_row.emp_id
       AND r.leave_category = v_row.leave_category
       AND r.source_event_type = COALESCE(v_row.source_event_type, '')
       AND r.leave_date = v_row.leave_date
       AND r.duty_code = COALESCE(v_row.duty_code, '')) THEN
    RETURN jsonb_build_object('ok', false,
      'message', 'The register already holds a record for this employee, category and date');
  END IF;

  INSERT INTO public.employee_leave_records (
    id, emp_id, employee_name, sl_no, status, leave_category, source_event_type,
    event_kind, leave_date, leave_used_on, duty_code, raw_date_value,
    raw_shift_value, raw_leave_used_value, raw_event, metadata, source,
    sheet_source, sync_batch_id
  ) VALUES (
    v_row.id, v_row.emp_id, COALESCE(v_row.employee_name, ''), v_row.sl_no, v_row.status,
    v_row.leave_category, COALESCE(v_row.source_event_type, ''),
    COALESCE(v_row.event_kind, 'other'), v_row.leave_date, v_row.leave_used_on,
    COALESCE(v_row.duty_code, ''), v_row.raw_date_value, v_row.raw_shift_value,
    v_row.raw_leave_used_value, COALESCE(v_row.raw_event, '{}'::JSONB),
    (COALESCE(v_row.metadata, '{}'::JSONB) - 'sheet_missing_since')
      || jsonb_build_object('restored_from_archive', p_archive_id::TEXT),
    'webapp', v_row.sheet_source, v_row.sync_batch_id
  );

  UPDATE public.employee_leave_records_archive
     SET restored_at = now(), restored_by = auth.uid()
   WHERE archive_id = p_archive_id;

  INSERT INTO public.leave_audit_log (
    action, actor_id, actor_name, actor_role, employee_code, employee_name,
    leave_type, start_date, end_date, before, after, reason)
  VALUES (
    'restore_archived_record', auth.uid(),
    (SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'admin',
    v_row.emp_id, v_row.employee_name, v_row.leave_category, v_row.leave_date, v_row.leave_date,
    jsonb_build_object('archive_id', p_archive_id, 'reason', v_arc.reason),
    jsonb_build_object('record_id', v_row.id, 'source', 'webapp'),
    p_reason);

  RETURN jsonb_build_object('ok', true, 'record_id', v_row.id);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 12. SOURCE LIFECYCLE — close a workbook, open the next one
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.close_leave_sheet_source(
  p_source_key TEXT,
  p_reason     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source   public.leave_sheet_sources;
  v_final    UUID;
  v_rows     INTEGER;
  v_queued   INTEGER;
BEGIN
  IF NOT public.can_manage_leave_sheet_sources() THEN
    RAISE EXCEPTION 'Only an admin may close a leave sheet' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to close a leave sheet' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('leave_sheet_sync'));

  SELECT * INTO v_source FROM public.leave_sheet_sources WHERE source_key = p_source_key FOR UPDATE;
  IF v_source.source_key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown leave sheet source');
  END IF;
  IF v_source.status = 'closed' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Already closed');
  END IF;

  SELECT id INTO v_final
    FROM public.leave_sheet_sync_runs
   WHERE source_key = p_source_key AND status = 'committed'
   ORDER BY started_at DESC
   LIMIT 1;

  UPDATE public.leave_sheet_sources
     SET status = 'closed', closed_at = now(), closed_by = auth.uid(),
         close_reason = p_reason, final_run_id = v_final
   WHERE source_key = p_source_key;

  SELECT count(*) INTO v_rows
    FROM public.employee_leave_records WHERE sheet_source = p_source_key;

  -- Nothing can be sent to a closed sheet. The queue's history is in the audit row.
  SELECT count(*) INTO v_queued FROM public.leave_sheet_push_queue;
  DELETE FROM public.leave_sheet_push_queue;

  INSERT INTO public.leave_audit_log (action, actor_id, actor_name, actor_role, before, after, reason)
  VALUES (
    'close_sheet_source', auth.uid(),
    (SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'admin',
    jsonb_build_object('source', p_source_key, 'status', 'active'),
    jsonb_build_object('source', p_source_key, 'status', 'closed',
                       'frozen_rows', v_rows, 'final_run_id', v_final,
                       'push_queue_cleared', v_queued),
    p_reason);

  RETURN jsonb_build_object('ok', true, 'source', p_source_key, 'frozen_rows', v_rows,
                            'final_run_id', v_final, 'push_queue_cleared', v_queued);
END;
$$;

-- Registers a new workbook (or reopens a closed one) as the live source.
CREATE OR REPLACE FUNCTION public.activate_leave_sheet_source(
  p_source_key TEXT,
  p_label      TEXT,
  p_leave_year INTEGER,
  p_read_url   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active TEXT;
BEGIN
  IF NOT public.can_manage_leave_sheet_sources() THEN
    RAISE EXCEPTION 'Only an admin may activate a leave sheet' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_source_key), '') = '' OR p_leave_year IS NULL THEN
    RAISE EXCEPTION 'A source key and year are required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('leave_sheet_sync'));

  SELECT source_key INTO v_active FROM public.leave_sheet_sources WHERE status = 'active';
  IF v_active IS NOT NULL AND v_active <> btrim(p_source_key) THEN
    RETURN jsonb_build_object('ok', false,
      'message', format('Close the current sheet %s before activating another', v_active));
  END IF;

  INSERT INTO public.leave_sheet_sources (source_key, label, leave_year, read_url, status, activated_by)
  VALUES (btrim(p_source_key), COALESCE(NULLIF(btrim(p_label), ''), btrim(p_source_key)),
          p_leave_year, NULLIF(btrim(p_read_url), ''), 'active', auth.uid())
  ON CONFLICT (source_key) DO UPDATE SET
    label        = EXCLUDED.label,
    leave_year   = EXCLUDED.leave_year,
    read_url     = COALESCE(EXCLUDED.read_url, public.leave_sheet_sources.read_url),
    status       = 'active',
    activated_at = now(),
    activated_by = auth.uid(),
    closed_at    = NULL,
    closed_by    = NULL,
    close_reason = NULL;

  INSERT INTO public.leave_audit_log (action, actor_id, actor_name, actor_role, after)
  VALUES (
    'activate_sheet_source', auth.uid(),
    (SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'admin',
    jsonb_build_object('source', btrim(p_source_key), 'year', p_leave_year,
                       'read_url_set', NULLIF(btrim(p_read_url), '') IS NOT NULL));

  RETURN jsonb_build_object('ok', true, 'source', btrim(p_source_key));
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 13. GRANTS
-- ═══════════════════════════════════════════════════════════════════════════
-- Supabase's default privileges grant anon and authenticated EXECUTE on every
-- new function in public, so REVOKE ... FROM PUBLIC alone closes nothing: each
-- role is named. (scripts/db-tests/leave-ledger reproduces those defaults.)

REVOKE ALL ON FUNCTION public.leave_caller_is_trusted_backend() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_manage_leave_sheet_sources() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_caller_is_trusted_backend() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_leave_sheet_sources() TO authenticated, service_role;

-- The sync is the service role's alone.
REVOKE ALL ON FUNCTION public.commit_leave_sheet_sync(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_leave_sheet_staging(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_leave_sheet_sync(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_leave_sheet_staging(INTEGER) TO service_role;

-- Signed-in users may call these; each checks for an admin itself.
REVOKE ALL ON FUNCTION public.approve_leave_sheet_retirement(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restore_archived_leave_record(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_leave_sheet_source(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activate_leave_sheet_source(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_leave_sheet_retirement(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_archived_leave_record(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.close_leave_sheet_source(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.activate_leave_sheet_source(TEXT, TEXT, INTEGER, TEXT) TO authenticated, service_role;

-- Trigger functions are not meant to be called directly.
REVOKE ALL ON FUNCTION public.archive_deleted_leave_record() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_leave_sheet_push() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_app_authored_leave_records() FROM PUBLIC, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- 14. RETIRE THE LEGACY sync-leave-records JOB
-- ═══════════════════════════════════════════════════════════════════════════
-- It reads the same feed with a flat-row contract the feed does not speak, so it
-- fails every two hours; were it ever to succeed it would bypass staging. The
-- edge function itself now answers 410.

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('sync-leave-records');
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- not scheduled, or pg_cron unavailable
  END;

  IF to_regclass('public.sync_jobs') IS NOT NULL THEN
    UPDATE public.sync_jobs
       SET is_active = false, updated_at = now()
     WHERE job_name = 'sync-leave-records';
  END IF;
END $$;
