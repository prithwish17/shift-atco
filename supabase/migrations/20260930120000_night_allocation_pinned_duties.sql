-- Night Channel Allocation — duties put on by hand
--
-- A duty added to the board by hand is kept when the night is generated: the
-- generator plans the rest of the night around it, as it does a DB slot,
-- instead of replacing it. It is otherwise an ordinary duty in every rule,
-- edit and export.
--
-- Stored as a duty row with kind = 'pinned'. The API validates it like any
-- other row before night_allocation_save is called; the function already
-- passes kind through, so it is unchanged. This only widens the constraint on
-- kind.
--
-- Run this before deploying the code that saves pinned duties: until then a
-- save with one in it is refused by the old constraint.
--
-- Down migration: sql/night_allocation_down.sql (the column goes with the table).

ALTER TABLE public.night_allocation_duties
  DROP CONSTRAINT IF EXISTS night_allocation_duties_kind_known;

ALTER TABLE public.night_allocation_duties
  ADD CONSTRAINT night_allocation_duties_kind_known CHECK (kind IN ('duty', 'pinned', 'db', 'blank'));

COMMENT ON COLUMN public.night_allocation_duties.kind IS
  '''duty'' for an ordinary duty; ''pinned'' for a duty put on by hand, which a generate keeps and plans around; ''db'' for a DB slot — training time fixed in advance, person_key being the instructor; ''blank'' for a stretch deliberately left with nobody on it, person_key empty.';
