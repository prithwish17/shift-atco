import { addDays, format, parse } from "date-fns";

// The roster webapp emits several date shapes depending on which team/shift tab a
// row came from: "2-Aug-2026", "2-August-26" and "9-May-26" (Bravo night) and
// "07-30-2026" (Echo afternoon/night).  All of them have to parse, otherwise those
// rows are invisible to both the `.in("date", ...)` query and the client filter.
//
// Order matters.  date-fns' `yyyy` token happily matches a 2-digit year, so
// "24-May-26" would parse as year 0026 if "d-MMM-yyyy" were tried first.  The
// two-digit-year patterns are therefore listed ahead of the four-digit ones;
// a 4-digit year leaves an unconsumed "26" under `yy` and correctly fails.
export const ROSTER_DATE_FORMATS = [
  "dd-MMMM-yy",
  "d-MMMM-yy",
  "dd-MMM-yy",
  "d-MMM-yy",
  "dd-MMMM-yyyy",
  "d-MMMM-yyyy",
  "dd-MMM-yyyy",
  "d-MMM-yyyy",
  "yyyy-MM-dd",
  "MM-dd-yyyy",
  "dd/MM/yyyy",
  "d/M/yyyy",
  "dd-MM-yyyy",
  "M/d/yyyy",
  "MM/dd/yyyy",
] as const;

export function parseRosterDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  for (const formatString of ROSTER_DATE_FORMATS) {
    const parsed = parse(raw, formatString, new Date());
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

/**
 * Canonical storage form for `rosters.date`.  Returns "yyyy-MM-dd", or null when
 * the value cannot be understood — callers should skip such rows rather than
 * persist a string nothing can query.
 */
export function toIsoRosterDate(value?: string | null) {
  const parsed = parseRosterDate(value);
  return parsed ? format(parsed, "yyyy-MM-dd") : null;
}

export function getRosterDateQueryValues(targetIsoDate?: string) {
  if (!targetIsoDate) return [];
  const parsed = parse(targetIsoDate, "yyyy-MM-dd", new Date());
  if (Number.isNaN(parsed.getTime())) return [targetIsoDate];

  // Storage is canonical "yyyy-MM-dd", but legacy rows may still carry any of the
  // formats above, so keep querying the variants too.
  return [...new Set([
    format(parsed, "yyyy-MM-dd"),
    format(parsed, "d-MMM-yyyy"),
    format(parsed, "dd-MMM-yyyy"),
    format(parsed, "d-MMMM-yy"),
    format(parsed, "dd-MMMM-yy"),
    format(parsed, "d-MMM-yy"),
    format(parsed, "dd-MMM-yy"),
    format(parsed, "d-MMMM-yyyy"),
    format(parsed, "MM-dd-yyyy"),
    format(parsed, "dd/MM/yyyy"),
    format(parsed, "d/M/yyyy"),
    format(parsed, "dd-MM-yyyy"),
    format(parsed, "M/d/yyyy"),
    format(parsed, "MM/dd/yyyy"),
  ])];
}

/**
 * Widest range that is still worth expanding into an `.in("date", ...)` filter.
 * Each day contributes ~14 spellings, so 31 days is already ~430 values in the
 * query string — past that the URL gets unreasonable and callers should filter
 * on the canonical ISO range instead.
 */
export const MAX_ROSTER_DATE_RANGE_DAYS = 31;

/**
 * Every stored spelling of every day in [fromIsoDate, toIsoDate], for building
 * an `.in("date", ...)` filter that matches legacy rows as well as canonical
 * ones.  Returns [] when the range is unparseable, inverted, or wider than
 * MAX_ROSTER_DATE_RANGE_DAYS — the caller must fall back to an ISO range filter.
 */
export function getRosterDateRangeQueryValues(fromIsoDate?: string, toIsoDate?: string) {
  if (!fromIsoDate || !toIsoDate) return [];

  const start = parse(fromIsoDate, "yyyy-MM-dd", new Date());
  const end = parse(toIsoDate, "yyyy-MM-dd", new Date());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const values = new Set<string>();
  for (let cursor = start, days = 0; cursor <= end; cursor = addDays(cursor, 1), days++) {
    if (days >= MAX_ROSTER_DATE_RANGE_DAYS) return [];
    getRosterDateQueryValues(format(cursor, "yyyy-MM-dd")).forEach((value) => values.add(value));
  }

  return [...values];
}
