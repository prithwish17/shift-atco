/**
 * Manpower tests — the day chart a supervisor reads, and the per-cell statement of
 * what a plan does to it.
 *
 * The load-bearing assertion here is the last one: `planImpact().breaches` and
 * `coverageShortfalls()` must always name the same cells. The UI blocks on the
 * first and the engine's own gate is written against the second; if they can
 * disagree, the finder shows a plan as safe that the gate rejects, or worse the
 * reverse.
 */
import { describe, expect, it } from "vitest";

import {
  buildCoverageBase,
  coverageShortfalls,
  mutationDelta,
  type CellKey,
} from "@/lib/compliance/coverage";
import {
  buildDayManpower,
  describeImpact,
  planImpact,
  safetyRank,
} from "@/lib/compliance/manpower";
import type { DutyMutation } from "@/lib/compliance/planValidator";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";

import { ANCHOR, cohort, day, scheduleOf } from "./fixtures";

/** ANCHOR+5: team C is on M, team B on A, team A on N. */
const DATE = day(ANCHOR, 5);

const mutate = (date: string, from: string | null, to: string): DutyMutation => ({
  employeeId: "X",
  date,
  from,
  to,
});

const rsr = (id: string): SummaryScheduleMember =>
  scheduleOf({ id, rating: "RSR" }, DATE, "M")[0];

/** A day where group 1 has `morning` people on the Morning and `afternoon` on the A. */
function roster(morning: number, afternoon: number, extra: SummaryScheduleMember[] = []) {
  return [
    ...cohort({ count: morning, prefix: "M", team: "C", rating: "RSR" }, DATE, 1),
    ...cohort({ count: afternoon, prefix: "A", team: "B", rating: "RSR" }, DATE, 1),
    ...extra,
  ];
}

describe("the day chart", () => {
  it("reports every shift, not just the one being filled", () => {
    const dayView = buildDayManpower(roster(13, 12), DATE);

    expect(dayView.shifts.map((s) => s.shift)).toEqual(["M", "A", "N"]);
    expect(dayView.byShift.M.headcount).toBe(13);
    expect(dayView.byShift.A.headcount).toBe(12);
    expect(dayView.byShift.N.headcount).toBe(0);
  });

  it("states each group's margin against its own minimum", () => {
    // Group 1 (RSR) needs 12 on a Morning and 16 on a Night.
    const dayView = buildDayManpower(roster(13, 11), DATE);
    const g1 = (shift: "M" | "A") => dayView.byShift[shift].cells.find((c) => c.group === "G1")!;

    expect(g1("M")).toMatchObject({ available: 13, required: 12, net: 1, deficit: 0, headroom: 1 });
    expect(g1("A")).toMatchObject({ available: 11, required: 12, net: -1, deficit: 1, headroom: 0 });
    expect(dayView.byShift.A.shortGroups.map((c) => c.group)).toContain("G1");
  });

  it("counts one body once, however many rows the roster carries for them", () => {
    // A re-import that left the original row behind: same person, two duty codes.
    const duplicated = [
      ...roster(12, 12),
      { ...rsr("M1"), duty_code: "A", duty_description: "A" },
    ];
    const dayView = buildDayManpower(duplicated, DATE);

    // Last row wins, exactly as buildTimelines resolves it — so the Morning loses
    // them rather than both shifts claiming the same body.
    expect(dayView.byShift.M.headcount).toBe(11);
    expect(dayView.byShift.A.headcount).toBe(13);
    expect(dayView.totals.rostered).toBe(24);
  });

  it("separates extra duty, General, leave and rest from the shift head-counts", () => {
    const dayView = buildDayManpower(
      roster(12, 12, [
        ...scheduleOf({ id: "OPE1", rating: "RSR" }, DATE, "M+A"),
        ...scheduleOf({ id: "GEN1", rating: "RSR" }, DATE, "G"),
        ...scheduleOf({ id: "SICK", rating: "RSR" }, DATE, "SL"),
        ...scheduleOf({ id: "REST", rating: "RSR" }, DATE, "CO"),
      ]),
      DATE,
    );

    expect(dayView.extraDuty.map((e) => e.employeeId)).toEqual(["OPE1"]);
    expect(dayView.general.map((e) => e.employeeId)).toEqual(["GEN1"]);
    expect(dayView.onLeave.map((e) => e.employeeId)).toEqual(["SICK"]);
    expect(dayView.resting.map((e) => e.employeeId)).toEqual(["REST"]);

    // An extra duty holds both day slots, so it counts toward both shifts…
    expect(dayView.byShift.M.headcount).toBe(13);
    expect(dayView.byShift.A.headcount).toBe(13);
    expect(dayView.byShift.M.extraDuty.map((e) => e.employeeId)).toEqual(["OPE1"]);
    // …but General, leave and rest occupy no M/A/N slot at all.
    expect(dayView.totals.onDuty).toBe(25);
    expect(dayView.totals.rostered).toBe(28);
  });

  it("says so when the date has no published roster", () => {
    expect(buildDayManpower([], DATE).rostered).toBe(false);
  });

  it("shows the day as it would be once a staged pick lands", () => {
    const members = roster(13, 12);
    const projected = buildDayManpower(members, DATE, [
      { employeeId: "M1", date: DATE, from: "M", to: "A" },
    ]);

    expect(projected.byShift.M.cells.find((c) => c.group === "G1")).toMatchObject({
      available: 12,
      net: 0,
      headroom: 0,
    });
    // The counts and the name lists move together — a projected chart that said 12
    // next to thirteen names would be worse than showing nothing.
    expect(projected.byShift.M.headcount).toBe(12);
    expect(projected.byShift.M.onDuty.map((e) => e.employeeId)).not.toContain("M1");
    expect(projected.byShift.A.onDuty.map((e) => e.employeeId)).toContain("M1");
  });

  it("shows a rest-day call-in as the body they are about to become", () => {
    // Nobody rostered on DATE, but they exist on the roster either side of it.
    const members = [
      ...roster(12, 12),
      ...scheduleOf({ id: "REST1", rating: "RSR" }, day(ANCHOR, 4), "CO -"),
    ];
    const projected = buildDayManpower(members, DATE, [
      { employeeId: "REST1", date: DATE, from: null, to: "A" },
    ]);

    expect(projected.byShift.A.onDuty.map((e) => e.employeeId)).toContain("REST1");
    expect(projected.byShift.A.cells.find((c) => c.group === "G1")?.available).toBe(13);
  });

  it("leaves days the staged picks do not touch alone", () => {
    const members = roster(13, 12);
    const untouched = buildDayManpower(members, DATE, [
      { employeeId: "M1", date: day(ANCHOR, 9), from: "M", to: "A" },
    ]);

    expect(untouched.byShift.M.headcount).toBe(13);
  });
});

describe("what a plan does to the chart", () => {
  const base = (morning: number, afternoon: number) =>
    buildCoverageBase(roster(morning, afternoon), [DATE]);

  const swap = (from: string, to: string) => mutationDelta(rsr("X"), [mutate(DATE, from, to)]);

  it("names both halves of a swap — what it fills and what it empties", () => {
    const impact = planImpact(base(14, 12), swap("M", "A"));

    expect(impact.reinforcements).toHaveLength(1);
    expect(impact.reinforcements[0]).toMatchObject({
      group: "G1", shift: "A", before: 12, after: 13, required: 12,
    });
    expect(impact.releases).toHaveLength(1);
    expect(impact.releases[0]).toMatchObject({
      group: "G1", shift: "M", before: 14, after: 13, required: 12, status: "surplus",
    });
  });

  it("grades the donor cell: spare, exactly at minimum, or breached", () => {
    expect(planImpact(base(14, 12), swap("M", "A")).releases[0].status).toBe("surplus");
    expect(planImpact(base(13, 12), swap("M", "A")).releases[0].status).toBe("at-minimum");
    expect(planImpact(base(12, 12), swap("M", "A")).releases[0].status).toBe("breach");
  });

  it("reports the margin left in the tightest donor", () => {
    expect(planImpact(base(15, 12), swap("M", "A")).safetyMargin).toBe(2);
    expect(planImpact(base(13, 12), swap("M", "A")).safetyMargin).toBe(0);
    expect(planImpact(base(12, 12), swap("M", "A")).safetyMargin).toBe(-1);
  });

  it("reports a null margin — not zero — when nothing is taken from anywhere", () => {
    // A night-off call-in adds a body without releasing one. Zero would read as
    // "no slack left"; null is "no donor shift to run out of slack".
    const impact = planImpact(base(12, 12), mutationDelta(rsr("X"), [mutate(DATE, "NO", "NO+N")]));

    expect(impact.releases).toEqual([]);
    expect(impact.safetyMargin).toBeNull();
    expect(safetyRank(impact.safetyMargin)).toBe(Number.POSITIVE_INFINITY);
    expect(safetyRank(0)).toBeLessThan(safetyRank(null));
  });

  it("costs no coverage for an extra duty, because nobody leaves a shift", () => {
    const impact = planImpact(base(12, 12), swap("A", "M+A"));

    expect(impact.releases).toEqual([]);
    expect(impact.breaches).toEqual([]);
    expect(impact.reinforcements.map((r) => r.shift)).toEqual(["M"]);
  });

  it("puts the most endangered donor first, so the summary leads with the risk", () => {
    // A controller rated into two groups: the Morning is comfortable for G1 and
    // tight for G5, and the tight one has to be the headline.
    const dual = { ...rsr("D1"), highest_rating: "RSR", designation: "ALPHA CONTROLLER" };
    const board = buildCoverageBase(
      [
        ...cohort({ count: 20, prefix: "M", team: "C", rating: "RSR" }, DATE, 1),
        ...cohort({ count: 11, prefix: "AL", team: "C", rating: "ALPHA" }, DATE, 1),
        dual,
      ],
      [DATE],
    );
    const impact = planImpact(board, mutationDelta(dual, [mutate(DATE, "M", "A")]));

    // Group 5 (ALPHA) needs 11 on a Morning; 12 there means one to spare.
    expect(impact.tightest).toMatchObject({ group: "G5", after: 11, required: 11 });
    expect(impact.releases[0].group).toBe("G5");
    expect(impact.safetyMargin).toBe(0);
  });

  it("summarises the effect in one line, both directions", () => {
    expect(describeImpact(planImpact(base(14, 12), swap("M", "A")))).toBe(
      "+RSR Afternoon 14 Mar 12→13/12 · −RSR Morning 14 Mar 14→13/12",
    );
  });
});

describe("INVARIANT: the impact view and the gate name the same cells", () => {
  const cells = (list: Array<{ cell: CellKey }>) => list.map((c) => c.cell).sort();

  // Every combination of donor pressure the ladder can produce: comfortable,
  // exactly at minimum, already short, and a two-day night-break.
  const cases: Array<[string, SummaryScheduleMember[], DutyMutation[]]> = [
    ["donor with slack", roster(20, 12), [mutate(DATE, "M", "A")]],
    ["donor at minimum", roster(13, 12), [mutate(DATE, "M", "A")]],
    ["donor already short", roster(10, 12), [mutate(DATE, "M", "A")]],
    ["nothing released", roster(12, 12), [mutate(DATE, "NO", "NO+N")]],
    ["extra duty", roster(12, 12), [mutate(DATE, "A", "M+A")]],
    [
      "night-break across two days",
      roster(12, 12),
      [mutate(DATE, "N", "M"), mutate(day(ANCHOR, 6), "NO", "M")],
    ],
  ];

  it.each(cases)("%s", (_label, members, mutations) => {
    const board = buildCoverageBase(members, [DATE, day(ANCHOR, 6)]);
    const delta = mutationDelta(rsr("X"), mutations);

    expect(cells(planImpact(board, delta).breaches)).toEqual(cells(coverageShortfalls(board, delta)));
  });

  it("agrees that adding people can never breach anything", () => {
    const board = buildCoverageBase(roster(12, 12), [DATE]);
    const delta = mutationDelta(rsr("X"), [mutate(DATE, "CO", "CO+M")]);

    expect(planImpact(board, delta).breaches).toEqual([]);
    expect(coverageShortfalls(board, delta)).toEqual([]);
  });
});
