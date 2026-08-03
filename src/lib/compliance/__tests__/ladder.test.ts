/**
 * Ladder tests — the four operational rules, in order, and the guarantee that the
 * order holds no matter what the soft signals or fairness counters say.
 */
import { describe, expect, it } from "vitest";

import { buildCoverageBase } from "@/lib/compliance/coverage";
import {
  EMPTY_FAIRNESS,
  buildOptions,
  compareOptions,
  fairnessLoad,
  rankOptions,
  type CoverOption,
  type FairnessHistory,
  type StrategyId,
} from "@/lib/compliance/ladder";
import { applyMutations } from "@/lib/compliance/planValidator";
import { buildTimelines, classifyDuty, type ShiftCode } from "@/lib/compliance/rosterState";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";

import { ANCHOR, cohort, day, scheduleOf } from "./fixtures";

const TARGET = day(ANCHOR, 5);

const NEXT_DAY = day(ANCHOR, 6);

/**
 * Team C sits on M at ANCHOR+5 and A at ANCHOR+6, so this filler leaves the Morning
 * of the following day uncovered — which is what makes a night-break relieve both
 * of its days by default. Tests that need the opposite add a team-D cohort, which
 * is on M at ANCHOR+6.
 */
function optionsFor(
  people: SummaryScheduleMember[][],
  subjectId: string,
  targetShift: ShiftCode,
  fairness: FairnessHistory = EMPTY_FAIRNESS,
  extraFiller: SummaryScheduleMember[] = [],
): CoverOption[] {
  const members = [
    ...cohort({ count: 20, prefix: "FILL", team: "C", rating: "RSR" }, ANCHOR, 12),
    ...extraFiller,
    ...people.flat(),
  ];
  const timelines = buildTimelines(members);
  const tl = timelines.get(subjectId.toUpperCase());
  if (!tl) throw new Error(`no timeline for ${subjectId}`);

  const base = buildCoverageBase(members, [TARGET, NEXT_DAY]);
  return buildOptions({ timeline: tl, member: tl.member, targetDate: TARGET, targetShift, base, fairness });
}

const strategies = (options: CoverOption[]) => options.map((o) => o.strategy);

describe("rule 1 — Night cover: Night-off, then Afternoon, then General", () => {
  const nightOff = () => scheduleOf({ id: "NOFF", rating: "RSR" }, ANCHOR, "M A N NO CO NO CO");
  const afternoon = () => scheduleOf({ id: "AFT", rating: "RSR" }, ANCHOR, "M A N NO CO A A");
  const general = () => scheduleOf({ id: "GEN", rating: "RSR" }, ANCHOR, "G G G G G G G");

  it("ranks the three sources in the prescribed order", () => {
    const options = [
      ...optionsFor([nightOff()], "NOFF", "N"),
      ...optionsFor([afternoon()], "AFT", "N"),
      ...optionsFor([general()], "GEN", "N"),
    ];
    expect(strategies(rankOptions(options))).toEqual([
      "CALLIN_NIGHTOFF",
      "SWAP_COUNTERPART",
      "GENERAL",
    ]);
  });

  it("writes NO+N for a Night-off call-in rather than replacing the rest day", () => {
    const [option] = optionsFor([nightOff()], "NOFF", "N");
    expect(option.mutations).toEqual([
      { employeeId: "NOFF", date: TARGET, from: "NO", to: "NO+N" },
    ]);
  });

  it("does not offer a night-break to fill a Night", () => {
    const onNight = scheduleOf({ id: "NGT", rating: "RSR" }, ANCHOR, "M A N NO CO N NO");
    expect(strategies(optionsFor([onNight], "NGT", "N"))).not.toContain("NIGHT_BREAK");
  });
});

describe("rules 2 and 3 — Morning cover: counterpart, night-break, extra duty, General", () => {
  // On the target day: an Afternoon worker, a Night worker with a rest day after,
  // and a General reserve.
  const afternoon = () => scheduleOf({ id: "AFT", rating: "RSR" }, ANCHOR, "M A N NO CO A A");
  // Runs far enough past the break to include the NEXT duty block, which is where
  // the lost 48h post-block rest actually shows up.
  const night = () => scheduleOf({ id: "NGT", rating: "RSR" }, ANCHOR, "M A N NO CO N NO CO M A");
  const general = () => scheduleOf({ id: "GEN", rating: "RSR" }, ANCHOR, "G G G G G G G");
  const clearOff = () => scheduleOf({ id: "CLR", rating: "RSR" }, ANCHOR, "M A N NO CO CO CO");

  it("ranks counterpart → night-break → extra duty → General → clear-off", () => {
    const options = [
      ...optionsFor([afternoon()], "AFT", "M"),
      ...optionsFor([night()], "NGT", "M"),
      ...optionsFor([general()], "GEN", "M"),
      ...optionsFor([clearOff()], "CLR", "M"),
    ];
    expect(strategies(rankOptions(options))).toEqual([
      "SWAP_COUNTERPART",
      "NIGHT_BREAK",
      "EXTRA_DUTY",
      "GENERAL",
      "CLEAR_OFF",
    ]);
  });

  it("offers the same Afternoon worker both a swap and an extra duty", () => {
    // Genuinely different trades: the swap costs the Afternoon a body, the extra
    // duty costs no coverage at all but works the controller 12h.
    const options = optionsFor([afternoon()], "AFT", "M");
    expect(strategies(options).sort()).toEqual(["EXTRA_DUTY", "SWAP_COUNTERPART"]);

    const extra = options.find((o) => o.strategy === "EXTRA_DUTY")!;
    expect(extra.mutations).toEqual([{ employeeId: "AFT", date: TARGET, from: "A", to: "M+A" }]);
    expect(extra.shortfalls).toEqual([]); // costs nothing in manpower
  });

  it("breaks a night across two days and leaves the clear-off intact", () => {
    const option = optionsFor([night()], "NGT", "M").find((o) => o.strategy === "NIGHT_BREAK")!;
    expect(option.mutations).toEqual([
      { employeeId: "NGT", date: TARGET, from: "N", to: "M" },
      { employeeId: "NGT", date: NEXT_DAY, from: "NO", to: "M" },
    ]);
    // The clear-off two days out is untouched — "one clear off only".
    expect(option.mutations.map((m) => m.date)).not.toContain(day(ANCHOR, 7));
  });

  it("warns that the night-break costs the 48h post-block rest", () => {
    const option = optionsFor([night()], "NGT", "M").find((o) => o.strategy === "NIGHT_BREAK")!;
    expect(option.warnings.map((w) => w.ruleId)).toContain("WDTL.POSTSTREAK48");
  });

  it("will not break a night when the following day is not a rest day", () => {
    const backToBack = scheduleOf({ id: "BTB", rating: "RSR" }, ANCHOR, "CO M A N NO N N");
    expect(strategies(optionsFor([backToBack], "BTB", "M"))).not.toContain("NIGHT_BREAK");
  });
});

describe("a night-break produces ORDINARY day duties, not nights", () => {
  // The two days become plain Morning/Afternoon duties. Nothing about them may be
  // treated as night work: no consecutive-night count, no rest-after-night owed.
  const night = () => scheduleOf({ id: "NGT", rating: "RSR" }, ANCHOR, "M A N NO CO N NO CO M A");
  const broken = () =>
    optionsFor([night()], "NGT", "M").find((o) => o.strategy === "NIGHT_BREAK")!;

  it("writes plain day-shift codes on both days", () => {
    expect(broken().mutations.map((m) => m.to)).toEqual(["M", "M"]);
  });

  it("counts them as 6h day duties, not 12h nights", () => {
    const members = [...cohort({ count: 20, prefix: "FILL", team: "C", rating: "RSR" }, ANCHOR, 12), ...night()];
    const tl = buildTimelines(members).get("NGT")!;
    const after = applyMutations(tl, broken().mutations);

    expect(after.hoursByDate.get(TARGET)).toBe(6);
    expect(after.hoursByDate.get(NEXT_DAY)).toBe(6);
    // The controller now has no night duty at all across the broken block.
    expect(classifyDuty(after.dutyByDate.get(TARGET)).shifts).toEqual(["M"]);
    expect(classifyDuty(after.dutyByDate.get(NEXT_DAY)).shifts).toEqual(["M"]);
  });

  it("owes no rest-after-night and counts toward no night streak", () => {
    const option = broken();
    const introduced = option.ledger.filter((e) => e.verdict === "violated").map((e) => e.ruleId);
    expect(introduced).not.toContain("WDTL.NIGHT2");
    expect(introduced).not.toContain("WDTL.RESTN1");
    expect(introduced).not.toContain("WDTL.RESTN2");
  });
});

describe("office order 251024/88 rules", () => {
  const afternoon = () => scheduleOf({ id: "AFT", rating: "RSR" }, ANCHOR, "M A N NO CO A A");

  it("records the similar-rating requirement for the exchange (§2)", () => {
    const elig = optionsFor([afternoon()], "AFT", "M")[0].ledger.find((e) => e.ruleId === "OPS.ELIG");
    expect(elig?.verdict).toBe("satisfied");
    expect(elig?.reason).toContain("RSR");
  });

  it("flags a change made inside the 7-day objection window (§1)", () => {
    // asOf two days before the duty: the ATCO can no longer give the required
    // 7 days notice to decline, so the change removes their objection right.
    const members = [...cohort({ count: 20, prefix: "FILL", team: "C", rating: "RSR" }, ANCHOR, 12), ...afternoon()];
    const tl = buildTimelines(members).get("AFT")!;
    const build = (asOf: string) =>
      buildOptions({
        timeline: tl,
        member: tl.member,
        targetDate: TARGET,
        targetShift: "M",
        base: buildCoverageBase(members, [TARGET, NEXT_DAY]),
        asOf,
      })[0].ledger.find((e) => e.ruleId === "OPS.NOTICE7");

    expect(build(day(ANCHOR, 3))?.verdict).toBe("violated");
    expect(build(day(ANCHOR, 3))?.observed).toBe("2d");
    // Ten days out there is ample notice, so the rule stays silent.
    expect(build(day(ANCHOR, -5))).toBeUndefined();
  });

  it("never blocks on the notice window — it is advisory, not a duty limit", () => {
    // Short notice is a procedural matter between the supervisor and the ATCO, not
    // a WDTL limit, so it must never disqualify a candidate.
    const members = [...cohort({ count: 20, prefix: "FILL", team: "C", rating: "RSR" }, ANCHOR, 12), ...afternoon()];
    const tl = buildTimelines(members).get("AFT")!;
    const options = buildOptions({
      timeline: tl,
      member: tl.member,
      targetDate: TARGET,
      targetShift: "M",
      base: buildCoverageBase(members, [TARGET, NEXT_DAY]),
      asOf: TARGET, // zero days notice
    });

    for (const option of options) {
      expect(option.ledger.map((e) => e.ruleId)).toContain("OPS.NOTICE7");
      expect(option.blockingFailures.map((e) => e.ruleId)).not.toContain("OPS.NOTICE7");
    }
  });
});

describe("night-break sub-rung", () => {
  const night = () => scheduleOf({ id: "NGT", rating: "RSR" }, ANCHOR, "M A N NO CO N NO CO M A");
  const breakOption = (extraFiller: SummaryScheduleMember[] = []) =>
    optionsFor([night()], "NGT", "M", EMPTY_FAIRNESS, extraFiller).find(
      (o) => o.strategy === "NIGHT_BREAK",
    )!;

  it("sits at the whole rung when both days are short", () => {
    // Default filler (team C) is on A the following day, leaving that Morning bare.
    const option = breakOption();
    expect(option.rung).toBe(2);
    expect(option.rationale).toMatch(/both days/i);
  });

  it("is demoted within the rung when the second day does not need the body", () => {
    // Team D works M on ANCHOR+6, so the following Morning is already covered and
    // the break's second duty is surplus.
    const covered = cohort({ count: 14, prefix: "DFILL", team: "D", rating: "RSR" }, ANCHOR, 12);
    const option = breakOption(covered);

    expect(option.rung).toBe(2.5);
    expect(option.rationale).toMatch(/surplus/i);
  });

  it("ranks the two-day break above the one-day break", () => {
    expect(compareOptions(breakOption(), breakOption(
      cohort({ count: 14, prefix: "DFILL", team: "D", rating: "RSR" }, ANCHOR, 12),
    ))).toBeLessThan(0);
  });
});

describe("fairness rotates within a rung and never across one", () => {
  const afternoon = (id: string) => scheduleOf({ id, rating: "RSR" }, ANCHOR, "M A N NO CO A A");

  it("puts the least-imposed-upon controller first", () => {
    const busy = optionsFor([afternoon("BUSY")], "BUSY", "M", {
      ...EMPTY_FAIRNESS,
      exchangesYear: 4,
    }).find((o) => o.strategy === "SWAP_COUNTERPART")!;
    const fresh = optionsFor([afternoon("FRESH")], "FRESH", "M").find(
      (o) => o.strategy === "SWAP_COUNTERPART",
    )!;

    expect(rankOptions([busy, fresh]).map((o) => o.employeeId)).toEqual(["FRESH", "BUSY"]);
  });

  it("counts exchanges, extra duties and night-breaks as one rotation load", () => {
    expect(fairnessLoad({ ...EMPTY_FAIRNESS, exchangesYear: 3 })).toBe(3);
    expect(fairnessLoad({ ...EMPTY_FAIRNESS, opeYear: 3 })).toBe(3);
    expect(fairnessLoad({ ...EMPTY_FAIRNESS, nightBreaksYear: 3 })).toBe(3);
    // This month weighs double, on top of its contribution to the year.
    expect(fairnessLoad({ ...EMPTY_FAIRNESS, exchangesYear: 1, exchangesMonth: 1 })).toBe(3);
  });

  it("PROPERTY: no fairness gap can promote a worse rung", () => {
    const option = (rung: number, load: number, soft: number): CoverOption =>
      ({ rung, fairnessLoad: load, softScore: soft, name: "x" }) as CoverOption;

    // A pristine record on rung 3 still loses to a heavily-loaded rung 1.
    for (const load of [0, 1, 10, 500, 10_000]) {
      expect(compareOptions(option(1, load, -1000), option(3, 0, 1000))).toBeLessThan(0);
    }
  });

  it("PROPERTY: no soft score can promote a worse rung or beat better fairness", () => {
    const option = (rung: number, load: number, soft: number): CoverOption =>
      ({ rung, fairnessLoad: load, softScore: soft, name: "x" }) as CoverOption;

    for (const soft of [-1000, 0, 25, 1000]) {
      expect(compareOptions(option(1, 5, -1000), option(2, 0, soft))).toBeLessThan(0);
      expect(compareOptions(option(1, 0, -1000), option(1, 1, soft))).toBeLessThan(0);
    }
  });
});

describe("blocking", () => {
  // Team B works A on ANCHOR+5. Exactly 12 of them — the Afternoon minimum for
  // group 1 — so releasing even one breaks the donor shift.
  function tightPool() {
    const members = cohort({ count: 12, prefix: "TIGHT", team: "B", rating: "RSR" }, ANCHOR, 12);
    expect(members.filter((m) => m.duty_date === TARGET && m.duty_code === "A")).toHaveLength(12);

    const tl = buildTimelines(members).get("TIGHT1")!;
    return buildOptions({
      timeline: tl,
      member: tl.member,
      targetDate: TARGET,
      targetShift: "M",
      base: buildCoverageBase(members, [TARGET, NEXT_DAY]),
    });
  }

  it("blocks a swap that would strip the donor shift below its minimum", () => {
    const swap = tightPool().find((o) => o.strategy === "SWAP_COUNTERPART")!;
    expect(swap.blocked).toBe(true);
    expect(swap.blockingFailures.map((f) => f.ruleId)).toContain("COVER.SOURCE");
    expect(swap.shortfalls[0]).toMatchObject({ before: 12, after: 11, required: 12 });
  });

  it("does not block the extra-duty alternative, which takes nobody away", () => {
    // The same controller, the same tight roster — but M+A leaves the Afternoon
    // count untouched. This is exactly why extra duty is the fallback when the
    // counterpart swap is impossible.
    const extra = tightPool().find((o) => o.strategy === "EXTRA_DUTY")!;
    expect(extra.blocked).toBe(false);
    expect(extra.shortfalls).toEqual([]);
  });

  it("proposes nothing for someone already on the shift or on leave", () => {
    const covering = scheduleOf({ id: "COV", rating: "RSR" }, ANCHOR, "M A N NO CO M M");
    const onLeave = scheduleOf({ id: "LVE", rating: "RSR" }, ANCHOR, "M A N NO CO SL SL");
    expect(optionsFor([covering], "COV", "M")).toEqual([]);
    expect(optionsFor([onLeave], "LVE", "M")).toEqual([]);
  });
});
