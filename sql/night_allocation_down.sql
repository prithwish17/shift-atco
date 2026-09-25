-- Down path for supabase/migrations/20260920120000_night_channel_allocation.sql
--
-- Run this to remove the Night Channel Allocation module. It drops the module's
-- own tables and the save function, and removes the feature toggle. Every
-- saved night is destroyed — take a dump of the five tables first if any of it
-- still matters.
--
-- `profiles.can_take_tso` is dropped last and separately: it is a person
-- attribute the office maintains by hand, so losing it costs real work. Comment
-- that statement out to keep the column while removing everything else.

-- The merge column goes with the tables it belongs to, so there is nothing
-- extra to undo for 20260920160000_night_allocation_merge.sql — and the same
-- is true of the DB-slot and availability columns added by
-- 20260925120000_night_allocation_db_slots_and_availability.sql.

DROP FUNCTION IF EXISTS public.night_allocation_save(
  DATE, INTEGER, SMALLINT, TEXT, JSONB, JSONB, JSONB, UUID, TEXT
);

DROP TABLE IF EXISTS public.night_allocation_audit;
DROP TABLE IF EXISTS public.night_allocation_duties;
DROP TABLE IF EXISTS public.night_allocation_channels;
DROP TABLE IF EXISTS public.night_allocation_people;
DROP TABLE IF EXISTS public.night_allocations;

DELETE FROM public.app_settings WHERE key = 'night_allocation.enabled';

ALTER TABLE public.profiles DROP COLUMN IF EXISTS can_take_tso;
