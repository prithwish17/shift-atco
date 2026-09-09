/**
 * The paging loops in schedule-reads.ts and roster-reads.ts have two failure
 * modes that are invisible in normal use and severe when they happen: a cursor
 * that fails to advance spins forever, and a non-total ordering silently drops
 * rows at page boundaries. Both replaced OFFSET paging that was timing out, so
 * the point of the change is lost if the replacement quietly loses data.
 *
 * These tests drive the real functions against an in-memory PostgREST double
 * that honours only what the pagers actually use: the range filter, the `.or()`
 * keyset predicate, the compound ordering and the page limit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [column: string]: string | number | null;
}

/** Rows the double serves, set per test. */
let tableRows: Record<string, Row[]> = {};
/** Every page request the pagers issued, so we can assert on page count. */
let requests: Array<{ table: string; limit: number | null }> = [];

/**
 * Minimal PostgREST query-builder double.
 *
 * Filters accumulate and are applied when the builder is awaited, which is what
 * lets the test exercise the cursor: the pager's `.or()` string is parsed the
 * same way PostgREST would read it.
 */
function createBuilder(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  const orderBy: string[] = [];
  let limit: number | null = null;

  const compare = (row: Row, column: string, op: string, value: string) => {
    const cell = String(row[column] ?? "");
    if (op === "gt") return cell > value;
    if (op === "eq") return cell === value;
    throw new Error(`unsupported op in double: ${op}`);
  };

  /** Parses `date.gt.X,and(date.eq.X,id.gt.Y)` — the keyset predicate shape. */
  const parseOr = (expression: string) => {
    const match = expression.match(
      /^(\w+)\.(\w+)\.(.*?),and\((\w+)\.(\w+)\.(.*?),(\w+)\.(\w+)\.(.*)\)$/,
    );
    if (!match) throw new Error(`double could not parse .or(): ${expression}`);
    const [, c1, o1, v1, c2, o2, v2, c3, o3, v3] = match;
    return (row: Row) =>
      compare(row, c1, o1, v1) || (compare(row, c2, o2, v2) && compare(row, c3, o3, v3));
  };

  const builder: Record<string, unknown> = {
    select: () => builder,
    gte: (column: string, value: string) => {
      filters.push((row) => String(row[column] ?? "") >= value);
      return builder;
    },
    lte: (column: string, value: string) => {
      filters.push((row) => String(row[column] ?? "") <= value);
      return builder;
    },
    in: (column: string, values: string[]) => {
      filters.push((row) => values.includes(String(row[column] ?? "")));
      return builder;
    },
    ilike: (column: string, value: string) => {
      filters.push(
        (row) => String(row[column] ?? "").toLowerCase() === value.toLowerCase(),
      );
      return builder;
    },
    or: (expression: string) => {
      filters.push(parseOr(expression));
      return builder;
    },
    order: (column: string) => {
      orderBy.push(column);
      return builder;
    },
    limit: (value: number) => {
      limit = value;
      return builder;
    },
    then: (resolve: (result: { data: Row[]; error: null }) => unknown) => {
      requests.push({ table, limit });
      const matched = (tableRows[table] ?? [])
        .filter((row) => filters.every((predicate) => predicate(row)))
        .sort((left, right) => {
          for (const column of orderBy) {
            const a = String(left[column] ?? "");
            const b = String(right[column] ?? "");
            if (a !== b) return a < b ? -1 : 1;
          }
          return 0;
        });
      return resolve({ data: limit === null ? matched : matched.slice(0, limit), error: null });
    },
  };

  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => createBuilder(table) },
}));

const { fetchScheduleRowsInRange } = await import("@/data-access/schedule-reads");
const { fetchRosterRowsInRange } = await import("@/data-access/roster-reads");

beforeEach(() => {
  tableRows = {};
  requests = [];
});

describe("fetchScheduleRowsInRange", () => {
  it("reads every row across page boundaries without gaps or repeats", async () => {
    // 250 rows over 5 dates, read 100 at a time: the cursor has to step within a
    // date as well as across dates, which is the case a `duty_date`-only cursor
    // would get wrong.
    tableRows.employee_schedules = Array.from({ length: 250 }, (_, i) => ({
      employee_code: `E${String(i % 50).padStart(3, "0")}`,
      employee_name: `Person ${i}`,
      duty_date: `2026-09-0${Math.floor(i / 50) + 1}`,
      duty_code: "M",
      duty_description: "Morning",
    }));

    const rows = await fetchScheduleRowsInRange({
      startDate: "2026-09-01",
      endDate: "2026-09-30",
      pageSize: 100,
    });

    expect(rows).toHaveLength(250);
    const seen = new Set(rows.map((r) => `${r.duty_date}|${r.employee_code}`));
    expect(seen.size).toBe(250);
  });

  it("stops after one page when the window is smaller than a page", async () => {
    tableRows.employee_schedules = [
      { employee_code: "E1", employee_name: "A", duty_date: "2026-09-02", duty_code: "M", duty_description: null },
    ];

    const rows = await fetchScheduleRowsInRange({ startDate: "2026-09-01", endDate: "2026-09-30" });

    expect(rows).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("applies the date window server-side", async () => {
    tableRows.employee_schedules = [
      { employee_code: "E1", employee_name: "A", duty_date: "2026-08-31", duty_code: "M", duty_description: null },
      { employee_code: "E2", employee_name: "B", duty_date: "2026-09-15", duty_code: "A", duty_description: null },
      { employee_code: "E3", employee_name: "C", duty_date: "2026-10-01", duty_code: "N", duty_description: null },
    ];

    const rows = await fetchScheduleRowsInRange({ startDate: "2026-09-01", endDate: "2026-09-30" });

    expect(rows.map((r) => r.employee_code)).toEqual(["E2"]);
  });

  it("does not hit the network for an empty window or an empty duty-code list", async () => {
    expect(await fetchScheduleRowsInRange({ startDate: "", endDate: "2026-09-30" })).toEqual([]);
    expect(
      await fetchScheduleRowsInRange({ startDate: "2026-09-01", endDate: "2026-09-30", dutyCodes: [] }),
    ).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});

describe("fetchRosterRowsInRange", () => {
  it("reads every row across page boundaries without gaps or repeats", async () => {
    tableRows.rosters = Array.from({ length: 120 }, (_, i) => ({
      id: `row-${String(i).padStart(4, "0")}`,
      date: `2026-09-${String((i % 30) + 1).padStart(2, "0")}`,
      shift: "Morning",
      team: "A",
      unit: "TWR",
      employee_name: `Person ${i}`,
      position: "",
      row_index: i,
    }));

    const rows = await fetchRosterRowsInRange({
      fromIsoDate: "2026-09-01",
      toIsoDate: "2026-09-30",
      pageSize: 25,
    });

    expect(rows).toHaveLength(120);
    expect(new Set(rows.map((r) => r.id)).size).toBe(120);
  });

  it("reads only the requested month", async () => {
    tableRows.rosters = [
      { id: "a", date: "2026-08-31", shift: "Morning", team: "A", unit: "TWR", employee_name: "Aug", position: "" },
      { id: "b", date: "2026-09-01", shift: "Morning", team: "A", unit: "TWR", employee_name: "Sep", position: "" },
      { id: "c", date: "2026-10-01", shift: "Morning", team: "A", unit: "TWR", employee_name: "Oct", position: "" },
      // The unrecoverable junk migration 20260802000000 left behind sorts
      // outside any real date range, so it must not appear.
      { id: "d", date: "23", shift: "Morning", team: "A", unit: "TWR", employee_name: "Junk", position: "" },
    ];

    const rows = await fetchRosterRowsInRange({ fromIsoDate: "2026-09-01", toIsoDate: "2026-09-30" });

    expect(rows.map((r) => r.employee_name)).toEqual(["Sep"]);
  });

  it("does not hit the network for an empty window", async () => {
    expect(await fetchRosterRowsInRange({ fromIsoDate: "", toIsoDate: "2026-09-30" })).toEqual([]);
    expect(requests).toHaveLength(0);
  });
});
