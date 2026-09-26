-- Night Channel Allocation — blanks
--
-- A blank is a stretch of a position left with nobody on it, on purpose: the
-- person is taken off a duty (or part of one) and the stretch stays on the
-- board, empty, instead of being handed to a neighbour. It saves and shares
-- as BLANK, and the checks list it under suggestions until someone fills it.
--
-- Stored as a duty row with kind = 'blank' and an empty person_key. The API
-- validates it like any other row before night_allocation_save is called;
-- the function already passes kind through, so it is unchanged. This only
-- widens the constraint on kind.
--
-- Run this before deploying the code that saves blanks: until then a save
-- with a blank in it is refused by the old constraint.
--
-- Down migration: sql/night_allocation_down.sql (the column goes with the table).

ALTER TABLE public.night_allocation_duties
  DROP CONSTRAINT IF EXISTS night_allocation_duties_kind_known;

ALTER TABLE public.night_allocation_duties
  ADD CONSTRAINT night_allocation_duties_kind_known CHECK (kind IN ('duty', 'db', 'blank'));

COMMENT ON COLUMN public.night_allocation_duties.kind IS
  '''duty'' for an ordinary duty; ''db'' for a DB slot — training time fixed in advance, person_key being the instructor; ''blank'' for a stretch deliberately left with nobody on it, person_key empty.';
