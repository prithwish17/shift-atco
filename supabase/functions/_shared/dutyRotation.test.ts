import { addDays, format, parseISO } from "date-fns";
import { describe, expect, it } from "vitest";

import {
  DUTY_ROTATION_ANCHOR_DATE_IST as SRC_ANCHOR,
  getTeamDutyForDateKey,
} from "@/lib/teamDutyRotation";
import {
  DUTY_ROTATION_ANCHOR_DATE_IST,
  TEAM_DUTY_BASE,
  getTeamDutyForDate,
  shiftIsoDate,
  violatesRotation,
} from "./dutyRotation";

const TEAMS = Object.keys(TEAM_DUTY_BASE);

/**
 * The edge copy exists only because edge functions cannot import from src/.  If
 * it ever drifts from the frontend's rotation the sync starts deleting rows the
 * UI considers correct, so the two are pinned together here rather than trusted
 * to stay in step.
 */
describe("dutyRotation matches src/lib/teamDutyRotation", () => {
  it("uses the same anchor", () => {
    expect(DUTY_ROTATION_ANCHOR_DATE_IST).toBe(SRC_ANCHOR);
  });

  it("agrees on every team for two years around the anchor", () => {
    const start = addDays(parseISO(SRC_ANCHOR), -365);

    for (let i = 0; i < 730; i++) {
      const isoDate = format(addDays(start, i), "yyyy-MM-dd");
      for (const team of TEAMS) {
        expect(getTeamDutyForDate(team, isoDate)).toBe(getTeamDutyForDateKey(team, isoDate));
      }
    }
  });
});

describe("violatesRotation", () => {
  it("accepts the team the rotation actually puts on the shift", () => {
    // 2026-08-25: B is on Morning, A on Afternoon, E on Night.
    expect(violatesRotation("2026-08-25", "Morning", "B")).toBe(false);
    expect(violatesRotation("2026-08-25", "Afternoon", "A")).toBe(false);
    expect(violatesRotation("2026-08-25", "Night", "E")).toBe(false);
  });

  it("rejects a shift moved by one day — the mis-typed date cell", () => {
    // The whole point of the guard: B's Morning duty on the 25th, relabelled to
    // the 26th by a typo in the source tab's date cell, is impossible because
    // the rotation has B on Afternoon by then.
    expect(violatesRotation("2026-08-26", "Morning", "B")).toBe(true);
  });

  it("rejects a one-day slip on every team and every shift", () => {
    const anchor = parseISO(SRC_ANCHOR);

    for (let i = 0; i < 60; i++) {
      const isoDate = format(addDays(anchor, i), "yyyy-MM-dd");
      for (const team of TEAMS) {
        const duty = getTeamDutyForDate(team, isoDate);
        if (duty !== "M" && duty !== "A" && duty !== "N") continue;

        // Correct on the day it belongs to, impossible either side of it.
        expect(violatesRotation(isoDate, duty, team)).toBe(false);
        expect(violatesRotation(shiftIsoDate(isoDate, 1), duty, team)).toBe(true);
        expect(violatesRotation(shiftIsoDate(isoDate, -1), duty, team)).toBe(true);
      }
    }
  });

  it("abstains where there is no cycle to check against", () => {
    // General duty and unknown teams do not rotate; an unreadable shift label
    // has no code to compare.  Dropping those rows would lose good data.
    expect(violatesRotation("2026-08-26", "Morning", "G")).toBe(false);
    expect(violatesRotation("2026-08-26", "Morning", "")).toBe(false);
    expect(violatesRotation("2026-08-26", "Extra Duty", "B")).toBe(false);
    expect(violatesRotation("not-a-date", "Morning", "B")).toBe(false);
  });

  it("reads shift names and codes alike, and ignores casing", () => {
    expect(violatesRotation("2026-08-25", "MORNING", "B")).toBe(false);
    expect(violatesRotation("2026-08-25", "M", "B")).toBe(false);
    expect(violatesRotation("2026-08-25", " morning ", "B")).toBe(false);
  });
});
