/* eslint-disable @typescript-eslint/no-explicit-any --
 * `rosters` reaches the typed builder through casts in every existing caller;
 * filtering it through the generated types blows the instantiation depth limit.
 * The casts are confined to this module so callers see a typed API.
 */

/**
 * roster-reads.ts
 * ---------------------------------------------------------------------------
 * The single read path for range scans of `rosters`.
 *
 * The Daily Availability Chart used to read the *entire* table — six sequential
 * 5,000-row pages, `ORDER BY created_at DESC` — and then throw away everything
 * outside the month it was about to draw. Two things made that fail rather than
 * merely be slow:
 *
 *  - There is no index on `rosters.created_at`, so ordering by it sorts the
 *    whole table, and OFFSET paging repeats that sort for every page.
 *  - Supabase gives the `authenticated` role an 8s statement timeout. The table
 *    grows by roughly 13.5k rows a month (5 teams × 3 shifts × ~30 days × ~30
 *    people), so the read crossed that timeout and PostgREST returned 500
 *    (Postgres 57014) — more often the fuller the roster got.
 *
 * Reading one month, filtered server-side and paged by primary key, is bounded
 * work that stays bounded as history accumulates.
 */
import { supabase } from "@/integrations/supabase/client";
import type { RosterEntry } from "@/hooks/useRosters";

/**
 * The columns the roster matrix and duty grid actually render. `select("*")`
 * additionally pulls `created_at`, which nothing displays.
 */
export const ROSTER_VIEW_COLUMNS =
  "id, date, shift, team, unit, employee_name, position, row_index";

const DEFAULT_PAGE_SIZE = 1000;

export interface FetchRosterRangeOptions {
  /** Inclusive ISO start of the window. */
  fromIsoDate: string;
  /** Inclusive ISO end of the window. */
  toIsoDate: string;
  columns?: string;
  /** Optional `team IN (...)` narrowing (pass the alias list, not a bare team). */
  teamValues?: string[];
  /** Optional case-insensitive shift match. */
  shift?: string;
  pageSize?: number;
}

/**
 * Every roster row in [fromIsoDate, toIsoDate], read one indexed page at a time.
 *
 * `rosters.date` is a text column holding ISO "yyyy-MM-dd", so a plain range
 * filter is both correct and chronological: migration 20260802000000
 * normalised the legacy spellings, and both writers (the `fetch-roster` and
 * `sync-roster` edge functions) canonicalise through `toIsoRosterDate` and drop
 * anything they cannot parse. That also puts the unrecoverable junk values the
 * sheet once emitted (e.g. "23") outside any real date range.
 *
 * This deliberately does *not* use `getRosterDateRangeQueryValues`, the
 * spelling-by-spelling `.in()` filter the single-date readers use: at 31 days
 * that is 365 values and a ~7.5KB encoded query string, close enough to the
 * usual 8KB request-line limit to risk trading a timeout for a 414.
 *
 * Paging walks `id` (the primary key) rather than OFFSET, so page cost does not
 * grow with depth and the total ordering cannot skip or duplicate rows.
 */
export async function fetchRosterRowsInRange({
  fromIsoDate,
  toIsoDate,
  columns = ROSTER_VIEW_COLUMNS,
  teamValues,
  shift,
  pageSize = DEFAULT_PAGE_SIZE,
}: FetchRosterRangeOptions): Promise<RosterEntry[]> {
  if (!fromIsoDate || !toIsoDate) return [];
  if (teamValues && teamValues.length === 0) return [];

  const rows: RosterEntry[] = [];
  let cursorDate: string | null = null;
  let cursorId: string | null = null;

  for (;;) {
    let query = (supabase.from("rosters" as any) as any)
      .select(columns)
      .gte("date", fromIsoDate)
      .lte("date", toIsoDate)
      // Ordering on (date, id) matches idx_rosters_date_id, so each page is an
      // index-ordered scan with no sort step, and `id` makes the ordering total
      // — `date` alone is not unique, so paging on it could skip rows.
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .limit(pageSize);

    if (teamValues) query = query.in("team", teamValues);
    if (shift) query = query.ilike("shift", shift);

    // Advance past the last row of the previous page:
    // (date > cursorDate) OR (date = cursorDate AND id > cursorId)
    if (cursorDate !== null) {
      query = query.or(`date.gt.${cursorDate},and(date.eq.${cursorDate},id.gt.${cursorId})`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const page = (data || []) as unknown as RosterEntry[];
    rows.push(...page);

    if (page.length < pageSize) break;

    const last = page[page.length - 1];
    // Without a cursor the loop would re-read page one forever. Both columns
    // are in ROSTER_VIEW_COLUMNS; this only trips if a caller drops one.
    if (!last?.date || !last?.id) break;
    cursorDate = last.date;
    cursorId = last.id;
  }

  return rows;
}

/**
 * The month (as "yyyy-MM") of the most recently dated roster row, or null when
 * the table is empty.
 *
 * The Daily Availability Chart lands on the current month, but a roster for it
 * may not be published yet. Resolving the latest published month up front —
 * one indexed row — lets the chart open on real data instead of an empty grid,
 * and keeps the month arrows relative to a month that exists.
 */
export async function fetchLatestRosterMonth(): Promise<string | null> {
  // `date` is text, so the 64 unrecoverable junk values migration
  // 20260802000000 left behind (e.g. "23") would sort above every real ISO
  // date. The pattern keeps the scan to well-formed dates.
  const { data, error } = await (supabase.from("rosters" as any) as any)
    .select("date")
    .like("date", "____-__-__")
    .order("date", { ascending: false })
    .limit(1);

  if (error) throw error;

  const latest = (data?.[0]?.date as string | undefined) ?? "";
  return latest.length >= 7 ? latest.slice(0, 7) : null;
}
