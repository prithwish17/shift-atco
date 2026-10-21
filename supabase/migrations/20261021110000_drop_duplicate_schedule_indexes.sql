-- ─────────────────────────────────────────────────────────────────────────────
-- employee_schedules: drop three indexes that duplicate others.
--
-- Every row the schedule sync inserts or changes writes every index on the
-- table, and on the free-tier instance (0.5 GB RAM) each index also competes
-- with the data for cache. Three of the nine add nothing
-- (DISK_IO_MITIGATION_PLAN.md, Phase 2.3):
--
--   idx_employee_schedules_code_date  (employee_code, duty_date)
--   idx_schedules_emp_date_range      (employee_code, duty_date)
--       Both are the UNIQUE (employee_code, duty_date) constraint's index
--       again, column for column. Every query they could serve, it serves.
--
--   idx_employee_schedules_duty_date  (duty_date)
--       The leading column of idx_employee_schedules_date_code
--       (duty_date, employee_code), which serves every duty_date lookup and
--       range this one could.
--
-- Each drop is guarded on the index that replaces it, so nothing is dropped
-- that would leave a query without an index. idx_schedules_date_code and the
-- two trigram indexes are left for a decision on real idx_scan numbers.
--
-- DROP INDEX takes a brief exclusive lock on the table. lock_timeout makes the
-- migration fail fast instead of queueing every page read behind it; if it
-- fails, re-run it when the app is quiet.
-- ─────────────────────────────────────────────────────────────────────────────

SET lock_timeout = '5s';

DO $$
DECLARE
  v_table oid := 'public.employee_schedules'::regclass;
BEGIN
  -- A UNIQUE index on exactly (employee_code, duty_date), other than the two
  -- being dropped — the constraint sync_employee_schedules' ON CONFLICT uses.
  IF EXISTS (
    SELECT 1
    FROM   pg_index i
    JOIN   pg_class ic ON ic.oid = i.indexrelid
    WHERE  i.indrelid = v_table
      AND  i.indisunique
      AND  i.indpred IS NULL
      AND  ic.relname NOT IN ('idx_employee_schedules_code_date', 'idx_schedules_emp_date_range')
      -- indkey is an int2vector, subscripted from 0.
      AND  i.indnkeyatts = 2
      AND  i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = v_table AND attname = 'employee_code')
      AND  i.indkey[1] = (SELECT attnum FROM pg_attribute WHERE attrelid = v_table AND attname = 'duty_date')
  ) THEN
    DROP INDEX IF EXISTS public.idx_employee_schedules_code_date;
    DROP INDEX IF EXISTS public.idx_schedules_emp_date_range;
  ELSE
    RAISE WARNING 'No UNIQUE (employee_code, duty_date) index found: kept idx_employee_schedules_code_date and idx_schedules_emp_date_range';
  END IF;

  IF to_regclass('public.idx_employee_schedules_date_code') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.idx_employee_schedules_duty_date;
  ELSE
    RAISE WARNING 'idx_employee_schedules_date_code not found: kept idx_employee_schedules_duty_date';
  END IF;
END $$;

RESET lock_timeout;
