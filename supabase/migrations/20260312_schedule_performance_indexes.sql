-- ============================================================
-- Schedule Performance Indexes (Prompt 1/5)
-- ============================================================
-- Add missing single-column indexes on employee_schedules to
-- eliminate full table scans for the supervisor dashboard,
-- attendance, OPE assignments, and roster management queries.
--
-- Existing indexes:
--   • UNIQUE(employee_code, duty_date)      — from table DDL
--   • idx_employee_schedules_code_date       — composite (employee_code, duty_date)
--
-- These new indexes cover the remaining query patterns:
--   1. Single-date lookups:  WHERE duty_date = '2026-03-12'
--   2. Date-range scans:     WHERE duty_date BETWEEN '2026-03-01' AND '2026-03-31'
--   3. ORDER BY duty_date    (index-ordered scan, no filesort)
--   4. Employee-only lookup: WHERE employee_code = 'XYZ'
-- ============================================================

-- Index 1: duty_date
-- Speeds up the most common query pattern: fetch all employees
-- scheduled for a specific date (SupervisorDashboard,
-- SupervisorAttendance, OPEAssignments) and date-range queries
-- (DutyManagement, RosterManagement).
CREATE INDEX IF NOT EXISTS idx_employee_schedules_duty_date
  ON public.employee_schedules(duty_date);

-- Index 2: employee_code
-- Speeds up employee-specific lookups (useEmployeeSchedules hook)
-- and text search on employee_code (roster lookup).
-- The existing composite index (employee_code, duty_date) CAN
-- serve employee-only queries, but this single-column index is
-- smaller and faster when duty_date is not part of the filter.
CREATE INDEX IF NOT EXISTS idx_employee_schedules_employee_code
  ON public.employee_schedules(employee_code);

-- Index 3: Composite (employee_code, duty_date) — ALREADY EXISTS
-- The existing idx_employee_schedules_code_date from
-- 20260301_add_missing_indexes.sql covers this. No action needed.
