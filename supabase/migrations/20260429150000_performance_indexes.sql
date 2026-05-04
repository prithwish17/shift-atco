-- ====================================================
-- Performance Optimization Indexes
-- Created: 2026-04-29
-- Purpose: Add composite indexes for Redis caching optimization
-- ====================================================

-- Composite index for leave roster queries (month range + status)
CREATE INDEX IF NOT EXISTS idx_leave_requests_status_dates
ON leave_requests(status, start_date, end_date);

COMMENT ON INDEX idx_leave_requests_status_dates IS 
  'Optimizes leave roster queries by month range and status filter';

-- Index for working hours cache lookups
CREATE INDEX IF NOT EXISTS idx_whc_month_computed
ON working_hours_cache(month, computed_at DESC);

COMMENT ON INDEX idx_whc_month_computed IS 
  'Cache lookup + freshness check for working hours';

-- Partial index for pending leave approvals (supervisor dashboard)
CREATE INDEX IF NOT EXISTS idx_leave_pending_wso
ON leave_requests(status, wso_approved_at)
WHERE status = 'Pending' AND wso_approved_at IS NULL;

COMMENT ON INDEX idx_leave_pending_wso IS 
  'Optimizes supervisor dashboard pending leaves query';

-- Composite for schedule + duty code filtering
CREATE INDEX IF NOT EXISTS idx_schedules_date_code
ON employee_schedules(duty_date, duty_code)
WHERE duty_code IS NOT NULL;

COMMENT ON INDEX idx_schedules_date_code IS 
  'Optimizes schedule queries with duty code filtering';

-- Roster table optimization (if not already indexed)
CREATE INDEX IF NOT EXISTS idx_rosters_team_shift_date
ON rosters(team, shift, date)
WHERE date IS NOT NULL;

COMMENT ON INDEX idx_rosters_team_shift_date IS 
  'Optimizes roster queries by team, shift, and date';

-- Additional composite index for leave date range queries
CREATE INDEX IF NOT EXISTS idx_leave_date_range
ON leave_requests(start_date, end_date, status)
WHERE status IN ('Approved', 'Pending');

COMMENT ON INDEX idx_leave_date_range IS 
  'Optimizes date range overlap queries for active leaves';

-- Index for schedule queries by employee and date range
CREATE INDEX IF NOT EXISTS idx_schedules_emp_date_range
ON employee_schedules(employee_code, duty_date);

COMMENT ON INDEX idx_schedules_emp_date_range IS 
  'Optimizes per-employee schedule lookups by date range';

-- Analyze tables to update planner statistics
ANALYZE leave_requests;
ANALYZE working_hours_cache;
ANALYZE employee_schedules;
ANALYZE rosters;
