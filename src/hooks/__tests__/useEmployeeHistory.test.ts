/**
 * The one piece of `useEmployeeHistory.ts` that is pure enough to test without a
 * Supabase double: where the rotation-load window starts. OPE duties, night-breaks
 * and duty exchanges are all queried `gte(ytdStart)`, so this boundary is what makes
 * "This year: N extra duties" actually mean the calendar year, not a rolling window.
 */
import { describe, expect, it } from "vitest";

import { yearStart } from "@/hooks/useEmployeeHistory";

describe("yearStart", () => {
  it("is 1 January of the year containing the target date", () => {
    expect(yearStart("2026-08-13")).toBe("2026-01-01");
    expect(yearStart("2026-01-01")).toBe("2026-01-01");
    expect(yearStart("2026-12-31")).toBe("2026-01-01");
  });

  it("moves with the year, not with today's real date", () => {
    // A supervisor planning cover for next January still gets THAT year's start,
    // not the year the search happened to be run in.
    expect(yearStart("2027-01-15")).toBe("2027-01-01");
    expect(yearStart("2020-06-30")).toBe("2020-01-01");
  });
});
