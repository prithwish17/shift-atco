/**
 * Plan validator tests — the multi-day substrate the ladder is built on.
 */
import { describe, expect, it } from "vitest";

import {
  affectedWindow,
  applyMutations,
  cloneTimeline,
  validatePlan,
  type DutyMutation,
} from "@/lib/compliance/planValidator";
import { buildTimelines, type EmployeeTimeline } from "@/lib/compliance/rosterState";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";

import { ANCHOR, day, rotationOf, scheduleOf } from "./fixtures";

function timelineOf(members: SummaryScheduleMember[]): EmployeeTimeline {
  const tl = buildTimelines(members).values().next().value;
  if (!tl) throw new Error("fixture produced no timeline");
  return tl;
}

const mutate = (date: string, from: string | null, to: string): DutyMutation => ({
  employeeId: "X",
  date,
  from,
  to,
});

const ids = (entries: { ruleId: string }[]) => entries.map((e) => e.ruleId);

describe("mutation application is non-destructive", () => {
  it("leaves the source timeline untouched", () => {
    const tl = timelineOf(scheduleOf({ id: "X" }, ANCHOR, "A A A"));
    const next = applyMutations(tl, [mutate(ANCHOR, "A", "M+A")]);

    expect(tl.dutyByDate.get(ANCHOR)).toBe("A");
    expect(tl.hoursByDate.get(ANCHOR)).toBe(6);
    expect(next.dutyByDate.get(ANCHOR)).toBe("M+A");
    expect(next.hoursByDate.get(ANCHOR)).toBe(12);
  });

  it("clones maps rather than sharing references", () => {
    const tl = timelineOf(scheduleOf({ id: "X" }, ANCHOR, "M"));
    const copy = cloneTimeline(tl);
    copy.dutyByDate.set(ANCHOR, "N");
    expect(tl.dutyByDate.get(ANCHOR)).toBe("M");
  });
});

describe("the revalidation window is derived from the rules", () => {
  it("spans a symmetric radius wide enough for the 30-day cap", () => {
    const w = affectedWindow([mutate(day(ANCHOR, 10), "N", "M")]);
    expect(w.start).toBe(day(ANCHOR, 10 - 29));
    expect(w.end).toBe(day(ANCHOR, 10 + 29));
  });

  it("covers every mutated date in a multi-day plan", () => {
    const w = affectedWindow([
      mutate(day(ANCHOR, 10), "N", "M"),
      mutate(day(ANCHOR, 11), "NO", "M"),
    ]);
    expect(w.start).toBe(day(ANCHOR, -19));
    expect(w.end).toBe(day(ANCHOR, 40));
  });
});

describe("BUG 2 fixed — downstream breaches are now caught", () => {
  it("reports the 54h rest a Night-off call-in owes two days later", () => {
    // N yesterday, NO today, CO tomorrow, M the day after. Taking the night makes
    // two consecutive nights; the rostered M then sits at 24h against a 54h duty.
    const tl = timelineOf(scheduleOf({ id: "X" }, day(ANCHOR, -1), "N NO CO M"));
    const result = validatePlan(tl, [mutate(ANCHOR, "NO", "NO+N")]);

    expect(ids(result.introduced)).toContain("WDTL.RESTN2");
    expect(result.blocked).toBe(true);
  });
});

describe("pre-existing breaches are not blamed on the plan", () => {
  it("separates an inherited violation from one the plan introduces", () => {
    // This roster already runs 7 consecutive days. Covering an unrelated later day
    // must not be blocked by a breach that was there before we touched anything.
    const tl = timelineOf(
      scheduleOf({ id: "X" }, ANCHOR, "M M M M M M M CO CO CO CO CO CO CO"),
    );
    const result = validatePlan(tl, [mutate(day(ANCHOR, 10), "CO", "M")]);

    expect(ids(result.preExisting)).toContain("WDTL.CONSEC6");
    expect(ids(result.introduced)).not.toContain("WDTL.CONSEC6");
    expect(result.blocked).toBe(false);
  });

  it("still blocks when the plan is what creates the breach", () => {
    // 12+12+12+6+6 = 48h, clean beforehand; the extra duty tips it to 54h.
    const tl = timelineOf(scheduleOf({ id: "X" }, ANCHOR, "M+A M+A M+A M A"));
    const result = validatePlan(tl, [mutate(day(ANCHOR, 4), "A", "M+A")]);

    expect(ids(result.introduced)).toContain("WDTL.7D");
    expect(result.blocked).toBe(true);
  });
});

describe("CAR Para 7.1.3 exemption", () => {
  // Office Order AAI/GM/ATM/ADMN/Ops/251024/88 (24.10.2025) records that the
  // exemption for Para 7.1.3 stands, granted by ED (Aviation Safety). Both
  // sub-paragraphs still report — an exempted breach must stay visible — but
  // neither may block a duty change.
  it("reports a 7-day streak without blocking it", () => {
    const tl = timelineOf(scheduleOf({ id: "X" }, ANCHOR, "M M M M M M CO"));
    const result = validatePlan(tl, [mutate(day(ANCHOR, 6), "CO", "M")]);

    const streak = result.warnings.find((e) => e.ruleId === "WDTL.CONSEC6");
    expect(streak?.observed).toBe(7);
    expect(streak?.exemption?.authority).toBe("ED (Aviation Safety)");
    expect(result.blocked).toBe(false);
  });

  it("reports the shortened post-block rest without blocking it", () => {
    // A night-break on the intact rotation: the 48h the NO+CO pair delivers drops
    // to 36h. Real, reported — and permitted, because 7.1.3(b) is exempted.
    const tl = timelineOf(scheduleOf({ id: "Y" }, ANCHOR, "M A N NO CO M"));
    const result = validatePlan(tl, [
      mutate(day(ANCHOR, 2), "N", "A"),
      mutate(day(ANCHOR, 3), "NO", "A"),
    ]);

    const rest = result.warnings.find((e) => e.ruleId === "WDTL.POSTSTREAK48");
    expect(rest?.observed).toBe("36h");
    expect(rest?.blocking).toBe(false);
    expect(result.blocked).toBe(false);
  });

  it("leaves the un-exempted DGCA limits fully enforced", () => {
    // Only Para 7.1.3 is exempted; every other temporary exemption was withdrawn
    // w.e.f. 0001 hrs on 31.10.2025.
    const tl = timelineOf(scheduleOf({ id: "Z" }, ANCHOR, "N N CO M"));
    const result = validatePlan(tl, [mutate(day(ANCHOR, 3), "M", "M")]);
    expect(result.preExisting.concat(result.introduced).map((e) => e.ruleId)).toContain(
      "WDTL.RESTN2",
    );
  });
});

describe("night-break validation", () => {
  const nightBreak = (from: string, second: string): DutyMutation[] => [
    mutate(day(from, 2), "N", "A"),
    mutate(day(from, 3), "NO", second),
  ];

  it("warns about the 36h post-block rest without blocking", () => {
    // §7.1.3(b) is non-blocking (T3), so a break is offerable — but never silently.
    const tl = timelineOf(rotationOf({ id: "C1", team: "C" }, ANCHOR, 12));
    const result = validatePlan(tl, nightBreak(ANCHOR, "A"));

    expect(ids(result.warnings)).toContain("WDTL.POSTSTREAK48");
    expect(result.warnings.find((w) => w.ruleId === "WDTL.POSTSTREAK48")?.observed).toBe("36h");
    expect(result.blocked).toBe(false);
  });

  it("clears the night rules it removes rather than inheriting them", () => {
    // Once the N is gone the person has no night at all, so no rest-after-night
    // requirement survives into the following days.
    const tl = timelineOf(rotationOf({ id: "C1", team: "C" }, ANCHOR, 12));
    const result = validatePlan(tl, nightBreak(ANCHOR, "A"));

    expect(ids(result.introduced)).not.toContain("WDTL.RESTN1");
    expect(ids(result.introduced)).not.toContain("WDTL.RESTN2");
  });

  it("leaves the 7-day total unchanged — 12h of night becomes 12h of day duty", () => {
    const tl = timelineOf(rotationOf({ id: "C1", team: "C" }, ANCHOR, 12));
    const before = [...tl.hoursByDate.values()].reduce((a, b) => a + b, 0);
    const after = [...applyMutations(tl, nightBreak(ANCHOR, "A")).hoursByDate.values()].reduce(
      (a, b) => a + b,
      0,
    );
    expect(after).toBe(before);
  });
});

describe("extra duty validation", () => {
  it("accepts A → M+A: contiguous, exactly 12h, no coverage lost", () => {
    const tl = timelineOf(rotationOf({ id: "C1", team: "C" }, ANCHOR, 12));
    // Team C works A on ANCHOR+1.
    expect(tl.dutyByDate.get(day(ANCHOR, 1))).toBe("A");

    const result = validatePlan(tl, [mutate(day(ANCHOR, 1), "A", "M+A")]);
    expect(result.blocked).toBe(false);
    expect(ids(result.introduced)).not.toContain("OPS.ONEDUTY");
    expect(ids(result.introduced)).not.toContain("WDTL.DUTY12");
  });

  it("blocks extra duty that would breach the weekly cap", () => {
    // 12+12+12+6+6 = 48h, exactly at the cap and therefore clean beforehand.
    // Turning the final Afternoon into M+A adds 6h and tips it to 54h.
    const tl = timelineOf(scheduleOf({ id: "X" }, ANCHOR, "M+A M+A M+A M A"));
    const result = validatePlan(tl, [mutate(day(ANCHOR, 4), "A", "M+A")]);

    expect(ids(result.preExisting)).not.toContain("WDTL.7D");
    expect(ids(result.introduced)).toContain("WDTL.7D");
    expect(result.blocked).toBe(true);
  });
});
