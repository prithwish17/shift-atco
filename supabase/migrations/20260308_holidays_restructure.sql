-- Holiday Schema Restructure
-- Rename columns to match production spec:
--   holiday_name → name
--   category (closed/reserved/national) → type (CH/RH/NH)
--   region → station
--   is_optional → selectable

-- 1. Rename columns
ALTER TABLE public.holidays RENAME COLUMN holiday_name TO name;
ALTER TABLE public.holidays RENAME COLUMN region TO station;
ALTER TABLE public.holidays RENAME COLUMN is_optional TO selectable;

-- 2. Add new 'type' column and migrate data from 'category'
ALTER TABLE public.holidays ADD COLUMN IF NOT EXISTS type TEXT;

UPDATE public.holidays SET type = CASE
  WHEN category = 'national' THEN 'NH'
  WHEN category = 'reserved' THEN 'RH'
  WHEN category = 'closed'   THEN 'CH'
  ELSE 'RH'
END;

ALTER TABLE public.holidays ALTER COLUMN type SET NOT NULL;
ALTER TABLE public.holidays ADD CONSTRAINT holidays_type_check CHECK (type IN ('NH', 'RH', 'CH'));

-- 3. Drop old category column
ALTER TABLE public.holidays DROP COLUMN IF EXISTS category;

-- 4. Ensure year is populated and NOT NULL
UPDATE public.holidays SET year = EXTRACT(YEAR FROM holiday_date) WHERE year IS NULL;
ALTER TABLE public.holidays ALTER COLUMN year SET NOT NULL;

-- 5. Set station default
ALTER TABLE public.holidays ALTER COLUMN station SET DEFAULT 'ALL';

-- 6. Add unique constraint if not exists (holiday_date + station)
-- Drop old unique constraint on holiday_date alone if it exists
ALTER TABLE public.holidays DROP CONSTRAINT IF EXISTS holidays_holiday_date_key;
ALTER TABLE public.holidays ADD CONSTRAINT holidays_holiday_date_station_key UNIQUE (holiday_date, station);

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_holidays_station ON public.holidays(station);
