import { describe, expect, it } from "vitest";

import {
  groupBacklogRuns,
  isLeaveDutyCode,
  splitIntoLeaveSegments,
  type DiscrepancyRow,
} from "@/lib/leaveReconciliation";

function backlogRow(
  employeeCode: string,
  date: string,
  dutyCode = "LEAVE",
): DiscrepancyRow {
  return {
    employeeCode,
    employeeName: `NAME ${employeeCode}`,
    team: "A",
    date,
    kind: "schedule_no_request",
    detail: "",
    leaveType: null,
    requestStatus: null,
    dutyCode,
  };
}

describe("isLeaveDutyCode", () => {
  it("matches the leave markers the roster actually writes", () => {
    for (const code of ["LEAVE", "SL", "CL", "EL", "HPL", "leave", "sl"]) {
      expect(isLeaveDutyCode(code), code).toBe(true);
    }
  });

  it("does not treat rest days, general duty, training or holidays as leave", () => {
    // Overwriting any of these with LEAVE would lose real roster information.
    for (const code of ["M", "A", "N", "CO", "SAT", "SUN", "G", "GO", "Tr", "CH", "NH", "NA", ""]) {
      expect(isLeaveDutyCode(code), code).toBe(false);
    }
  });

  it("matches compound codes when any token is leave", () => {
    expect(isLeaveDutyCode("CO+N")).toBe(false);
    expect(isLeaveDutyCode("SL+N")).toBe(true);
  });

  it("handles null and undefined", () => {
    expect(isLeaveDutyCode(null)).toBe(false);
    expect(isLeaveDutyCode(undefined)).toBe(false);
  });
});

describe("groupBacklogRuns", () => {
  it("collapses consecutive days for one employee into a single application", () => {
    const runs = groupBacklogRuns([
      backlogRow("E001", "2026-03-02"),
      backlogRow("E001", "2026-03-03"),
      backlogRow("E001", "2026-03-04"),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0].startDate).toBe("2026-03-02");
    expect(runs[0].endDate).toBe("2026-03-04");
    expect(runs[0].dates).toHaveLength(3);
  });

  it("splits on a gap in dates", () => {
    const runs = groupBacklogRuns([
      backlogRow("E001", "2026-03-02"),
      backlogRow("E001", "2026-03-03"),
      backlogRow("E001", "2026-03-06"),
    ]);

    expect(runs.map((r) => [r.startDate, r.endDate])).toEqual([
      ["2026-03-02", "2026-03-03"],
      ["2026-03-06", "2026-03-06"],
    ]);
  });

  it("never merges across employees, even on adjacent dates", () => {
    const runs = groupBacklogRuns([
      backlogRow("E001", "2026-03-02"),
      backlogRow("E002", "2026-03-03"),
    ]);

    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.employeeCode).sort()).toEqual(["E001", "E002"]);
  });

  it("spans a month boundary as one run", () => {
    const runs = groupBacklogRuns([
      backlogRow("E001", "2026-03-31"),
      backlogRow("E001", "2026-04-01"),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0].endDate).toBe("2026-04-01");
  });

  it("ignores rows that are not backlog", () => {
    const other: DiscrepancyRow = {
      ...backlogRow("E001", "2026-03-02"),
      kind: "approved_no_schedule",
    };

    expect(groupBacklogRuns([other])).toHaveLength(0);
  });

  it("keeps the duty code that produced each day", () => {
    const runs = groupBacklogRuns([
      backlogRow("E001", "2026-03-02", "SL"),
      backlogRow("E001", "2026-03-03", "LEAVE"),
    ]);

    expect(runs[0].dutyCodes).toEqual(["SL", "LEAVE"]);
  });
});

describe("splitIntoLeaveSegments", () => {
  const noHolidays = () => false;
  const aug = (d: number) => `2026-08-${String(d).padStart(2, "0")}`;
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => aug(from + i));

  it("returns one segment when every date shares the default type", () => {
    const segs = splitIntoLeaveSegments(range(4, 10), "CL", {}, noHolidays);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      startDate: aug(4),
      endDate: aug(10),
      leaveType: "CL",
      totalDays: 7,
    });
  });

  it("splits 4-10 Aug into CL 4-9 and COMP_OFF 10", () => {
    // The case this feature exists for.
    const segs = splitIntoLeaveSegments(
      range(4, 10),
      "CL",
      { [aug(10)]: "COMP_OFF" },
      noHolidays,
    );

    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({
      startDate: aug(4),
      endDate: aug(9),
      leaveType: "CL",
      totalDays: 6,
    });
    expect(segs[1]).toMatchObject({
      startDate: aug(10),
      endDate: aug(10),
      leaveType: "COMP_OFF",
      totalDays: 1,
    });
  });

  it("produces segments that never overlap, so the DB overlap trigger stays happy", () => {
    const segs = splitIntoLeaveSegments(
      range(1, 6),
      "CL",
      { [aug(3)]: "EL", [aug(4)]: "EL", [aug(6)]: "COMP_OFF" },
      noHolidays,
    );
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].startDate > segs[i - 1].endDate).toBe(true);
    }
    expect(segs.flatMap((s) => s.dates)).toEqual(range(1, 6));
  });

  it("splits again when a type returns after a gap", () => {
    const segs = splitIntoLeaveSegments(
      range(1, 3),
      "CL",
      { [aug(2)]: "COMP_OFF" },
      noHolidays,
    );
    expect(segs.map((s) => s.leaveType)).toEqual(["CL", "COMP_OFF", "CL"]);
  });

  it("excludes closed holidays from deducted days for CL-family leave", () => {
    const segs = splitIntoLeaveSegments(range(4, 6), "CL", {}, (d) => d === aug(5));
    expect(segs[0].chDates).toEqual([aug(5)]);
    expect(segs[0].totalDays).toBe(2);
    expect(segs[0].dates).toHaveLength(3);
  });

  it("ignores closed holidays for leave types they do not apply to", () => {
    const segs = splitIntoLeaveSegments(range(4, 6), "EL", {}, (d) => d === aug(5));
    expect(segs[0].chDates).toEqual([]);
    expect(segs[0].totalDays).toBe(3);
  });

  it("counts closed holidays per segment, not per run", () => {
    const segs = splitIntoLeaveSegments(
      range(4, 6),
      "CL",
      { [aug(6)]: "COMP_OFF" },
      (d) => d === aug(4) || d === aug(6),
    );
    expect(segs[0]).toMatchObject({ leaveType: "CL", totalDays: 1 });   // 4th is CH
    expect(segs[1]).toMatchObject({ leaveType: "COMP_OFF", totalDays: 0 }); // 6th is CH
  });

  it("handles a single date and an empty run", () => {
    expect(splitIntoLeaveSegments([aug(4)], "CL", {}, noHolidays)).toHaveLength(1);
    expect(splitIntoLeaveSegments([], "CL", {}, noHolidays)).toEqual([]);
  });
});
