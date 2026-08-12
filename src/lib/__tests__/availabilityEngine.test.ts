/**
 * Availability finder — end-to-end.
 *
 * The scenario these tests exist for: an Afternoon is short of RSRs, the finder
 * offers a Morning RSR to swap across, and that offer is only legitimate while the
 * MORNING still meets its own RSR minimum without them. A suggestion that fixes one
 * shift by breaking another is not a suggestion, it is a second call-out.
 */
import { describe, expect, it } from "vitest";

import { findAvailability } from "@/lib/availabilityEngine";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";

import { ANCHOR, cohort, day } from "@/lib/compliance/__tests__/fixtures";

/**
 * ANCHOR+5 — team C on M, team B on A, team A on N.
 * ANCHOR+6 — team D on M, team C on A, team B on N, team A on NO.
 */
const DATE = day(ANCHOR, 5);
const NEXT = day(ANCHOR, 6);

/** Group 1 (RSR) needs 12 on a day shift and 16 on a Night. */
const RSR_DAY_MINIMUM = 12;

interface RosterSpec {
  /** RSRs on the Morning of DATE (team C). */
  morning: number;
  /** RSRs on the Afternoon of DATE (team B). */
  afternoon: number;
  /** RSRs on the Night of DATE, off the next day (team A). */
  night?: number;
  /** RSRs on the Morning of NEXT (team D). */
  nextMorning?: number;
  days?: number;
}

function roster({ morning, afternoon, night = 0, nextMorning = 0, days = 2 }: RosterSpec) {
  return [
    ...cohort({ count: morning, prefix: "MOR", team: "C", rating: "RSR" }, DATE, days),
    ...cohort({ count: afternoon, prefix: "AFT", team: "B", rating: "RSR" }, DATE, days),
    ...cohort({ count: night, prefix: "NGT", team: "A", rating: "RSR" }, DATE, days),
    ...cohort({ count: nextMorning, prefix: "NXT", team: "D", rating: "RSR" }, DATE, days),
  ];
}

const find = (members: SummaryScheduleMember[], shift: "M" | "A" | "N" = "A") =>
  findAvailability({ members, date: DATE, shift, rating: 1 });

const namesIn = (options: Array<{ name: string }>) => options.map((o) => o.name).sort();

describe("the source shift has to survive the suggestion", () => {
  it("offers the Morning swap while the Morning has a body to spare", () => {
    // 13 on the Morning: releasing one still leaves the minimum of 12.
    const result = find(roster({ morning: 13, afternoon: 10 }));
    const swaps = result.options.filter((o) => o.strategy === "SWAP_COUNTERPART");

    expect(swaps.length).toBe(13);
    expect(result.blocked.filter((o) => o.strategy === "SWAP_COUNTERPART")).toEqual([]);
    expect(swaps[0].impact.releases[0]).toMatchObject({
      group: "G1",
      shift: "M",
      before: 13,
      after: RSR_DAY_MINIMUM,
      required: RSR_DAY_MINIMUM,
      status: "at-minimum",
    });
  });

  it("refuses every Morning swap once the Morning is down to its own minimum", () => {
    // 12 on the Morning: taking one leaves 11 against a minimum of 12.
    const result = find(roster({ morning: 12, afternoon: 10 }));

    expect(result.options.filter((o) => o.strategy === "SWAP_COUNTERPART")).toEqual([]);
    expect(result.blocked.filter((o) => o.strategy === "SWAP_COUNTERPART")).toHaveLength(12);

    const [blocked] = result.blocked;
    expect(blocked.blockingFailures.map((f) => f.ruleId)).toContain("COVER.SOURCE");
    expect(blocked.blockingFailures[0].reason).toMatch(/RSR on the Morning/);
    expect(blocked.blockingFailures[0]).toMatchObject({ observed: 11, threshold: 12, blocking: true });
    expect(blocked.impact.breaches).toHaveLength(1);
  });

  it("refuses a Morning already below its minimum rather than making it worse", () => {
    const result = find(roster({ morning: 8, afternoon: 10 }));

    expect(result.options.filter((o) => o.strategy === "SWAP_COUNTERPART")).toEqual([]);
    expect(result.blocked[0].impact.breaches[0]).toMatchObject({ before: 8, after: 7, required: 12 });
  });

  it("records the passing verdict too, so the check is visible when it holds", () => {
    const [swap] = find(roster({ morning: 20, afternoon: 10 })).options;
    const source = swap.ledger.find((e) => e.ruleId === "COVER.SOURCE");

    expect(source).toMatchObject({ verdict: "satisfied", observed: 19, threshold: 12 });
    expect(source?.reason).toMatch(/holds at 19 without them/);
  });

  it("never blocks an extra duty on source grounds — nobody leaves a shift", () => {
    // Filling the Morning from the Afternoon: the swap costs the Afternoon a body,
    // the M+A extra duty costs nothing, so only the swap can be gated.
    const result = find(roster({ morning: 10, afternoon: 12 }), "M");

    expect(result.options.filter((o) => o.strategy === "SWAP_COUNTERPART")).toEqual([]);
    const extra = result.options.filter((o) => o.strategy === "EXTRA_DUTY");
    expect(extra).toHaveLength(12);
    expect(extra[0]).toMatchObject({ createsOpe: true, targetDutyCode: "M+A" });
    expect(extra[0].impact.releases).toEqual([]);
    expect(extra[0].impact.safetyMargin).toBeNull();
  });

  it("gates the Night on its own minimum, which is higher than a day shift's", () => {
    // Group 1 needs 16 on a Night against 12 on a day shift. A night-break takes a
    // body off the Night, so 16 there is already the floor.
    const short = find(roster({ morning: 10, afternoon: 12, night: 16, nextMorning: 14 }), "M");
    const spare = find(roster({ morning: 10, afternoon: 12, night: 17, nextMorning: 14 }), "M");

    expect(short.options.filter((o) => o.strategy === "NIGHT_BREAK")).toEqual([]);
    expect(short.blocked.find((o) => o.strategy === "NIGHT_BREAK")?.blockingFailures[0]).toMatchObject({
      ruleId: "COVER.SOURCE",
      observed: 15,
      threshold: 16,
    });
    expect(spare.options.filter((o) => o.strategy === "NIGHT_BREAK")).toHaveLength(17);
  });
});

describe("the day the cover is being found for", () => {
  it("reports all three shifts, not only the one being filled", () => {
    const result = find(roster({ morning: 13, afternoon: 10, night: 16 }));

    expect(result.dayManpower.date).toBe(DATE);
    expect(result.dayManpower.shifts.map((s) => s.shift)).toEqual(["M", "A", "N"]);
    expect(result.dayManpower.byShift.M.headcount).toBe(13);
    expect(result.dayManpower.byShift.A.headcount).toBe(10);
    expect(result.dayManpower.byShift.N.headcount).toBe(16);
  });

  it("agrees with the gate about the head-count it is protecting", () => {
    const result = find(roster({ morning: 13, afternoon: 10 }));
    const chartMorning = result.dayManpower.byShift.M.cells.find((c) => c.group === "G1");
    const release = result.options[0].impact.releases[0];

    // The "before" a supervisor reads and the "before" the gate enforces are the
    // same number, because both come from one dedupe and one pair of primitives.
    expect(release.before).toBe(chartMorning?.available);
  });

  it("lists the day's extra duties", () => {
    const members = roster({ morning: 13, afternoon: 10 });
    const opeRows = members
      .filter((m) => m.employee_id === "MOR1" && m.duty_date === DATE)
      .map((m) => ({ ...m, duty_code: "M+A", duty_description: "M+A" }));

    const result = find([...members, ...opeRows]);
    expect(result.dayManpower.extraDuty.map((e) => e.employeeId)).toEqual(["MOR1"]);
    expect(result.dayManpower.totals.extraDuty).toBe(1);
  });
});

describe("the two-day window a night-break needs", () => {
  // Regression: `iso(date, 1)` used to round-trip through UTC, so anywhere east of
  // Greenwich it returned `date` itself. The coverage snapshot then held only one
  // day, every D+1 cell read as absent (0), and a night-break always looked like it
  // relieved a shortage on its second day whether or not one existed.
  const nightBreakOn = (members: SummaryScheduleMember[]) =>
    find(members, "M").options.find((o) => o.strategy === "NIGHT_BREAK");

  it("marks the second duty surplus when neither shift on D+1 needs it", () => {
    // 13 on the Morning of DATE is 13 on the Afternoon of NEXT (team C rotates
    // M → A), and 14 covers the Morning of NEXT — so D+1 needs nobody.
    const option = nightBreakOn(roster({ morning: 13, afternoon: 12, night: 17, nextMorning: 14 }));

    expect(option).toBeDefined();
    expect(option?.mutations.map((m) => m.date)).toEqual([DATE, NEXT]);
    expect(option?.rationale).toBe(`Second duty on ${NEXT} is surplus to requirement`);
    expect(option?.rung).toBe(2.5);
  });

  it("promotes it when the next Morning genuinely is short", () => {
    const option = nightBreakOn(roster({ morning: 13, afternoon: 12, night: 17, nextMorning: 3 }));

    expect(option?.rationale).toBe(`Relieves M on ${DATE} and M on ${NEXT}`);
    expect(option?.rung).toBe(2);
  });
});
