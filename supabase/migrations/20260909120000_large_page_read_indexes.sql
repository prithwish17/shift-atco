-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes for the whole-range reads behind the large supervisor pages.
--
-- The Daily Availability Chart, Working Hours, Schedule Management and the Duty
-- Report all read a whole month (or wider) in one go.  They used to page with
-- OFFSET, which re-scans and discards every row before the page it wants, so a
-- deep page cost O(total) and crossed the 8s statement timeout Supabase gives
-- the `authenticated` role — Postgres raised 57014 and PostgREST returned 500,
-- which is why those pages failed to load more and more often as history grew.
--
-- The application side now walks a unique key instead (src/data-access/
-- schedule-reads.ts and roster-reads.ts).  These indexes are what make each of
-- those pages a constant-cost indexed range scan rather than a sort.
-- ─────────────────────────────────────────────────────────────────────────────

-- Keyset cursor for employee_schedules: ORDER BY (duty_date, employee_code)
-- with a `duty_date BETWEEN` filter.
--
-- The existing indexes do not serve this.  idx_employee_schedules_duty_date is
-- (duty_date) alone, so the second ordering column still needs a sort, and the
-- UNIQUE(employee_code, duty_date) / idx_employee_schedules_code_date pair
-- leads with employee_code, which a date-range scan cannot use.
CREATE INDEX IF NOT EXISTS idx_employee_schedules_date_code
  ON public.employee_schedules(duty_date, employee_code);

COMMENT ON INDEX idx_employee_schedules_date_code IS
  'Keyset pagination cursor for month-range schedule reads (Working Hours, Schedule Management, Duty Report, availability)';

-- Keyset cursor for rosters: a `date IN (...)` / range filter ordered by id.
--
-- idx_rosters_date_shift_team already serves the date filter; this covers the
-- ordering so a month read does not sort the matched rows.  The Daily
-- Availability Chart previously ordered by created_at, which has no index at
-- all and therefore sorted the entire table once per page.
CREATE INDEX IF NOT EXISTS idx_rosters_date_id
  ON public.rosters(date, id);

COMMENT ON INDEX idx_rosters_date_id IS
  'Keyset pagination cursor for month-range roster reads (Daily Availability Chart)';

ANALYZE public.employee_schedules;
ANALYZE public.rosters;
