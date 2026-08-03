/**
 * Rule-layer tests.
 *
 * The first block is the most important in the suite: a compliant roster must produce
 * ZERO violations. A compliance engine that cries wolf on the standard rotation gets
 * ignored, and an ignored engine is worse than none.
 */
import { describe, expect, it } from "vitest";

import { evaluateDay, dutySpan, MAX_RULE_REACH, RULES_ORDERED } from "@/lib/compliance/rules";
import { getRules } from "@/lib/compliance/registry";
import { buildTimelines, type EmployeeTimeline } from "@/lib/compliance/rosterState";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";

import { ANCHOR, day, rotationOf, scheduleOf } from "./fixtures";

function timelineOf(members: SummaryScheduleMember[]): EmployeeTimeline {
  const tl = buildTimelines(members).values().next().value;
  if (!tl) throw new Error("fixture produced no timeline");
  return tl;
}

/** Every violation across a span of days, as "DATE RULEID". */
function violations(tl: EmployeeTimeline, from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => day(from, i)).flatMap((date) =>
    evaluateDay(tl, date)
      .filter((e) => e.verdict === "violated")
      .map((e) => `${date} ${e.ruleId}`),
  );
}

function outcomeOn(tl: EmployeeTimeline, date: string, ruleId: string) {
  return evaluateDay(tl, date).find((e) => e.ruleId === ruleId);
}

describe("no false positives on a compliant roster", () => {
  it("the standard M→A→N→NO→CO rotation is entirely clean over 30 days", () => {
    const tl = timelineOf(rotationOf({ id: "C1", team: "C" }, ANCHOR, 30));
    // Skip the first/last few days where the fixture has no history to reason about.
    expect(violations(tl, day(ANCHOR, 5), 20)).toEqual([]);
  });

  it("is clean for every team offset", () => {
    for (const team of ["A", "B", "C", "D", "E"]) {
      const tl = timelineOf(rotationOf({ id: `${team}1`, team }, ANCHOR, 30));
      expect(violations(tl, day(ANCHOR, 5), 20)).toEqual([]);
    }
  });

  it("permits two consecutive nights without demanding rest mid-block", () => {
    // §7.3.1(b) allows two; the 54h only attaches to the duty AFTER the block.
    const tl = timelineOf(scheduleOf({ id: "N2" }, ANCHOR, "N N CO CO CO M"));
    expect(outcomeOn(tl, day(ANCHOR, 1), "WDTL.NIGHT2")?.verdict).toBe("satisfied");
    expect(outcomeOn(tl, day(ANCHOR, 1), "WDTL.RESTN1")).toBeUndefined();
  });
});

describe("the rotation sits exactly on the regulatory boundaries", () => {
  it("delivers exactly 48h between duty blocks (NO + CO)", () => {
    // N ends 0700 on D+1; the next block's M starts 0700 on D+3. This is why the
    // roster grants NO *and* CO — and why consuming the NO breaks §7.1.3(b).
    const tl = timelineOf(rotationOf({ id: "C1", team: "C" }, ANCHOR, 12));
    const postStreak = outcomeOn(tl, day(ANCHOR, 5), "WDTL.POSTSTREAK48");
    expect(postStreak?.verdict).toBe("satisfied");
    expect(postStreak?.observed).toBe("48h");
  });

  it("delivers exactly 12h between an Afternoon and the next Morning", () => {
    const tl = timelineOf(scheduleOf({ id: "X" }, ANCHOR, "A M"));
    const interval = outcomeOn(tl, day(ANCHOR, 1), "WDTL.INTERVAL12");
    expect(interval?.verdict).toBe("satisfied");
    expect(interval?.observed).toBe("12h");
  });
});

describe("BUG 3 — a night-break drops post-block rest to 36h", () => {
  it("reports POSTSTREAK48 when the Night-off is consumed", () => {
    // Rotation M A N NO CO M. Break the night: work A on the N day and A on the NO
    // day, leaving only the CO. The block becomes 4 days and the gap to the next
    // block's Morning collapses from 48h to 36h.
    const broken = timelineOf(scheduleOf({ id: "B1" }, ANCHOR, "M A A A CO M"));
    const outcome = outcomeOn(broken, day(ANCHOR, 5), "WDTL.POSTSTREAK48");

    expect(outcome?.verdict).toBe("violated");
    expect(outcome?.observed).toBe("36h");
    expect(outcome?.threshold).toBe("48h");
  });

  it("still only reaches 42h when the second duty is a Morning", () => {
    const broken = timelineOf(scheduleOf({ id: "B2" }, ANCHOR, "M A M M CO M"));
    expect(outcomeOn(broken, day(ANCHOR, 5), "WDTL.POSTSTREAK48")?.observed).toBe("42h");
  });

  it("leaves the cumulative caps untouched — 12h before and after the break", () => {
    const intact = timelineOf(scheduleOf({ id: "B3" }, ANCHOR, "N NO CO"));
    const broken = timelineOf(scheduleOf({ id: "B4" }, ANCHOR, "M M CO"));
    const sum = (tl: EmployeeTimeline) => [...tl.hoursByDate.values()].reduce((a, b) => a + b, 0);
    expect(sum(intact)).toBe(12);
    expect(sum(broken)).toBe(12);
  });
});

describe("OPS.ONEDUTY means one duty PERIOD, not one shift code", () => {
  it("passes M+A — a contiguous 0700–1900 block", () => {
    const tl = timelineOf(scheduleOf({ id: "O1" }, ANCHOR, "M+A"));
    expect(outcomeOn(tl, ANCHOR, "OPS.ONEDUTY")?.verdict).toBe("satisfied");
  });

  it("is exactly 12h of duty, at the DUTY12 limit but not over it", () => {
    const tl = timelineOf(scheduleOf({ id: "O2" }, ANCHOR, "M+A"));
    const duty = outcomeOn(tl, ANCHOR, "WDTL.DUTY12");
    expect(duty?.verdict).toBe("satisfied");
    expect(duty?.observed).toBe(12);
  });

  it("flags a genuinely split day", () => {
    // M (0700–1300) then N (1900–0700) leaves a 6h hole — two duty periods.
    const tl = timelineOf(scheduleOf({ id: "O3" }, ANCHOR, "M+N"));
    expect(outcomeOn(tl, ANCHOR, "OPS.ONEDUTY")?.verdict).toBe("violated");
  });
});

describe("cumulative and rest rules fire when they should", () => {
  it("catches a 7-day breach", () => {
    const tl = timelineOf(scheduleOf({ id: "H1" }, ANCHOR, "M+A M+A M+A M+A M+A"));
    const outcome = outcomeOn(tl, day(ANCHOR, 4), "WDTL.7D");
    expect(outcome?.verdict).toBe("violated");
    expect(outcome?.observed).toBe(60);
  });

  it("catches a 7th consecutive duty day, reported once at the end of the run", () => {
    const tl = timelineOf(scheduleOf({ id: "S1" }, ANCHOR, "M M M M M M M CO"));
    expect(violations(tl, ANCHOR, 8).filter((v) => v.endsWith("WDTL.CONSEC6"))).toEqual([
      `${day(ANCHOR, 6)} WDTL.CONSEC6`,
    ]);
  });

  it("catches a 3rd consecutive night", () => {
    const tl = timelineOf(scheduleOf({ id: "N3" }, ANCHOR, "N N N"));
    expect(outcomeOn(tl, day(ANCHOR, 2), "WDTL.NIGHT2")?.observed).toBe(3);
  });

  it("catches 24h rest after two nights against the 54h requirement", () => {
    const tl = timelineOf(scheduleOf({ id: "R1" }, ANCHOR, "N N CO M"));
    const outcome = outcomeOn(tl, day(ANCHOR, 3), "WDTL.RESTN2");
    expect(outcome?.verdict).toBe("violated");
    expect(outcome?.observed).toBe("24h");
  });
});

describe("every registry rule is actually evaluated", () => {
  // Guards against a rule being defined, governed and displayed in the Rule
  // Governance screen while silently never running — which is how FATIGUE.2NDNIGHT
  // was lost in the engine rewrite.
  it("leaves no rule orphaned in the registry", () => {
    const evaluated = new Set(RULES_ORDERED.map((r) => r.id));
    // Evaluated outside the per-day rule loop: coverage and preference signals.
    const evaluatedElsewhere = [
      "COVER.GROUPMIN",
      "COVER.SOURCE",
      "COVER.OCCMIN",
      "OPS.ELIG",
      "OPS.NOTICE7",
      "FATIGUE.PREVDAY",
      "PREF.MULTIRATING",
      "PREF.FAIRNESS",
    ];
    evaluatedElsewhere.forEach((id) => evaluated.add(id));

    const orphaned = Object.keys(getRules()).filter((id) => !evaluated.has(id));
    expect(orphaned).toEqual([]);
  });
});

describe("FATIGUE.2NDNIGHT (regression — dropped in the engine rewrite)", () => {
  it("flags the second of two consecutive nights", () => {
    const tl = timelineOf(scheduleOf({ id: "F1" }, ANCHOR, "CO N N CO"));
    const outcome = outcomeOn(tl, day(ANCHOR, 2), "FATIGUE.2NDNIGHT");
    expect(outcome?.verdict).toBe("violated");
    expect(outcome?.blocking).toBe(false); // advisory; WDTL.NIGHT2 owns the hard limit
  });

  it("stays silent on a first night", () => {
    const tl = timelineOf(scheduleOf({ id: "F2" }, ANCHOR, "CO N NO CO"));
    expect(outcomeOn(tl, day(ANCHOR, 1), "FATIGUE.2NDNIGHT")).toBeUndefined();
  });
});

describe("duty spans", () => {
  it("models a night as crossing midnight", () => {
    const n = dutySpan(ANCHOR, "N");
    expect((n!.end - n!.start) / 60).toBe(12);
    // Starts 1900, so it ends 0700 the following day.
    expect(n!.end % 1440).toBe(7 * 60);
  });

  it("treats rest codes as non-duty", () => {
    expect(dutySpan(ANCHOR, "NO")).toBeNull();
    expect(dutySpan(ANCHOR, "CO")).toBeNull();
  });

  it("exposes a revalidation radius wide enough for the 30-day cap", () => {
    expect(MAX_RULE_REACH).toBe(29);
  });
});
