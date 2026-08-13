-- ====================================================
-- Roster grid row order
-- Created: 2026-08-13
-- Purpose: carry the sheet's own row position for every roster cell
-- ====================================================
--
-- The published duty roster is a matrix of unit rows crossed with rating
-- columns, and its unit ordering is not fixed: 15-Aug-2026 runs
-- UKW, UKE, UBS, URP, UKN, UGT, UBN while 10-Aug-2026 runs
-- UBN, UKE, UKW, URP, UKN, UBS, UGT.
--
-- Without the sheet's own row number the duty grid has to impose a canonical
-- order, which is stable across dates but does not always match the roster on
-- the wall.  The scraper now emits the row it read each cell from; this stores
-- it so the grid can reproduce the sheet exactly.

ALTER TABLE rosters ADD COLUMN IF NOT EXISTS row_index smallint;

COMMENT ON COLUMN rosters.row_index IS
  'Zero-based row of the cell within the scraped grid block (Apps Script GRID_RANGE). '
  'Lets the duty grid reproduce the sheet''s own unit ordering, which varies per roster. '
  'NULL for rows synced before this column existed, and for supervision and '
  'special-duty rows, which are read from flat ranges rather than the grid.';

-- The day view reads one date + shift and renders it in sheet order.
CREATE INDEX IF NOT EXISTS idx_rosters_date_shift_row
ON rosters(date, shift, row_index);

COMMENT ON INDEX idx_rosters_date_shift_row IS
  'Serves the day-view duty grid: one date and shift, read in sheet order.';

-- Deliberately NOT part of the natural key.  Identity stays
-- (date, shift, team, employee_name, unit, position) so that a roster reshuffled
-- in the sheet updates its rows in place instead of inserting duplicates
-- alongside the originals.
