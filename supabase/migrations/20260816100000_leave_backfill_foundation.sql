-- ─────────────────────────────────────────────────────────────────────────────
-- Leave Backfill Foundation
--
-- Supports supervisor-driven clearing of the ~1000-application leave backlog that
-- exists only as duty_code='LEAVE' in employee_schedules, with no leave type or
-- detail anywhere.  Everything here is additive: no existing column, constraint,
-- trigger or policy is weakened.
--
-- Sections:
--   0. Schema gaps that block the design (G1 category CHECK, G2 admin RLS)
--   1. Provenance columns on leave_requests
--   2. v_leave_approval_metrics excludes non-employee-originated rows (G9)
--   3. leave_audit_log        — append-only trail
--   4. leave_backfill_batches — groups a clearing session
--   5. App-wins precedence trigger on employee_leave_records
--   6. Role guard for the backfill/amend RPCs (G3)
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 0. SCHEMA GAPS
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0a. (G1) employee_leave_records rejects three live leave types ──────────
-- elr_leave_category_check (20260404200000) omits NEE, HPL and COMM, which are
-- three of the nine entries in LEAVE_TYPES (src/lib/leaveConstants.ts).  Any
-- backfill of those types would abort on a constraint violation.  Re-add the
-- constraint with the full list; every previously-allowed value is preserved.
ALTER TABLE public.employee_leave_records
  DROP CONSTRAINT IF EXISTS elr_leave_category_check;
ALTER TABLE public.employee_leave_records
  ADD CONSTRAINT elr_leave_category_check
  CHECK (leave_category IN (
    'CL', 'CL_1ST', 'CL_2ND', 'RH', 'NH', 'CH',
    'COMP_OFF', 'COMP_OFF_EARNED', 'COMP_OFF_USED',
    'LAST_YEAR_CH_DUTY', 'LAST_YEAR_COMP_OFF', 'OPE_COMP_OFF', 'OPE',
    'EL', 'ML', 'PTL', 'CCL', 'SPL', 'EXOL', 'LWP', 'DUTY_OFF',
    -- added: present in LEAVE_TYPES but previously unrepresentable here
    'NEE', 'HPL', 'COMM'
  ));

-- ── 0b. (G2) admin has no access to leave_requests ─────────────────────────
-- Both staff policies check role IN ('wso','supervisor').  Admins are granted
-- backfill rights, but without this an admin's backlog queue returns zero rows
-- *silently* rather than erroring.  WSO and supervisor access is unchanged.
DROP POLICY IF EXISTS "WSO/Supervisors view all leave requests" ON public.leave_requests;
CREATE POLICY "WSO/Supervisors view all leave requests"
  ON public.leave_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('wso', 'supervisor', 'admin')
        AND user_roles.approved = true
    )
  );

DROP POLICY IF EXISTS "WSO/Supervisors update leave requests" ON public.leave_requests;
CREATE POLICY "WSO/Supervisors update leave requests"
  ON public.leave_requests FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('wso', 'supervisor', 'admin')
        AND user_roles.approved = true
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PROVENANCE COLUMNS ON leave_requests
-- ═══════════════════════════════════════════════════════════════════════════
-- None of these appear in protect_leave_request_immutable_fields(), so they stay
-- mutable and the immutability trigger needs no change.

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS origin              TEXT NOT NULL DEFAULT 'employee',
  ADD COLUMN IF NOT EXISTS backfill_batch_id   UUID,
  ADD COLUMN IF NOT EXISTS supersedes_id       UUID REFERENCES public.leave_requests(id),
  ADD COLUMN IF NOT EXISTS superseded_by_id    UUID REFERENCES public.leave_requests(id),
  ADD COLUMN IF NOT EXISTS comp_off_record_ids JSONB;

ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_origin_check;
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_origin_check
  CHECK (origin IN ('employee', 'backfill', 'amendment'));

COMMENT ON COLUMN public.leave_requests.origin IS
  'How the row was created: employee (normal application), backfill (supervisor cleared a historical gap), amendment (correction superseding an earlier row).';
COMMENT ON COLUMN public.leave_requests.comp_off_record_ids IS
  'employee_leave_records ids explicitly selected to satisfy a COMP_OFF request. NULL means fall back to FIFO-by-expiry allocation.';

CREATE INDEX IF NOT EXISTS idx_leave_requests_origin
  ON public.leave_requests(origin) WHERE origin <> 'employee';
CREATE INDEX IF NOT EXISTS idx_leave_requests_backfill_batch
  ON public.leave_requests(backfill_batch_id) WHERE backfill_batch_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. (G9) KEEP BACKFILL OUT OF THE APPROVAL-LATENCY METRICS
-- ═══════════════════════════════════════════════════════════════════════════
-- v_leave_approval_metrics measures applied_at → approved_at.  Backfilled rows
-- carry a backdated applied_at and a now() approval stamp, which would inject
-- months-long fake latencies into avg_*_hours and p95_total_hours.  Column list
-- is unchanged, so CREATE OR REPLACE is valid.

CREATE OR REPLACE VIEW public.v_leave_approval_metrics AS
SELECT
  DATE_TRUNC('month', applied_at)::DATE          AS month,
  leave_type,
  COUNT(*)                                        AS total_requests,
  COUNT(*) FILTER (WHERE status = 'Approved')     AS approved,
  COUNT(*) FILTER (WHERE status = 'Rejected')     AS rejected,
  COUNT(*) FILTER (WHERE status = 'Cancelled')    AS cancelled,
  COUNT(*) FILTER (WHERE status IN ('Pending WSO', 'Pending Supervisor')) AS pending,
  ROUND(AVG(
    EXTRACT(EPOCH FROM (wso_approved_at - applied_at)) / 3600
  ) FILTER (WHERE wso_approved_at IS NOT NULL), 1) AS avg_wso_hours,
  ROUND(AVG(
    EXTRACT(EPOCH FROM (supervisor_approved_at - wso_approved_at)) / 3600
  ) FILTER (WHERE supervisor_approved_at IS NOT NULL), 1) AS avg_supervisor_hours,
  ROUND(AVG(
    EXTRACT(EPOCH FROM (supervisor_approved_at - applied_at)) / 3600
  ) FILTER (WHERE supervisor_approved_at IS NOT NULL), 1) AS avg_total_hours,
  ROUND((PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (supervisor_approved_at - applied_at)) / 3600
  ) FILTER (WHERE supervisor_approved_at IS NOT NULL))::NUMERIC, 1) AS p95_total_hours
FROM public.leave_requests
WHERE origin = 'employee'
GROUP BY 1, 2;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. leave_audit_log — append-only trail
-- ═══════════════════════════════════════════════════════════════════════════
-- Mirrors public.compliance_audit_log (20260616_compliance_audit.sql): SELECT and
-- INSERT policies only, deliberately no UPDATE/DELETE, so the trail cannot be
-- rewritten.  This is the durable record; logSupervisorEdit() posts to a Google
-- Sheet with mode:"no-cors" and cannot confirm delivery.

CREATE TABLE IF NOT EXISTS public.leave_audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action           text NOT NULL,   -- backfill_entry | amend_request | resolve_conflict
                                    --   | comp_off_override | recompute_balance
  actor_id         uuid,
  actor_name       text,
  actor_role       text,
  leave_request_id uuid,            -- intentionally not an FK: the trail outlives the row
  employee_code    text,
  employee_name    text,
  leave_type       text,
  start_date       date,
  end_date         date,
  before           jsonb,
  after            jsonb,
  reason           text,
  batch_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leave_audit_created_at ON public.leave_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leave_audit_action     ON public.leave_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_leave_audit_employee   ON public.leave_audit_log (employee_code);
CREATE INDEX IF NOT EXISTS idx_leave_audit_request    ON public.leave_audit_log (leave_request_id);
CREATE INDEX IF NOT EXISTS idx_leave_audit_batch      ON public.leave_audit_log (batch_id) WHERE batch_id IS NOT NULL;

ALTER TABLE public.leave_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_audit_select ON public.leave_audit_log;
CREATE POLICY leave_audit_select ON public.leave_audit_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('wso', 'supervisor', 'admin')
        AND user_roles.approved = true
    )
  );

DROP POLICY IF EXISTS leave_audit_insert ON public.leave_audit_log;
CREATE POLICY leave_audit_insert ON public.leave_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. leave_backfill_batches — groups one clearing session
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.leave_backfill_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by     uuid REFERENCES auth.users(id),
  created_by_name text,
  note           text,
  status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'closed', 'rolled_back')),
  entries_count  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_leave_backfill_batches_created
  ON public.leave_backfill_batches (created_at DESC);

ALTER TABLE public.leave_backfill_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leave_backfill_batches_staff ON public.leave_backfill_batches;
CREATE POLICY leave_backfill_batches_staff ON public.leave_backfill_batches
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role IN ('supervisor', 'admin')
        AND user_roles.approved = true
    )
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. APP-WINS PRECEDENCE ON employee_leave_records
-- ═══════════════════════════════════════════════════════════════════════════
-- The sheet sync upserts on (emp_id, leave_category, source_event_type,
-- leave_date, duty_code) — a key that does NOT include `source`.  So a sheet row
-- can overwrite an app-authored row and flip its source back to 'google_sheets',
-- after which fetch-leave-data's stale purge (which deletes
-- source='google_sheets' rows from older batches) owns and eventually deletes it.
-- That is the one real data-loss path in the transition.
--
-- This trigger keeps app-authored values and records what the sheet tried to
-- write into metadata.sheet_shadow, which doubles as the conflict feed for the
-- supervisor conflict console.
--
-- It cannot interfere with the app's own writes: allocate_comp_off_for_leave and
-- friends never set `source`, so NEW.source equals OLD.source ('webapp') and the
-- branch is not taken.  Sheet-owned rows (OLD.source='google_sheets') are also
-- untouched, so the sync keeps full control of its own rows.

CREATE OR REPLACE FUNCTION public.protect_app_authored_leave_records()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_incoming jsonb;
  v_current  jsonb;
BEGIN
  IF OLD.source IS DISTINCT FROM 'webapp' OR NEW.source IS DISTINCT FROM 'google_sheets' THEN
    RETURN NEW;
  END IF;

  -- What the sheet is trying to write ...
  v_incoming := jsonb_strip_nulls(jsonb_build_object(
    'employee_name',        NEW.employee_name,
    'status',               NEW.status,
    'leave_used_on',        NEW.leave_used_on,
    'raw_leave_used_value', NEW.raw_leave_used_value,
    'raw_date_value',       NEW.raw_date_value,
    'raw_shift_value',      NEW.raw_shift_value,
    'event_kind',           NEW.event_kind
  ));

  -- ... versus what the app currently holds.
  v_current := jsonb_strip_nulls(jsonb_build_object(
    'employee_name',        OLD.employee_name,
    'status',               OLD.status,
    'leave_used_on',        OLD.leave_used_on,
    'raw_leave_used_value', OLD.raw_leave_used_value,
    'raw_date_value',       OLD.raw_date_value,
    'raw_shift_value',      OLD.raw_shift_value,
    'event_kind',           OLD.event_kind
  ));

  -- Discard the sheet's version wholesale, keeping the app row intact.
  NEW := OLD;

  IF v_incoming = v_current THEN
    -- Sheet has caught up; drop any stale conflict marker.
    NEW.metadata := COALESCE(OLD.metadata, '{}'::jsonb) - 'sheet_shadow' - 'sheet_seen_at';
  ELSE
    NEW.metadata := COALESCE(OLD.metadata, '{}'::jsonb)
      || jsonb_build_object('sheet_shadow', v_incoming, 'sheet_seen_at', to_jsonb(now()));
  END IF;

  RETURN NEW;
END;
$$;

-- Fires before update_employee_leave_records_updated_at (triggers run in name
-- order, and 'p' < 'u'), so updated_at still reflects the last sheet contact.
DROP TRIGGER IF EXISTS protect_app_authored_leave_records ON public.employee_leave_records;
CREATE TRIGGER protect_app_authored_leave_records
  BEFORE UPDATE ON public.employee_leave_records
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_app_authored_leave_records();

-- The existing GIN index uses jsonb_path_ops, which supports @> but not the ?
-- operator, so it cannot serve a "has a conflict" lookup.  This partial index can.
CREATE INDEX IF NOT EXISTS idx_elr_sheet_shadow
  ON public.employee_leave_records (emp_id, leave_date)
  WHERE metadata ? 'sheet_shadow';


-- ═══════════════════════════════════════════════════════════════════════════
-- 6. (G3) ROLE GUARD FOR BACKFILL / AMENDMENT
-- ═══════════════════════════════════════════════════════════════════════════
-- is_staff() resolves to wso+supervisor+admin and would hand WSO powers it is not
-- meant to have.  This guard is supervisor+admin only.
--
-- It reads public.user_roles directly rather than current_user_roles(), which
-- COALESCEs a JWT-derived array against a DB fallback — but an absent 'roles'
-- claim yields an EMPTY array, not NULL, so the COALESCE never falls through and
-- the function returns {} whenever the access-token hook is not active.  The
-- direct lookup is what the existing leave_requests policies already use.

CREATE OR REPLACE FUNCTION public.can_manage_leave_backfill()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role IN ('supervisor', 'admin')
      AND approved = true
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_leave_backfill() TO authenticated;
