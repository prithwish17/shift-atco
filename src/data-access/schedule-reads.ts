/* eslint-disable @typescript-eslint/no-explicit-any --
 * `employee_schedules` is missing from the generated Supabase types
 * (src/integrations/supabase/types.ts is out of date and omits several live
 * tables). The casts are confined to this module so every caller sees a typed
 * API; regenerating the types is the real fix and would let these all go.
 */

/**
 * schedule-reads.ts
 * ---------------------------------------------------------------------------
 * The single read path for whole-range `employee_schedules` scans — the reads
 * behind Schedule Management, Working Hours, the Duty Report and the Daily
 * Availability Chart.
 *
 * Every one of these pages used to page with OFFSET (`.range(n, n + size)`),
 * which re-scans and discards the first n rows on each page, so the last page
 * of a large read costs O(total). Supabase gives the `authenticated` role an 8s
 * statement timeout, and once a range is big enough that a deep page crosses
 * it, Postgres raises 57014 and PostgREST returns 500 — the page then simply
 * fails to load, and does so more often the more schedule history accumulates.
 * `DutyManagement` additionally asked for an exact `count`, which is a full
 * scan of its own before a single row is read.
 *
 * Keyset paging walks the unique key `(duty_date, employee_code)` instead: each
 * page is a constant-cost indexed range scan, and the ordering is total, so
 * pages cannot skip or duplicate rows the way an `ORDER BY duty_date` OFFSET
 * scan can.
 */
import { supabase } from "@/integrations/supabase/client";

/** Columns every range consumer needs. Callers wanting fewer pass `columns`. */
export const SCHEDULE_RANGE_COLUMNS =
  "employee_code, employee_name, duty_date, duty_code, duty_description";

/** A page bigger than this is more likely to time out than to save a round trip. */
const DEFAULT_PAGE_SIZE = 1000;

export interface ScheduleRangeRow {
  employee_code: string | null;
  employee_name: string | null;
  duty_date: string | null;
  duty_code: string | null;
  duty_description: string | null;
}

export interface FetchScheduleRangeOptions {
  /** Inclusive ISO start of the window. */
  startDate: string;
  /** Inclusive ISO end of the window. */
  endDate: string;
  /**
   * Columns to select. Must include `duty_date` and `employee_code` — they are
   * the cursor, so the pager cannot advance without them.
   */
  columns?: string;
  /** Optional `duty_code IN (...)` narrowing, applied server-side. */
  dutyCodes?: string[];
  pageSize?: number;
}

/**
 * Every `employee_schedules` row in [startDate, endDate], read one indexed page
 * at a time. Returns [] for an empty or unset window rather than scanning the
 * whole table, which is what an unguarded caller would otherwise do.
 */
export async function fetchScheduleRowsInRange<Row = ScheduleRangeRow>({
  startDate,
  endDate,
  columns = SCHEDULE_RANGE_COLUMNS,
  dutyCodes,
  pageSize = DEFAULT_PAGE_SIZE,
}: FetchScheduleRangeOptions): Promise<Row[]> {
  if (!startDate || !endDate) return [];
  // An empty `duty_code IN ()` matches nothing; asking PostgREST is a wasted
  // round trip, and some builders render it as no filter at all.
  if (dutyCodes && dutyCodes.length === 0) return [];

  const rows: Row[] = [];
  let cursorDate: string | null = null;
  let cursorCode: string | null = null;

  for (;;) {
    let query = (supabase.from("employee_schedules" as any) as any)
      .select(columns)
      .gte("duty_date", startDate)
      .lte("duty_date", endDate)
      .order("duty_date", { ascending: true })
      .order("employee_code", { ascending: true })
      .limit(pageSize);

    if (dutyCodes) query = query.in("duty_code", dutyCodes);

    // Advance past the last row of the previous page:
    // (duty_date > cursorDate) OR (duty_date = cursorDate AND employee_code > cursorCode)
    if (cursorDate !== null) {
      query = query.or(
        `duty_date.gt.${cursorDate},and(duty_date.eq.${cursorDate},employee_code.gt.${cursorCode})`,
      );
    }

    const { data, error } = await query;
    if (error) throw error;

    const page = (data || []) as unknown as Row[];
    rows.push(...page);

    if (page.length < pageSize) break;

    const last = page[page.length - 1] as unknown as ScheduleRangeRow;
    // Without a cursor the loop would re-read page one forever. The columns are
    // documented as required above; bail rather than hang if one is missing.
    if (!last?.duty_date) break;
    cursorDate = last.duty_date;
    cursorCode = last.employee_code ?? "";
  }

  return rows;
}
