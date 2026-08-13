import { addDays, format, parseISO } from "date-fns";
import { describe, expect, it } from "vitest";

import { DUTY_ROTATION_ANCHOR_DATE_IST, getTeamDutyForDateKey } from "@/lib/teamDutyRotation";
import {
  buildShiftRosterFromRosters,
  buildShiftRosterFromSchedules,
  filterShiftRosterDay,
  getCurrentShiftCode,
  getOffDutyTeamsForDate,
  getShiftTeamsForDate,
  getTeamForDateAndShift,
} from "@/lib/shiftRoster";
import type { RosterEntry } from "@/hooks/useRosters";

const ANCHOR = DUTY_ROTATION_ANCHOR_DATE_IST; // 2026-03-09

function rosterRow(overrides: Partial<RosterEntry>): RosterEntry {
  return {
    date: ANCHOR,
    shift: "Morning",
    team: "C",
    unit: "UBN",
    employee_name: "Test Person",
    position: "ATCO",
    ...overrides,
  };
}

describe("getShiftTeamsForDate", () => {
  it("assigns exactly one team to each shift, matching the rotation", () => {
    const teams = getShiftTeamsForDate(ANCHOR);

    // On the anchor date the base assignment applies: C=M, B=A, A=N.
    expect(teams.M).toEqual(["C"]);
    expect(teams.A).toEqual(["B"]);
    expect(teams.N).toEqual(["A"]);
  });

  it("stays consistent with getTeamDutyForDateKey on an arbitrary later date", () => {
    const date = "2026-08-12";
    const teams = getShiftTeamsForDate(date);

    (["M", "A", "N"] as const).forEach((shiftCode) => {
      teams[shiftCode].forEach((team) => {
        expect(getTeamDutyForDateKey(team, date)).toBe(shiftCode);
      });
    });

    // All five teams are accounted for across duty + rest each day.
    const { nightOffTeams, clearOffTeams } = getOffDutyTeamsForDate(date);
    const total = teams.M.length + teams.A.length + teams.N.length + nightOffTeams.length + clearOffTeams.length;
    expect(total).toBe(5);
  });

  it("returns empty buckets for an unusable date", () => {
    expect(getShiftTeamsForDate("")).toEqual({ M: [], A: [], N: [] });
  });

  // Regression: the view once read the team off the fetched roster day, so
  // changing the date showed the previously-viewed date's teams until the
  // query resolved.  The assignment is a pure function of the date — these
  // invariants are what make the view "automatic".
  it("assigns all five teams exactly once per day and repeats every 5 days", () => {
    const dates = Array.from({ length: 10 }, (_, index) =>
      format(addDays(parseISO("2026-08-13"), index), "yyyy-MM-dd"),
    );

    const fingerprints = dates.map((date) => {
      const shiftTeams = getShiftTeamsForDate(date);
      const { nightOffTeams, clearOffTeams } = getOffDutyTeamsForDate(date);

      const assigned = [
        ...shiftTeams.M,
        ...shiftTeams.A,
        ...shiftTeams.N,
        ...nightOffTeams,
        ...clearOffTeams,
      ];

      // Every team is placed, none twice.
      expect([...assigned].sort()).toEqual(["A", "B", "C", "D", "E"]);
      // Exactly one team per working shift.
      expect([shiftTeams.M.length, shiftTeams.A.length, shiftTeams.N.length]).toEqual([1, 1, 1]);

      return `${shiftTeams.M}|${shiftTeams.A}|${shiftTeams.N}`;
    });

    // The cycle is 5 long: day N and day N+5 match, and no two days inside a
    // single cycle do.
    for (let index = 0; index + 5 < fingerprints.length; index += 1) {
      expect(fingerprints[index]).toBe(fingerprints[index + 5]);
    }
    expect(new Set(fingerprints.slice(0, 5)).size).toBe(5);
  });
});

describe("getTeamForDateAndShift", () => {
  // The ATC duty grid works in shift names, so both spellings must resolve.
  it("accepts a shift name or a shift code", () => {
    expect(getTeamForDateAndShift(ANCHOR, "Morning")).toBe("C");
    expect(getTeamForDateAndShift(ANCHOR, "M")).toBe("C");
    expect(getTeamForDateAndShift(ANCHOR, "Afternoon")).toBe("B");
    expect(getTeamForDateAndShift(ANCHOR, "Night")).toBe("A");
  });

  it("agrees with the shift-team map it is built on", () => {
    const date = "2026-08-13";
    const teams = getShiftTeamsForDate(date);

    expect(getTeamForDateAndShift(date, "Morning")).toBe(teams.M[0]);
    expect(getTeamForDateAndShift(date, "Afternoon")).toBe(teams.A[0]);
    expect(getTeamForDateAndShift(date, "Night")).toBe(teams.N[0]);
  });

  it("returns empty for an unusable shift or date, rather than guessing", () => {
    expect(getTeamForDateAndShift(ANCHOR, "")).toBe("");
    expect(getTeamForDateAndShift(ANCHOR, "Evening")).toBe("");
    expect(getTeamForDateAndShift("", "Morning")).toBe("");
  });
});

describe("getCurrentShiftCode", () => {
  it("maps the clock to the duty window from dutyConfig", () => {
    expect(getCurrentShiftCode(new Date(2026, 2, 9, 8, 0))).toBe("M"); // 0700-1300
    expect(getCurrentShiftCode(new Date(2026, 2, 9, 15, 0))).toBe("A"); // 1300-1900
    expect(getCurrentShiftCode(new Date(2026, 2, 9, 22, 0))).toBe("N"); // 1900-0700
    expect(getCurrentShiftCode(new Date(2026, 2, 9, 3, 0))).toBe("N"); // past midnight
  });
});

describe("buildShiftRosterFromRosters", () => {
  it("drops rows belonging to another date", () => {
    const day = buildShiftRosterFromRosters(
      [rosterRow({ date: "2026-03-10", employee_name: "Wrong Day" })],
      ANCHOR,
    );

    expect(day.totalMembers).toBe(0);
    expect(day.source).toBe("empty");
  });

  it("still reports the rotation teams when no rows exist", () => {
    const day = buildShiftRosterFromRosters([], ANCHOR);

    expect(day.groups.map((group) => group.teams)).toEqual([["C"], ["B"], ["A"]]);
  });

  it("routes rows into the matching shift column", () => {
    const day = buildShiftRosterFromRosters(
      [
        rosterRow({ id: "1", shift: "Morning", employee_name: "Morning Person" }),
        rosterRow({ id: "2", shift: "Night", team: "A", employee_name: "Night Person" }),
      ],
      ANCHOR,
    );

    const morning = day.groups.find((group) => group.code === "M")!;
    const night = day.groups.find((group) => group.code === "N")!;

    expect(morning.members.map((member) => member.name)).toEqual(["Morning Person"]);
    expect(night.members.map((member) => member.name)).toEqual(["Night Person"]);
    expect(day.source).toBe("rosters");
  });

  it("maps the roster columns onto the display fields", () => {
    // `duty` renders under the name, `position` renders as the badge.
    const day = buildShiftRosterFromRosters(
      [rosterRow({ id: "m", unit: "ACC-PLR", position: "ALPHA", employee_name: "Asha Rao" })],
      ANCHOR,
    );

    const member = day.groups.find((group) => group.code === "M")!.members[0];

    expect(member.duty).toBe("ALPHA"); // roster `position` column
    expect(member.position).toBe("ACC-PLR"); // roster `unit` column
  });

  it("flags a member whose own team does not own the shift", () => {
    const day = buildShiftRosterFromRosters(
      [
        rosterRow({ id: "own", team: "C", employee_name: "Own Team" }),
        rosterRow({ id: "visitor", team: "E", employee_name: "Visitor" }),
      ],
      ANCHOR,
    );

    const morning = day.groups.find((group) => group.code === "M")!;
    const byName = new Map(morning.members.map((member) => [member.name, member]));

    expect(byName.get("Own Team")!.isOffTeam).toBe(false);
    expect(byName.get("Visitor")!.isOffTeam).toBe(true);
  });

  it("separates extra duty, duty change and leave from the main list", () => {
    const day = buildShiftRosterFromRosters(
      [
        rosterRow({ id: "a", employee_name: "Regular" }),
        rosterRow({ id: "b", employee_name: "Extra", position: "EXTRA DUTY" }),
        rosterRow({ id: "c", employee_name: "Changed", unit: "DUTY CHANGE" }),
        rosterRow({ id: "d", employee_name: "Away", position: "CASUAL LEAVE" }),
      ],
      ANCHOR,
    );

    const morning = day.groups.find((group) => group.code === "M")!;

    expect(morning.members.map((member) => member.name)).toEqual(["Regular"]);
    expect(morning.extraDuty.map((member) => member.name)).toEqual(["Extra"]);
    expect(morning.dutyChange.map((member) => member.name)).toEqual(["Changed"]);
    expect(morning.onLeave.map((member) => member.name)).toEqual(["Away"]);
  });

  it("parses legacy date spellings for the same day", () => {
    const day = buildShiftRosterFromRosters(
      [rosterRow({ id: "legacy", date: "9-Mar-2026", employee_name: "Legacy Row" })],
      ANCHOR,
    );

    expect(day.totalMembers).toBe(1);
  });
});

describe("buildShiftRosterFromSchedules", () => {
  it("derives shift membership from duty codes", () => {
    const day = buildShiftRosterFromSchedules(
      [
        { employee_code: "E1", employee_name: "Morning Duty", duty_code: "M", duty_description: "Morning", team: "C" },
        { employee_code: "E2", employee_name: "Night Duty", duty_code: "N", duty_description: "Night", team: "A" },
        { employee_code: "E3", employee_name: "Resting", duty_code: "CO", duty_description: "Clear off", team: "D" },
      ],
      ANCHOR,
    );

    expect(day.groups.find((group) => group.code === "M")!.members.map((m) => m.name)).toEqual(["Morning Duty"]);
    expect(day.groups.find((group) => group.code === "N")!.members.map((m) => m.name)).toEqual(["Night Duty"]);
    expect(day.totalMembers).toBe(2); // the CO row has no shift column
    expect(day.source).toBe("schedules");
  });

  it("puts a compound duty code into extra duty on both shifts it covers", () => {
    const day = buildShiftRosterFromSchedules(
      [{ employee_code: "E4", employee_name: "Doubling Up", duty_code: "M+A", duty_description: null, team: "C" }],
      ANCHOR,
    );

    expect(day.groups.find((group) => group.code === "M")!.extraDuty.map((m) => m.name)).toEqual(["Doubling Up"]);
    expect(day.groups.find((group) => group.code === "A")!.extraDuty.map((m) => m.name)).toEqual(["Doubling Up"]);
  });

  it("ignores rows with no name", () => {
    const day = buildShiftRosterFromSchedules(
      [{ employee_code: "E5", employee_name: "   ", duty_code: "M", duty_description: null, team: "C" }],
      ANCHOR,
    );

    expect(day.totalMembers).toBe(0);
  });
});

describe("filterShiftRosterDay", () => {
  const day = buildShiftRosterFromRosters(
    [
      rosterRow({ id: "a", employee_name: "Asha Rao", unit: "UBN" }),
      rosterRow({ id: "b", employee_name: "Bhaskar Nair", unit: "UKW" }),
    ],
    ANCHOR,
  );

  it("matches on name, case-insensitively", () => {
    const filtered = filterShiftRosterDay(day, "asha");
    expect(filtered.totalMembers).toBe(1);
    expect(filtered.groups.find((group) => group.code === "M")!.members[0].name).toBe("Asha Rao");
  });

  it("matches on unit", () => {
    expect(filterShiftRosterDay(day, "UKW").totalMembers).toBe(1);
  });

  it("keeps the column shape so the teams still render", () => {
    const filtered = filterShiftRosterDay(day, "nothing matches this");
    expect(filtered.totalMembers).toBe(0);
    expect(filtered.groups).toHaveLength(3);
    expect(filtered.groups[0].teams).toEqual(["C"]);
  });

  it("returns the day untouched for an empty search", () => {
    expect(filterShiftRosterDay(day, "  ")).toBe(day);
  });
});
