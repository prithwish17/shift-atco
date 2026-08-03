/**
 * The three defects from the plan, now asserted as FIXED.
 *
 * These began life asserting the broken behaviour (see the plan's Phase 1). Each
 * assertion has been flipped rather than deleted, so the record of what was wrong —
 * and what specifically changed — stays in the suite.
 */
import { describe, expect, it } from "vitest";

import { buildCoverageBase } from "@/lib/compliance/coverage";
import { EMPTY_FAIRNESS, buildOptions, rankOptions } from "@/lib/compliance/ladder";
import { validatePlan } from "@/lib/compliance/planValidator";
import { buildTimelines, type EmployeeTimeline, type ShiftCode } from "@/lib/compliance/rosterState";
import { evaluateDay } from "@/lib/compliance/rules";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";

import { ANCHOR, cohort, day, rotationOf, scheduleOf } from "./fixtures";

function timelineOf(members: SummaryScheduleMember[]): EmployeeTimeline {
  const tl = buildTimelines(members).values().next().value;
  if (!tl) throw new Error("fixture produced no timeline");
  return tl;
}

const violatedOn = (tl: EmployeeTimeline, date: string) =>
  evaluateDay(tl, date).filter((e) => e.verdict === "violated").map((e) => e.ruleId);

describe("BUG 1 fixed — cumulative gates no longer depend on the fetch window", () => {
  it("uses a trailing window, so the 7-day cap is computed from real history", () => {
    // 5 × M+A = 60h. The old code called rollingPeak over windows the finder never
    // fetched; windowSumEnding asks the regulatory question — duty in the preceding
    // 7 days — and needs only history that is actually loaded.
    const tl = timelineOf(scheduleOf({ id: "H1" }, ANCHOR, "M+A M+A M+A M+A M+A"));
    expect(violatedOn(tl, day(ANCHOR, 4))).toContain("WDTL.7D");
  });

  it("catches a plan that pushes the trailing week over the cap", () => {
    const tl = timelineOf(scheduleOf({ id: "H2" }, ANCHOR, "M+A M+A M+A M A"));
    const result = validatePlan(tl, [
      { employeeId: "H2", date: day(ANCHOR, 4), from: "A", to: "M+A" },
    ]);
    expect(result.blockingFailures.map((f) => f.ruleId)).toContain("WDTL.7D");
  });
});

describe("BUG 2 fixed — downstream breaches are validated", () => {
  it("reports the 54h rest a Night-off call-in owes two days later", () => {
    const tl = timelineOf(scheduleOf({ id: "R1" }, day(ANCHOR, -1), "N NO CO M"));
    const result = validatePlan(tl, [{ employeeId: "R1", date: ANCHOR, from: "NO", to: "NO+N" }]);

    expect(result.introduced.map((e) => e.ruleId)).toContain("WDTL.RESTN2");
    expect(result.blocked).toBe(true);
  });
});

describe("BUG 3 fixed — ladder order is correct and stable for Night", () => {
  const target = day(ANCHOR, 5);

  // One 20-strong cohort per team, so on any date every shift carries 20 RSR — clear
  // of the 12/16 minimums. This isolates rung order from coverage blocking.
  const fullyStaffed = ["A", "B", "C", "D", "E"].flatMap((team) =>
    cohort({ count: 20, prefix: `F${team}`, team, rating: "RSR" }, ANCHOR, 12),
  );

  function rank(people: SummaryScheduleMember[][], shift: ShiftCode, fairnessById: Record<string, number> = {}) {
    const members = [...fullyStaffed, ...people.flat()];
    const timelines = buildTimelines(members);
    const base = buildCoverageBase(members, [target, day(ANCHOR, 6)]);

    const options = people.flatMap((person) => {
      const id = String(person[0].employee_id).toUpperCase();
      const tl = timelines.get(id)!;
      return buildOptions({
        timeline: tl,
        member: tl.member,
        targetDate: target,
        targetShift: shift,
        base,
        fairness: { ...EMPTY_FAIRNESS, exchangesYear: fairnessById[id] ?? 0 },
      });
    });
    // Ranked regardless of blocking: the claim under test is the ORDER the ladder
    // assigns, which is independent of whether a given roster leaves someone free.
    return rankOptions(options);
  }

  const nightOff = () => scheduleOf({ id: "NOFF", rating: "RSR" }, ANCHOR, "M A N NO CO NO CO");
  const afternoon = () => scheduleOf({ id: "AFT", rating: "RSR" }, ANCHOR, "M A N NO CO A A");
  // A realistic General week — seven straight 8h days would breach the 48h cap on
  // its own and get blocked before the ladder was ever consulted.
  const general = () => scheduleOf({ id: "GEN", rating: "RSR" }, ANCHOR, "CO CO G G G G G");

  it("puts the Afternoon swap ahead of General, reversing the old scoring", () => {
    // Previously General collected PREF.GENERAL *and* PREF.SHIFT_FIT and outscored
    // the Afternoon swap (-15 vs -25), the exact opposite of the operational rule.
    const ranked = rank([nightOff(), afternoon(), general()], "N");
    expect(ranked.map((o) => o.employeeId)).toEqual(["NOFF", "AFT", "GEN"]);
    expect(ranked.map((o) => o.rung)).toEqual([1, 2, 3]);
  });

  it("keeps that order however lopsided the exchange history is", () => {
    // The old engine let an unbounded fairness penalty reorder the strategies.
    // Loading the preferred candidates heavily must not promote General.
    const ranked = rank([nightOff(), afternoon(), general()], "N", {
      NOFF: 40,
      AFT: 25,
      GEN: 0,
    });
    expect(ranked.map((o) => o.employeeId)).toEqual(["NOFF", "AFT", "GEN"]);
  });
});

describe("FINDING — rung 1 of the Night ladder is usually unusable at N = 12h", () => {
  it("a Night-off call-in in the real rotation breaches the 48h weekly cap", () => {
    // Not a fixture artefact. In the production M→A→N→NO→CO cycle, calling someone
    // in on their Night-off puts a THIRD night into a 7-day window — 3 × 12h = 36h
    // plus the surrounding day shifts — over the 48h cap of §7.1.1(b). It follows
    // directly from F2 fixing N at 12h in dutyConfig.ts, so in practice the Night
    // ladder usually starts at rung 2.
    const tl = timelineOf(rotationOf({ id: "E1", team: "E" }, ANCHOR, 16));
    expect(tl.dutyByDate.get(day(ANCHOR, 5))).toBe("NO");

    const result = validatePlan(tl, [
      { employeeId: "E1", date: day(ANCHOR, 5), from: "NO", to: "NO+N" },
    ]);
    expect(result.blockingFailures.map((f) => f.ruleId)).toContain("WDTL.7D");
  });

  it("the rotation grants exactly 48h after a night — enough for one, 6h short for two", () => {
    // Team B works A on ANCHOR+5 and N on ANCHOR+6, so swapping them onto the night
    // makes it two consecutive nights. That is permitted by §7.3.1(b), but §7.3.2(b)
    // then demands 54h rest and the cycle only ever delivers 48h (N ends 0700, the
    // next block's M starts 0700 two days later).
    //
    // Consequence: in this rotation ANY intervention that creates a second
    // consecutive night breaches the rest rule. The roster is built to meet the
    // minimum exactly, so it carries no slack for night cover.
    const tl = timelineOf(rotationOf({ id: "B1", team: "B" }, ANCHOR, 16));
    expect(tl.dutyByDate.get(day(ANCHOR, 5))).toBe("A");
    expect(tl.dutyByDate.get(day(ANCHOR, 6))).toBe("N");

    const result = validatePlan(tl, [
      { employeeId: "B1", date: day(ANCHOR, 5), from: "A", to: "N" },
    ]);
    const restBreach = result.introduced.find((e) => e.ruleId === "WDTL.RESTN2");
    expect(restBreach?.observed).toBe("48h");
    expect(restBreach?.threshold).toBe("54h");
  });

  it("is clean when the swap leaves the controller on a single night", () => {
    // The same A → N swap, but this controller's following day is already rest, so
    // no second night is created and the 48h the roster provides is sufficient.
    const tl = timelineOf(scheduleOf({ id: "S1" }, ANCHOR, "M A N NO CO A NO CO M"));
    const result = validatePlan(tl, [
      { employeeId: "S1", date: day(ANCHOR, 5), from: "A", to: "N" },
    ]);
    expect(result.introduced).toEqual([]);
    expect(result.blocked).toBe(false);
  });
});

describe("behaviour preserved from the original engine", () => {
  it("still blocks a 3rd consecutive night", () => {
    const tl = timelineOf(scheduleOf({ id: "N1" }, ANCHOR, "N N N"));
    expect(violatedOn(tl, day(ANCHOR, 2))).toContain("WDTL.NIGHT2");
  });

  it("still blocks a day shift the morning after a night duty", () => {
    const tl = timelineOf(scheduleOf({ id: "N2" }, ANCHOR, "N M"));
    expect(violatedOn(tl, day(ANCHOR, 1))).toContain("WDTL.RESTN1");
  });

  it("still treats the standard rotation as fully compliant", () => {
    const tl = timelineOf(rotationOf({ id: "C1", team: "C" }, ANCHOR, 30));
    const all = Array.from({ length: 20 }, (_, i) => violatedOn(tl, day(ANCHOR, i + 5))).flat();
    expect(all).toEqual([]);
  });
});
