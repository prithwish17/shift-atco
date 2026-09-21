import { describe, expect, it } from "vitest";
import { isNightDate, nightDateAt } from "../time";

describe("which night a moment belongs to", () => {
  // Local-time constructors, so the test reads the same in any timezone.
  const at = (day: number, hour: number, minute: number) => new Date(2026, 8, day, hour, minute);

  it("is the same date's night from 13:30 until midnight", () => {
    expect(nightDateAt(at(20, 13, 30))).toBe("2026-09-20");
    expect(nightDateAt(at(20, 23, 59))).toBe("2026-09-20");
  });

  it("is still the previous date's night until 01:30", () => {
    expect(nightDateAt(at(21, 0, 0))).toBe("2026-09-20");
    expect(nightDateAt(at(21, 1, 29))).toBe("2026-09-20");
  });

  it("moves on to the coming night once the last one has ended", () => {
    expect(nightDateAt(at(21, 1, 30))).toBe("2026-09-21");
    expect(nightDateAt(at(21, 9, 0))).toBe("2026-09-21");
  });

  it("crosses a month and a year boundary", () => {
    expect(nightDateAt(new Date(2026, 9, 1, 0, 45))).toBe("2026-09-30");
    expect(nightDateAt(new Date(2027, 0, 1, 1, 0))).toBe("2026-12-31");
  });
});

describe("a night date", () => {
  it("accepts a real date", () => {
    expect(isNightDate("2026-09-20")).toBe(true);
    expect(isNightDate("2028-02-29")).toBe(true);
  });

  it("refuses a date that only looks right", () => {
    expect(isNightDate("2026-02-31")).toBe(false);
    expect(isNightDate("2026-02-29")).toBe(false);
    expect(isNightDate("2026-13-01")).toBe(false);
    expect(isNightDate("2026-00-10")).toBe(false);
    expect(isNightDate("20-09-2026")).toBe(false);
    expect(isNightDate("2026-09-20'; drop table")).toBe(false);
  });
});
