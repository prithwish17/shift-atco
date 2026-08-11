import { describe, expect, it } from "vitest";
import { format, parse } from "date-fns";
import {
  MAX_ROSTER_DATE_RANGE_DAYS,
  getRosterDateQueryValues,
  getRosterDateRangeQueryValues,
  parseRosterDate,
} from "@/lib/rosterDate";

describe("getRosterDateRangeQueryValues", () => {
  it("covers every day in the window in every spelling the roster webapp emits", () => {
    const values = getRosterDateRangeQueryValues("2026-08-11", "2026-08-12");

    for (const day of ["2026-08-11", "2026-08-12"]) {
      for (const spelling of getRosterDateQueryValues(day)) {
        expect(values, `missing ${spelling}`).toContain(spelling);
      }
    }
  });

  it("de-duplicates spellings shared between adjacent days", () => {
    const values = getRosterDateRangeQueryValues("2026-08-11", "2026-08-12");
    expect(new Set(values).size).toBe(values.length);
  });

  it("crosses month and year boundaries", () => {
    const values = getRosterDateRangeQueryValues("2026-12-31", "2027-01-01");
    expect(values).toContain("2026-12-31");
    expect(values).toContain("2027-01-01");
  });

  it("bails out rather than build an unusable query string", () => {
    // Too wide to enumerate — callers fall back to a canonical ISO range.
    expect(getRosterDateRangeQueryValues("2026-01-01", "2026-12-31")).toEqual([]);
    // Exactly at the cap still enumerates; one day past it does not.
    const capEnd = format(
      new Date(2026, 7, MAX_ROSTER_DATE_RANGE_DAYS),
      "yyyy-MM-dd",
    );
    expect(getRosterDateRangeQueryValues("2026-08-01", capEnd).length).toBeGreaterThan(0);
    expect(getRosterDateRangeQueryValues("2026-08-01", "2026-09-01")).toEqual([]);
    // Missing or inverted bounds are not a range.
    expect(getRosterDateRangeQueryValues(undefined, "2026-08-12")).toEqual([]);
    expect(getRosterDateRangeQueryValues("2026-08-12", "2026-08-11")).toEqual([]);
    expect(getRosterDateRangeQueryValues("not-a-date", "2026-08-11")).toEqual([]);
  });
});

describe("lexical ordering of rosters.date", () => {
  it("ranks legacy spellings above canonical ones", () => {
    // Why useMyRoster filters by date instead of ordering + limiting: `date` is a
    // text column, so a descending sort puts "9-May-26" and "30-Jul-26" ahead of
    // every "2026-..." row and a small page never reaches today.
    const descending = ["2026-08-11", "2026-08-10", "30-Jul-26", "9-May-26"].sort().reverse();
    expect(descending.slice(0, 2)).toEqual(["9-May-26", "30-Jul-26"]);
  });
});

describe("parseRosterDate", () => {
  it("reads back the canonical and unambiguous legacy spellings", () => {
    const iso = "2026-08-11";
    const day = parse(iso, "yyyy-MM-dd", new Date());

    for (const spelling of ["yyyy-MM-dd", "d-MMM-yyyy", "dd-MMM-yyyy", "d-MMM-yy", "dd-MMMM-yy"]) {
      expect(format(parseRosterDate(format(day, spelling))!, "yyyy-MM-dd")).toBe(iso);
    }
  });

  it("returns null for values it cannot understand", () => {
    expect(parseRosterDate("")).toBeNull();
    expect(parseRosterDate(null)).toBeNull();
    expect(parseRosterDate("not a date")).toBeNull();
  });
});
