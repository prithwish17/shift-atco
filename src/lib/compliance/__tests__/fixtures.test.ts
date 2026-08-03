/**
 * Guards the fixtures themselves: if the production rotation changes, these fail
 * first and loudly, rather than every downstream scenario failing mysteriously.
 */
import { describe, expect, it } from "vitest";

import { ANCHOR, cohort, day, override, rotationOf, scheduleOf } from "./fixtures";

const codesOf = (rows: { duty_code: string | null }[]) => rows.map((r) => r.duty_code).join(" ");

describe("fixtures", () => {
  it("generates the real M→A→N→NO→CO cycle for team C from the anchor", () => {
    expect(codesOf(rotationOf({ id: "C1", team: "C" }, ANCHOR, 10))).toBe(
      "M A N NO CO M A N NO CO",
    );
  });

  it("offsets each team per TEAM_DUTY_BASE", () => {
    expect(codesOf(rotationOf({ id: "A1", team: "A" }, ANCHOR, 5))).toBe("N NO CO M A");
    expect(codesOf(rotationOf({ id: "B1", team: "B" }, ANCHOR, 5))).toBe("A N NO CO M");
    expect(codesOf(rotationOf({ id: "D1", team: "D" }, ANCHOR, 5))).toBe("CO M A N NO");
    expect(codesOf(rotationOf({ id: "E1", team: "E" }, ANCHOR, 5))).toBe("NO CO M A N");
  });

  it("places team C's night two days after the anchor", () => {
    // The scenario tests lean on this: C's N falls on ANCHOR+2, NO on +3, CO on +4.
    const rows = rotationOf({ id: "C1", team: "C" }, ANCHOR, 5);
    expect(rows.find((r) => r.duty_code === "N")?.duty_date).toBe(day(ANCHOR, 2));
    expect(rows.find((r) => r.duty_code === "NO")?.duty_date).toBe(day(ANCHOR, 3));
    expect(rows.find((r) => r.duty_code === "CO")?.duty_date).toBe(day(ANCHOR, 4));
  });

  it("honours explicit duty strings and skips gaps", () => {
    const rows = scheduleOf({ id: "X" }, ANCHOR, "M A - N");
    expect(codesOf(rows)).toBe("M A N");
    expect(rows.map((r) => r.duty_date)).toEqual([day(ANCHOR, 0), day(ANCHOR, 1), day(ANCHOR, 3)]);
  });

  it("builds cohorts of interchangeable controllers", () => {
    const rows = cohort({ count: 12, prefix: "RSR", team: "C", rating: "RSR" }, ANCHOR, 5);
    expect(new Set(rows.map((r) => r.employee_id)).size).toBe(12);
    expect(rows).toHaveLength(60);
  });

  it("overrides a single cell without touching neighbours", () => {
    const rows = override(rotationOf({ id: "C1", team: "C" }, ANCHOR, 5), "C1", day(ANCHOR, 2), "M");
    expect(codesOf(rows)).toBe("M A M NO CO");
  });
});
