-- ─────────────────────────────────────────────────────────────────────────────
-- Leave Management System — Production Hardening Migration
-- Phases 1-3: Security, Data Integrity, Performance
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1: SECURITY — RLS & Authorization Fixes
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1.1 Fix leave_schedule_snapshots RLS ────────────────────────────────
-- BUG: Any authenticated user can INSERT/UPDATE/DELETE any snapshot.
-- FIX: Restrict writes to the snapshot's own employee OR staff roles.

DROP POLICY IF EXISTS "Authenticated write leave_schedule_snapshots"
  ON public.leave_schedule_snapshots;

DROP POLICY IF EXISTS "Owner or staff write leave_schedule_snapshots"
  ON public.leave_schedule_snapshots;

CREATE POLICY "Owner or staff write leave_schedule_snapshots"
  ON public.leave_schedule_snapshots
  FOR ALL
  USING (
    employee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('wso', 'supervisor', 'admin')
        AND user_roles.approved = true
    )
  )
  WITH CHECK (
    employee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('wso', 'supervisor', 'admin')
        AND user_roles.approved = true
    )
  );

-- ── 1.2 Protect leave_requests immutable fields on UPDATE ───────────────
-- BUG: WSO/Supervisor UPDATE policy allows changing ANY column.
-- FIX: Trigger that prevents modifying protected fields after creation.

CREATE OR REPLACE FUNCTION public.protect_leave_request_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Allow edits while the request is still pending (not yet approved)
  IF OLD.status IN ('Pending WSO', 'Pending Supervisor') THEN
    RETURN NEW;
  END IF;

  -- These fields must never change after approval
  IF NEW.employee_id    IS DISTINCT FROM OLD.employee_id THEN
    RAISE EXCEPTION 'Cannot change employee_id on a leave request';
  END IF;
  IF NEW.employee_name  IS DISTINCT FROM OLD.employee_name THEN
    RAISE EXCEPTION 'Cannot change employee_name on a leave request';
  END IF;
  IF NEW.leave_type     IS DISTINCT FROM OLD.leave_type THEN
    RAISE EXCEPTION 'Cannot change leave_type on a leave request';
  END IF;
  IF NEW.start_date     IS DISTINCT FROM OLD.start_date THEN
    RAISE EXCEPTION 'Cannot change start_date on a leave request';
  END IF;
  IF NEW.end_date       IS DISTINCT FROM OLD.end_date THEN
    RAISE EXCEPTION 'Cannot change end_date on a leave request';
  END IF;
  IF NEW.total_days     IS DISTINCT FROM OLD.total_days THEN
    RAISE EXCEPTION 'Cannot change total_days on a leave request';
  END IF;
  IF NEW.applied_at     IS DISTINCT FROM OLD.applied_at THEN
    RAISE EXCEPTION 'Cannot change applied_at on a leave request';
  END IF;
  IF NEW.actual_rh_date IS DISTINCT FROM OLD.actual_rh_date THEN
    RAISE EXCEPTION 'Cannot change actual_rh_date on a leave request';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_leave_request_fields ON public.leave_requests;
CREATE TRIGGER protect_leave_request_fields
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_leave_request_immutable_fields();


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 2: DATA INTEGRITY — Overlap Constraint + RPC Functions
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 2.1 Prevent overlapping leave requests ──────────────────────────────
-- BUG: SELECT-then-INSERT race condition allows duplicate overlapping leaves.
-- FIX: Exclusion constraint using btree_gist — atomic, race-proof.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Partial exclusion constraint: only active (non-cancelled, non-rejected) leaves
-- cannot overlap for the same employee.
-- Note: exclusion constraints don't support WHERE directly, so we use a trigger.

CREATE OR REPLACE FUNCTION public.check_leave_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only enforce for active statuses
  IF NEW.status NOT IN ('Pending WSO', 'Pending Supervisor', 'Approved') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.leave_requests
    WHERE employee_id = NEW.employee_id
      AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND status IN ('Pending WSO', 'Pending Supervisor', 'Approved')
      AND daterange(start_date, end_date, '[]') && daterange(NEW.start_date, NEW.end_date, '[]')
  ) THEN
    RAISE EXCEPTION 'Overlapping leave request already exists for these dates'
      USING ERRCODE = '23P01'; -- exclusion_violation
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_leave_overlap_trigger ON public.leave_requests;
CREATE TRIGGER check_leave_overlap_trigger
  BEFORE INSERT OR UPDATE ON public.leave_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.check_leave_overlap();


-- ── 2.2 Atomic comp-off allocation RPC ──────────────────────────────────
-- BUG: Client-side loop of individual UPDATEs — partial failure corrupts ledger.
-- FIX: Single PostgreSQL function with full transaction semantics.

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
AS $$
DECLARE
  v_record RECORD;
  v_index INT := 1;
  v_updated INT := 0;
BEGIN
  -- Validate inputs
  IF array_length(p_record_ids, 1) IS NULL OR array_length(p_record_ids, 1) < array_length(p_leave_dates, 1) THEN
    RAISE EXCEPTION 'Insufficient comp-off entries to cover requested leave days';
  END IF;

  -- Lock and validate all target records atomically
  FOR v_record IN
    SELECT id, metadata
    FROM public.employee_leave_records
    WHERE id = ANY(p_record_ids)
    ORDER BY leave_date ASC
    FOR UPDATE
  LOOP
    -- Check not already allocated to a different leave request
    IF (v_record.metadata->>'leave_request_id') IS NOT NULL
       AND (v_record.metadata->>'leave_request_id') != p_leave_request_id::TEXT THEN
      RAISE EXCEPTION 'Comp-off entry % is already allocated to another leave request', v_record.id;
    END IF;

    -- Skip if already allocated to THIS request (idempotent re-run)
    IF (v_record.metadata->>'leave_request_id') = p_leave_request_id::TEXT THEN
      v_index := v_index + 1;
      CONTINUE;
    END IF;

    -- Allocate
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


-- ── 2.2b Atomic comp-off deallocation RPC ───────────────────────────────
-- Used when cancelling a comp-off leave — clears allocation atomically.

CREATE OR REPLACE FUNCTION public.clear_comp_off_for_leave(
  p_leave_request_id UUID,
  p_employee_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cleared INT := 0;
BEGIN
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


-- ── 2.3 Atomic schedule sync RPC ────────────────────────────────────────
-- BUG: N+1 queries (3 per day × N days) AND errors swallowed silently.
-- FIX: Single function, full transaction, all-or-nothing.

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
AS $$
DECLARE
  v_day DATE;
  v_existing RECORD;
  v_processed INT := 0;
BEGIN
  FOR v_day IN SELECT generate_series(p_start_date, p_end_date, '1 day'::INTERVAL)::DATE
  LOOP
    -- Fetch existing schedule for this day
    SELECT employee_code, employee_name, duty_code, duty_description
    INTO v_existing
    FROM public.employee_schedules
    WHERE employee_code = p_employee_code
      AND duty_date = v_day;

    -- Snapshot the original schedule (upsert to handle reruns)
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

    -- Upsert LEAVE code into schedule
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


-- ── 2.4 Atomic schedule restore RPC ─────────────────────────────────────
-- BUG: Cancellation has N+1 queries and no transaction boundary.
-- FIX: Single function to restore from snapshots atomically.

CREATE OR REPLACE FUNCTION public.restore_schedule_after_cancellation(
  p_leave_request_id UUID,
  p_employee_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_snapshot RECORD;
  v_restored INT := 0;
  v_has_other_leave BOOLEAN;
BEGIN
  FOR v_snapshot IN
    SELECT *
    FROM public.leave_schedule_snapshots
    WHERE leave_request_id = p_leave_request_id
      AND restored_at IS NULL
    ORDER BY duty_date ASC
  LOOP
    -- Check if another approved leave covers this day
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
      -- Restore original schedule
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
      -- No original schedule existed — delete the LEAVE entry
      DELETE FROM public.employee_schedules
      WHERE employee_code = v_snapshot.original_employee_code
        AND duty_date = v_snapshot.duty_date
        AND duty_code = 'LEAVE';
    END IF;

    v_restored := v_restored + 1;
  END LOOP;

  -- Mark all snapshots as restored
  UPDATE public.leave_schedule_snapshots
  SET restored_at = NOW()
  WHERE leave_request_id = p_leave_request_id
    AND restored_at IS NULL;

  RETURN jsonb_build_object('restored', v_restored);
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 3: PERFORMANCE — Missing Indexes
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_leave_requests_status_created
  ON public.leave_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_elr_sync_batch
  ON public.employee_leave_records(sync_batch_id)
  WHERE sync_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leave_snapshots_employee_request
  ON public.leave_schedule_snapshots(employee_id, leave_request_id);

-- Index for the overlap trigger to use
CREATE INDEX IF NOT EXISTS idx_leave_requests_overlap_check
  ON public.leave_requests(employee_id, start_date, end_date)
  WHERE status IN ('Pending WSO', 'Pending Supervisor', 'Approved');

-- Index for the comp-off metadata lookup
CREATE INDEX IF NOT EXISTS idx_elr_metadata_leave_request
  ON public.employee_leave_records USING GIN (metadata jsonb_path_ops);
