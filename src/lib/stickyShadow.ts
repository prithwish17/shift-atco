/**
 * The edge a pinned surface casts over whatever scrolls under it.
 *
 * Anything that stays put while content moves past — a table's fixed header,
 * a frozen first column, the nav rail, the app header — wears one of these, so
 * the pinned part reads as a layer above the page rather than as part of it.
 *
 * Each offset is paired with a negative spread of the same size, which pulls
 * the blur back off the perpendicular edges: a frozen column shadows only to
 * its right, a fixed header only downwards, and neither leaks a seam along the
 * rows beside it.  CORNER is the cell that is both at once.
 */
export const STICKY_COLUMN_SHADOW =
  "shadow-[8px_0_18px_-8px_rgba(15,23,42,0.30)] dark:shadow-[10px_0_22px_-8px_rgba(0,0,0,0.75)]";
export const STICKY_HEADER_SHADOW =
  "shadow-[0_8px_18px_-8px_rgba(15,23,42,0.30)] dark:shadow-[0_10px_22px_-8px_rgba(0,0,0,0.75)]";
export const STICKY_CORNER_SHADOW =
  "shadow-[8px_0_18px_-8px_rgba(15,23,42,0.30),0_8px_18px_-8px_rgba(15,23,42,0.30)] dark:shadow-[10px_0_22px_-8px_rgba(0,0,0,0.75),0_10px_22px_-8px_rgba(0,0,0,0.75)]";
