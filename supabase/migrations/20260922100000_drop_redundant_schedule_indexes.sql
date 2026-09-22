-- ─────────────────────────────────────────────────────────────────────────────
-- employee_schedules — drop three indexes that duplicate another one.
--
-- The table carries five scalar columns and nine indexes.  Three of them are
-- covered exactly by an index that stays, so they cost a write on every row the
-- nightly sync inserts or changes (and the archive/re-insert churn makes that a
-- lot of rows) and buy nothing on read:
--
--   dropped                              already served by
--   -----------------------------------  ----------------------------------------
--   idx_employee_schedules_code_date     employee_schedules_employee_code_duty_date_key
--     (employee_code, duty_date)           — the UNIQUE(employee_code, duty_date)
--     added by 20260301_add_missing_indexes  constraint's own index, same columns,
--                                            same order
--
--   idx_schedules_emp_date_range         the same UNIQUE index — this is a second
--     (employee_code, duty_date)           verbatim copy, added independently by
--     added by 20260429150000              20260429150000_performance_indexes
--
--   idx_employee_schedules_duty_date     idx_employee_schedules_date_code
--     (duty_date)                          (duty_date, employee_code) — duty_date is
--     added by 20260312                    its leading column, so Postgres serves
--                                          every duty_date predicate from it
--
-- Kept deliberately:
--   employee_schedules_pkey                       (id)
--   employee_schedules_employee_code_duty_date_key UNIQUE — the ON CONFLICT target
--   idx_employee_schedules_date_code              keyset paging in schedule-reads.ts
--   idx_schedules_date_code                       (duty_date, duty_code) partial
--   idx_employee_schedules_employee_name_trgm     SupervisorDashboard name search
--   idx_employee_schedules_employee_code_trgm     SupervisorDashboard code search
--
-- Same reasoning, and the same table, as the redundant-index section of
-- 20260622100000_storage_reclamation.sql; these three were missed there.
--
-- DROP INDEX needs a brief ACCESS EXCLUSIVE lock on the table.  lock_timeout
-- makes the migration fail fast rather than queue behind a long read and block
-- every schedule query behind it — re-running it is safe and does the rest.
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS public.idx_employee_schedules_code_date;
DROP INDEX IF EXISTS public.idx_schedules_emp_date_range;
DROP INDEX IF EXISTS public.idx_employee_schedules_duty_date;

ANALYZE public.employee_schedules;
