-- ─────────────────────────────────────────────────────────────────────────────
-- Performance, Indexes & Constraints — Full Schema Audit
-- Scale target: 500–2000 employees
-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1 : Missing indexes
-- SECTION 2 : RLS correlated-subquery fixes
-- SECTION 3 : Data integrity constraints
-- SECTION 4 : Materialized view for roster aggregation
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 1 — MISSING INDEXES
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1a. attendance ──────────────────────────────────────────────────────────
-- Ensure unit_assignment column exists (may not have been migrated yet)
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS unit_assignment TEXT;

-- Supervisor dashboard queries: "all staff for date X in unit Y"
CREATE INDEX IF NOT EXISTS idx_attendance_date_unit
  ON public.attendance(attendance_date, unit_assignment);

-- ── 1b. leave_requests ──────────────────────────────────────────────────────
-- Employee "my leave history" ordered by date — very frequent
-- Query: WHERE employee_id = $1 ORDER BY applied_at DESC
-- Existing (employee_id, status) doesn't cover ORDER BY applied_at
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_applied
  ON public.leave_requests(employee_id, applied_at DESC);

-- "Leaves I approved as WSO / Supervisor" — admin reporting, less frequent
CREATE INDEX IF NOT EXISTS idx_leave_requests_wso_approved_by
  ON public.leave_requests(wso_approved_by)
  WHERE wso_approved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leave_requests_supervisor_approved_by
  ON public.leave_requests(supervisor_approved_by)
  WHERE supervisor_approved_by IS NOT NULL;

-- SAP export queries: WHERE sap_applied = false AND status = 'Approved'
CREATE INDEX IF NOT EXISTS idx_leave_requests_sap_status
  ON public.leave_requests(status, sap_applied)
  WHERE status = 'Approved' AND sap_applied IS DISTINCT FROM true;

-- ── 1c. notifications ───────────────────────────────────────────────────────
-- Inbox query: user's notifications newest-first (existing idx_notifications_user_unread
-- is partial on read=false — doesn't cover full history tab)
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);

-- ── 1d. holidays ────────────────────────────────────────────────────────────
-- Most common query: "gazetted holidays for station X in year Y"
-- Existing: separate (station), (year), (category), (holiday_date) — no composite
CREATE INDEX IF NOT EXISTS idx_holidays_station_year
  ON public.holidays(station, year);

-- Leave application: check if a date is a holiday for this station
CREATE INDEX IF NOT EXISTS idx_holidays_station_date
  ON public.holidays(station, holiday_date);

-- ── 1e. comp_off_ledger ─────────────────────────────────────────────────────
-- "Show me my available comp-offs" — THE most frequent comp-off query
-- Query: WHERE employee_id = $1 AND status = 'available'
-- Existing: separate (employee_id), (status), (expiry_date) — no composite
CREATE INDEX IF NOT EXISTS idx_comp_off_employee_status
  ON public.comp_off_ledger(employee_id, status);

-- Expiry scanner: all records expiring before date X that are still available
-- Existing (expiry_date) is single-column; adding status filter shrinks the scan
CREATE INDEX IF NOT EXISTS idx_comp_off_expiry_status
  ON public.comp_off_ledger(expiry_date, status)
  WHERE status = 'available';

-- ── 1f. duty_exchange_approvals ─────────────────────────────────────────────
-- "Find the current pending step for this request" — runs on every approval action
-- Query: WHERE request_id = $1 AND status = 'pending' ORDER BY sequence_order ASC LIMIT 1
-- Existing: separate (request_id), (status) — composite cuts from two index scans to one
CREATE INDEX IF NOT EXISTS idx_exchange_approvals_request_status
  ON public.duty_exchange_approvals(request_id, status, sequence_order);

-- "What approvals are pending for me" — approver inbox
CREATE INDEX IF NOT EXISTS idx_exchange_approvals_approver_status
  ON public.duty_exchange_approvals(approver_id, status)
  WHERE status = 'pending' AND approver_id IS NOT NULL;

-- ── 1g. duty_exchanges ──────────────────────────────────────────────────────
-- "My pending exchanges" per user — covers both requester and partner with status
-- Existing individual indexes exist but no composite with status
CREATE INDEX IF NOT EXISTS idx_duty_exchanges_requester_status
  ON public.duty_exchanges(requesting_user_id, status);

CREATE INDEX IF NOT EXISTS idx_duty_exchanges_partner_status
  ON public.duty_exchanges(exchange_partner_id, status);

-- ── 1h. employee_leave_records ──────────────────────────────────────────────
-- Calendar view: "all leave records for emp X in month Y"
-- Query: WHERE emp_id = $1 AND leave_date BETWEEN $2 AND $3
-- Existing (emp_id, leave_category) doesn't cover date range efficiently
CREATE INDEX IF NOT EXISTS idx_elr_emp_date
  ON public.employee_leave_records(emp_id, leave_date);

-- Admin analytics: "all comp-offs taken in date range across all employees"
CREATE INDEX IF NOT EXISTS idx_elr_category_date
  ON public.employee_leave_records(leave_category, leave_date);

-- ── 1i. employee_el_records ─────────────────────────────────────────────────
-- Date-range query: "EL records for emp X in this year"
-- Existing: only (emp_id) — no date component
CREATE INDEX IF NOT EXISTS idx_el_records_emp_date
  ON public.employee_el_records(emp_id, leave_from);

-- ── 1j. profiles ────────────────────────────────────────────────────────────
-- Roster views filter hidden employees every render
-- Query: WHERE is_hidden = false (scanned for every profile fetch by supervisors)
CREATE INDEX IF NOT EXISTS idx_profiles_is_hidden
  ON public.profiles(is_hidden)
  WHERE is_hidden = false;

-- Shift-based grouping for roster display
CREATE INDEX IF NOT EXISTS idx_profiles_shift
  ON public.profiles(current_shift);

-- ── 1k. api_call_logs ───────────────────────────────────────────────────────
-- Admin monitoring: "last N runs of job X"
-- Query: WHERE job_name = $1 ORDER BY created_at DESC LIMIT 10
-- Existing: (created_at DESC), (endpoint) — no job_name
CREATE INDEX IF NOT EXISTS idx_api_call_logs_job_created
  ON public.api_call_logs(job_name, created_at DESC)
  WHERE job_name IS NOT NULL;

-- Error monitoring: WHERE status = 'error' ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_api_call_logs_status_created
  ON public.api_call_logs(status, created_at DESC);

-- ── 1l. sync_jobs ───────────────────────────────────────────────────────────
-- Filter to active jobs only (tiny table, but used in every sync loop)
CREATE INDEX IF NOT EXISTS idx_sync_jobs_active
  ON public.sync_jobs(is_active)
  WHERE is_active = true;

-- ── 1m. employee_training_records ───────────────────────────────────────────
-- Sync functions look up by emp_id + sync batch
CREATE INDEX IF NOT EXISTS idx_training_emp_batch
  ON public.employee_training_records(emp_id, sync_batch_id)
  WHERE sync_batch_id IS NOT NULL;

-- ── 1n. notification_queue — additional ─────────────────────────────────────
-- Dead-letter admin view: WHERE status = 'dead_letter' ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_nq_dead_letter
  ON public.notification_queue(status, created_at DESC)
  WHERE status = 'dead_letter';

-- ── 1o. email_logs ──────────────────────────────────────────────────────────
-- Admin email log: ORDER BY created_at DESC with status filter
CREATE INDEX IF NOT EXISTS idx_email_logs_status_created
  ON public.email_logs(status, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — RLS CORRELATED SUBQUERY FIXES
-- ═══════════════════════════════════════════════════════════════════════════
-- PROBLEM: Several RLS policies use a correlated subquery per row:
--
--   USING (emp_id = (SELECT employee_id FROM profiles WHERE id = auth.uid()))
--
-- Postgres must re-evaluate this for EVERY ROW returned by the query.
-- On a table with 8,500+ records this is catastrophic — it becomes a
-- nested loop join instead of an index seek.
--
-- FIX: Replace with a SECURITY DEFINER function that Postgres evaluates ONCE
-- per query (cached as a stable result within the transaction).
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: get the current user's TEXT employee code (profiles.employee_id)
-- Called ONCE per query. Postgres caches the result for the query lifetime.
CREATE OR REPLACE FUNCTION public.current_user_emp_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT employee_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ── Fix: employee_leave_records ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Employees view own leave records" ON public.employee_leave_records;
CREATE POLICY "Employees view own leave records"
  ON public.employee_leave_records FOR SELECT
  USING (emp_id = public.current_user_emp_id());

-- ── Fix: employee_training_records ───────────────────────────────────────────
DROP POLICY IF EXISTS "Employees view own training records" ON public.employee_training_records;
CREATE POLICY "Employees view own training records"
  ON public.employee_training_records FOR SELECT TO authenticated
  USING (emp_id = public.current_user_emp_id());

-- ── Fix: employee_el_records ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Employees view own EL records" ON public.employee_el_records;
-- Only recreate if the policy existed (may differ by name)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'employee_el_records'
      AND policyname LIKE '%own%'
  ) THEN
    EXECUTE $q$
      CREATE POLICY "Employees view own EL records"
        ON public.employee_el_records FOR SELECT TO authenticated
        USING (emp_id = public.current_user_emp_id())
    $q$;
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 3 — DATA INTEGRITY CONSTRAINTS
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 3a. leave_requests ──────────────────────────────────────────────────────
-- Prevent logically impossible leave date ranges
ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_dates_check;
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_dates_check
  CHECK (end_date >= start_date);

-- Prevent zero or negative duration leaves
ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_total_days_positive;
ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_total_days_positive
  CHECK (total_days > 0);

-- actual_rh_date only makes sense for RH leave type
-- (soft guideline — not enforced as CHECK since existing data may vary)

-- ── 3b. comp_off_ledger ─────────────────────────────────────────────────────
-- Prevent zero-day comp-off grants
ALTER TABLE public.comp_off_ledger
  DROP CONSTRAINT IF EXISTS comp_off_days_positive;
ALTER TABLE public.comp_off_ledger
  ADD CONSTRAINT comp_off_days_positive
  CHECK (days_granted > 0);

-- Expiry must be after the duty date
ALTER TABLE public.comp_off_ledger
  DROP CONSTRAINT IF EXISTS comp_off_expiry_after_duty;
ALTER TABLE public.comp_off_ledger
  ADD CONSTRAINT comp_off_expiry_after_duty
  CHECK (expiry_date > duty_date);

-- ── 3c. duty_exchanges ──────────────────────────────────────────────────────
-- An employee cannot exchange a duty with themselves
ALTER TABLE public.duty_exchanges
  DROP CONSTRAINT IF EXISTS duty_exchanges_no_self_exchange;
ALTER TABLE public.duty_exchanges
  ADD CONSTRAINT duty_exchanges_no_self_exchange
  CHECK (requesting_user_id != exchange_partner_id);

-- ── 3d. employee_leave_records ───────────────────────────────────────────────
-- Enforce valid leave categories at the DB level (matches frontend constants)
ALTER TABLE public.employee_leave_records
  DROP CONSTRAINT IF EXISTS elr_leave_category_check;
ALTER TABLE public.employee_leave_records
  ADD CONSTRAINT elr_leave_category_check
  CHECK (leave_category IN (
    'CL', 'CL_1ST', 'CL_2ND', 'RH', 'NH', 'CH',
    'COMP_OFF', 'COMP_OFF_EARNED', 'COMP_OFF_USED',
    'LAST_YEAR_CH_DUTY', 'LAST_YEAR_COMP_OFF', 'OPE_COMP_OFF', 'OPE',
    'EL', 'ML', 'PTL', 'CCL', 'SPL', 'EXOL', 'LWP', 'DUTY_OFF'
  ));

-- ── 3e. leave_schedule_snapshots ─────────────────────────────────────────────
-- restored_at must be after created_at
ALTER TABLE public.leave_schedule_snapshots
  DROP CONSTRAINT IF EXISTS snapshot_restored_after_created;
ALTER TABLE public.leave_schedule_snapshots
  ADD CONSTRAINT snapshot_restored_after_created
  CHECK (restored_at IS NULL OR restored_at >= created_at);

-- ── 3f. notification_queue ───────────────────────────────────────────────────
-- max_attempts must be positive
ALTER TABLE public.notification_queue
  DROP CONSTRAINT IF EXISTS nq_max_attempts_positive;
ALTER TABLE public.notification_queue
  ADD CONSTRAINT nq_max_attempts_positive
  CHECK (max_attempts > 0);

-- attempts cannot exceed max_attempts
ALTER TABLE public.notification_queue
  DROP CONSTRAINT IF EXISTS nq_attempts_bounded;
ALTER TABLE public.notification_queue
  ADD CONSTRAINT nq_attempts_bounded
  CHECK (attempts <= max_attempts);


-- ═══════════════════════════════════════════════════════════════════════════
-- SECTION 4 — MATERIALIZED VIEW: monthly_roster_summary
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE:
--   Supervisor monthly roster dashboard currently joins employee_schedules
--   × profiles for every page load, scanning thousands of schedule rows.
--   A materialized view pre-joins these, refreshed after each roster sync.
--
-- REFRESH STRATEGY:
--   Call REFRESH MATERIALIZED VIEW CONCURRENTLY public.monthly_roster_summary
--   from the sync-roster edge function after a successful write batch.
--   CONCURRENTLY allows reads during refresh (no table lock).
--
-- COVERS:
--   - Supervisor duty grid (date + team + unit + employee)
--   - Monthly attendance overview
--   - Leave overlay on roster
-- ─────────────────────────────────────────────────────────────────────────────

-- Requires a unique index for CONCURRENTLY refresh
DROP MATERIALIZED VIEW IF EXISTS public.monthly_roster_summary;

CREATE MATERIALIZED VIEW public.monthly_roster_summary AS
SELECT
  es.employee_code,
  es.duty_date,
  es.duty_code,
  es.duty_description,
  p.full_name,
  p.employee_id       AS emp_id,
  p.current_shift,
  p.designation,
  p.id                AS user_id,
  -- Derive month key for efficient month-based filtering
  DATE_TRUNC('month', es.duty_date)::DATE AS roster_month
FROM public.employee_schedules es
JOIN public.profiles p
  ON p.employee_id = es.employee_code
WHERE p.is_hidden = false
WITH DATA;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_roster_code_date
  ON public.monthly_roster_summary(employee_code, duty_date);

-- Supporting indexes on the materialized view
CREATE INDEX IF NOT EXISTS idx_mv_roster_month
  ON public.monthly_roster_summary(roster_month);

CREATE INDEX IF NOT EXISTS idx_mv_roster_month_user
  ON public.monthly_roster_summary(roster_month, user_id);

CREATE INDEX IF NOT EXISTS idx_mv_roster_duty_code
  ON public.monthly_roster_summary(duty_date, duty_code);

-- RPC to refresh the view (callable from edge functions)
CREATE OR REPLACE FUNCTION public.refresh_roster_summary()
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.monthly_roster_summary;
$$;

-- Grant execute to service_role only (called from edge functions)
REVOKE ALL ON FUNCTION public.refresh_roster_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_roster_summary() TO service_role;
