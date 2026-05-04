-- Legacy no-op: EL numeric fields were removed when EL totals moved to app-side calculation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_el_records'
      AND column_name = 'days_availed'
  ) THEN
    ALTER TABLE public.employee_el_records
      ALTER COLUMN days_availed TYPE numeric(12,2);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'employee_el_summary'
      AND column_name = 'total_earned_leave_days'
  ) THEN
    ALTER TABLE public.employee_el_summary
      ALTER COLUMN total_earned_leave_days TYPE numeric(12,2);
  END IF;
END $$;
