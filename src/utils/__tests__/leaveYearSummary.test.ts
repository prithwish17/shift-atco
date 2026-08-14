import { describe, expect, it } from "vitest";
import {
  bucketIsoDaysByMonth,
  expandIsoRange,
  extractIsoLeaveDays,
  formatLeaveDayLabels,
  formatLeaveRangeLabel,
  formatShortLeaveDay,
  getExpiringCompOffs,
  toIsoLeaveDay,
} from "@/utils/leaveYearSummary";
import type { CompOffHistoryEntry } from "@/utils/leaveCalculations";

function compOff(overrides: Partial<CompOffHistoryEntry>): CompOffHistoryEntry {
  return {
    dutyDate: null,
    leaveApplied: null,
    dutyPerformed: "",
    sourceType: "COMP_OFF_DUTY",
    expiryDate: null,
    daysRemaining: null,
    hideDates: false,
    eligible: true,
    earned: true,
    used: false,
    expired: false,
    remark: "",
    status: "available",
    ...overrides,
  };
}

describe("toIsoLeaveDay", () => {
  it("keeps an ISO day, dropping any time part", () => {
    expect(toIsoLeaveDay("2026-03-04")).toBe("2026-03-04");
    expect(toIsoLeaveDay("2026-03-04T00:00:00Z")).toBe("2026-03-04");
  });

  it("parses the register's other spelling", () => {
    expect(toIsoLeaveDay("JUL 15 2026")).toBe("2026-07-15");
  });

  it("returns null for anything it cannot read", () => {
    expect(toIsoLeaveDay("")).toBeNull();
    expect(toIsoLeaveDay("   ")).toBeNull();
    expect(toIsoLeaveDay(null)).toBeNull();
    expect(toIsoLeaveDay(42)).toBeNull();
    expect(toIsoLeaveDay("not a date")).toBeNull();
  });
});

describe("extractIsoLeaveDays", () => {
  it("reads a plain list of dates, as casualLeave holds", () => {
    expect(extractIsoLeaveDays(["2026-03-04", "2026-05-11"])).toEqual(["2026-03-04", "2026-05-11"]);
  });

  it("reads the named field off objects, as the comp-off ledger holds", () => {
    const items = [{ leaveApplied: "2026-08-02" }, { leaveApplied: "2026-08-09" }];
    expect(extractIsoLeaveDays(items, ["leaveApplied"])).toEqual(["2026-08-02", "2026-08-09"]);
  });

  it("skips placeholder rows flagged hideDates", () => {
    const items = [{ leaveApplied: "2026-08-02" }, { leaveApplied: "2026-08-09", hideDates: true }];
    expect(extractIsoLeaveDays(items, ["leaveApplied"])).toEqual(["2026-08-02"]);
  });

  it("de-duplicates", () => {
    expect(extractIsoLeaveDays(["2026-03-04", "2026-03-04"])).toEqual(["2026-03-04"]);
  });
});

describe("expandIsoRange", () => {
  it("expands an Earned Leave range to its days, inclusive of both ends", () => {
    expect(expandIsoRange("2026-06-01", "2026-06-04")).toEqual([
      "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04",
    ]);
  });

  it("handles a single-day leave", () => {
    expect(expandIsoRange("2026-06-01", "2026-06-01")).toEqual(["2026-06-01"]);
  });

  it("crosses a month boundary", () => {
    expect(expandIsoRange("2026-06-29", "2026-07-02")).toEqual([
      "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02",
    ]);
  });

  it("refuses an inverted or unreadable range instead of looping", () => {
    expect(expandIsoRange("2026-06-04", "2026-06-01")).toEqual([]);
    expect(expandIsoRange("nonsense", "2026-06-01")).toEqual([]);
    expect(expandIsoRange("2020-01-01", "2026-01-01")).toEqual([]);
  });
});

describe("bucketIsoDaysByMonth", () => {
  it("returns twelve months whatever the input", () => {
    expect(bucketIsoDaysByMonth([], 2026)).toHaveLength(12);
  });

  it("files each day under its month, January at index 0", () => {
    const months = bucketIsoDaysByMonth(["2026-01-15", "2026-03-04", "2026-03-21", "2026-12-25"], 2026);

    expect(months[0]).toEqual(["2026-01-15"]);
    expect(months[2]).toEqual(["2026-03-04", "2026-03-21"]);
    expect(months[11]).toEqual(["2026-12-25"]);
    expect(months[1]).toEqual([]);
  });

  it("sorts within a month, so the popover does not print March out of order", () => {
    const months = bucketIsoDaysByMonth(["2026-03-21", "2026-03-04"], 2026);
    expect(months[2]).toEqual(["2026-03-04", "2026-03-21"]);
  });

  it("drops days from other years", () => {
    const months = bucketIsoDaysByMonth(["2025-03-04", "2026-03-04", "2027-03-04"], 2026);
    expect(months[2]).toEqual(["2026-03-04"]);
  });
});

describe("getExpiringCompOffs", () => {
  it("keeps only available entries inside the window, soonest first", () => {
    const entries = [
      compOff({ dutyDate: "2026-06-01", expiryDate: "2026-09-20", daysRemaining: 25 }),
      compOff({ dutyDate: "2026-05-01", expiryDate: "2026-09-12", daysRemaining: 12 }),
      compOff({ dutyDate: "2026-07-01", expiryDate: "2026-11-01", daysRemaining: 60 }),
    ];

    const expiring = getExpiringCompOffs(entries, 30);

    expect(expiring.map((entry) => entry.daysRemaining)).toEqual([12, 25]);
  });

  it("ignores entries that are already used, expired or unavailable", () => {
    const entries = [
      compOff({ daysRemaining: 5, status: "used", used: true }),
      compOff({ daysRemaining: -3, status: "expired", expired: true }),
      compOff({ daysRemaining: 5, status: "not_available", earned: false }),
    ];

    expect(getExpiringCompOffs(entries, 30)).toEqual([]);
  });

  it("ignores entries with no expiry to measure against", () => {
    expect(getExpiringCompOffs([compOff({ daysRemaining: null })], 30)).toEqual([]);
  });
});

describe("formatShortLeaveDay", () => {
  it("formats for the expiry rail", () => {
    expect(formatShortLeaveDay("2026-09-12")).toBe("12 Sep");
  });

  it("returns null when there is nothing to format", () => {
    expect(formatShortLeaveDay(null)).toBeNull();
    expect(formatShortLeaveDay("nonsense")).toBeNull();
  });
});

describe("formatLeaveDayLabels", () => {
  it("prints the year's days in order, across months", () => {
    const months = bucketIsoDaysByMonth(["2026-08-19", "2026-03-04", "2026-05-12", "2026-05-11"], 2026);

    expect(formatLeaveDayLabels(months)).toEqual(["4 Mar", "11 May", "12 May", "19 Aug"]);
  });

  it("is empty when nothing was taken", () => {
    expect(formatLeaveDayLabels(bucketIsoDaysByMonth([], 2026))).toEqual([]);
  });
});

describe("formatLeaveRangeLabel", () => {
  it("collapses a range inside one month", () => {
    expect(formatLeaveRangeLabel("2026-06-15", "2026-06-19")).toBe("15–19 Jun");
  });

  it("spells both months when the range crosses one", () => {
    expect(formatLeaveRangeLabel("2026-06-29", "2026-07-02")).toBe("29 Jun – 2 Jul");
  });

  it("prints a single-day leave as one date", () => {
    expect(formatLeaveRangeLabel("2026-06-15", "2026-06-15")).toBe("15 Jun");
  });

  it("returns null when there is no readable range", () => {
    expect(formatLeaveRangeLabel(null, null)).toBeNull();
    expect(formatLeaveRangeLabel("nonsense", "2026-06-15")).toBeNull();
  });
});
