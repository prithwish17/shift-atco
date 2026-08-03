/**
 * Coverage delta tests — the manpower half of the gate.
 */
import { describe, expect, it } from "vitest";

import {
  buildCoverageBase,
  cellKey,
  coverageShortfalls,
  deficitsFor,
  groupsOf,
  mergeDeltas,
  mutationDelta,
  requiredFor,
  shiftsOf,
} from "@/lib/compliance/coverage";
import type { DutyMutation } from "@/lib/compliance/planValidator";
import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";

import { ANCHOR, cohort, rotationOf } from "./fixtures";

const rsr = (id: string): SummaryScheduleMember =>
  rotationOf({ id, team: "C", rating: "RSR" }, ANCHOR, 1)[0];

const mutate = (date: string, from: string | null, to: string): DutyMutation => ({
  employeeId: "X",
  date,
  from,
  to,
});

describe("shift occupancy of duty codes", () => {
  it("maps the codes the ladder actually writes", () => {
    expect(shiftsOf("M")).toEqual(["M"]);
    expect(shiftsOf("M+A")).toEqual(["M", "A"]);
    expect(shiftsOf("NO+N")).toEqual(["N"]);
    expect(shiftsOf("CO+N")).toEqual(["N"]);
  });

  it("treats rest and General as occupying no M/A/N slot", () => {
    expect(shiftsOf("NO")).toEqual([]);
    expect(shiftsOf("CO")).toEqual([]);
    expect(shiftsOf("G")).toEqual([]);
    expect(shiftsOf("GO")).toEqual([]);
  });
});

describe("mutation deltas", () => {
  it("extra duty adds Morning and costs nothing — this is why it is coverage-safe", () => {
    const delta = mutationDelta(rsr("E1"), [mutate(ANCHOR, "A", "M+A")]);
    expect(delta.get(cellKey(ANCHOR, "M", "G1"))).toBe(1);
    // The Afternoon entry cancels to zero and is dropped, not left at 0.
    expect(delta.has(cellKey(ANCHOR, "A", "G1"))).toBe(false);
  });

  it("a night-break moves a body off the Night onto a day shift", () => {
    const delta = mutationDelta(rsr("N1"), [mutate(ANCHOR, "N", "M")]);
    expect(delta.get(cellKey(ANCHOR, "N", "G1"))).toBe(-1);
    expect(delta.get(cellKey(ANCHOR, "M", "G1"))).toBe(1);
  });

  it("a Night-off call-in adds to the Night without taking from anywhere", () => {
    const delta = mutationDelta(rsr("C1"), [mutate(ANCHOR, "NO", "NO+N")]);
    expect([...delta.entries()]).toEqual([[cellKey(ANCHOR, "N", "G1"), 1]]);
  });

  it("a counterpart swap depletes the donor shift", () => {
    const delta = mutationDelta(rsr("S1"), [mutate(ANCHOR, "A", "M")]);
    expect(delta.get(cellKey(ANCHOR, "A", "G1"))).toBe(-1);
    expect(delta.get(cellKey(ANCHOR, "M", "G1"))).toBe(1);
  });

  it("counts a controller in every group they qualify for", () => {
    const dual = { ...rsr("D1"), highest_rating: "RSR", designation: "ALPHA CONTROLLER" };
    expect(groupsOf(dual)).toEqual(["G1", "G5"]);

    const delta = mutationDelta(dual, [mutate(ANCHOR, "A", "M")]);
    expect(delta.get(cellKey(ANCHOR, "A", "G1"))).toBe(-1);
    expect(delta.get(cellKey(ANCHOR, "A", "G5"))).toBe(-1);
  });
});

describe("the depletion gate", () => {
  // Group 1 (RSR) needs 12 on a Morning and 16 on a Night.
  const base = (morningCount: number) =>
    buildCoverageBase(
      cohort({ count: morningCount, prefix: "R", team: "C", rating: "RSR" }, ANCHOR, 1),
      [ANCHOR],
    );

  it("allows pulling from a shift with slack", () => {
    // 13 on Morning, minimum 12 — one can be released.
    const shortfalls = coverageShortfalls(base(13), mutationDelta(rsr("X"), [mutate(ANCHOR, "M", "A")]));
    expect(shortfalls).toEqual([]);
  });

  it("blocks pulling from a shift already at its minimum", () => {
    const shortfalls = coverageShortfalls(base(12), mutationDelta(rsr("X"), [mutate(ANCHOR, "M", "A")]));
    expect(shortfalls).toHaveLength(1);
    expect(shortfalls[0]).toMatchObject({ group: "G1", before: 12, after: 11, required: 12 });
  });

  it("never objects to a plan that only adds people", () => {
    expect(coverageShortfalls(base(12), mutationDelta(rsr("X"), [mutate(ANCHOR, "NO", "NO+N")]))).toEqual([]);
  });

  it("catches two individually-safe picks that jointly break the minimum", () => {
    // 13 on Morning: releasing one is fine, releasing two is not. Evaluated
    // separately both pass; merged, the pair is correctly rejected.
    const board = base(13);
    const first = mutationDelta(rsr("X"), [mutate(ANCHOR, "M", "A")]);
    const second = mutationDelta(rsr("Y"), [mutate(ANCHOR, "M", "A")]);

    expect(coverageShortfalls(board, first)).toEqual([]);
    expect(coverageShortfalls(board, second)).toEqual([]);
    expect(coverageShortfalls(board, mergeDeltas([first, second]))).toHaveLength(1);
  });
});

describe("chart minimums", () => {
  it("matches the compiled D1 table", () => {
    expect(requiredFor("G1", "M")).toBe(12);
    expect(requiredFor("G1", "N")).toBe(16);
    expect(requiredFor("G3", "M")).toBe(14);
    expect(requiredFor("G4", "N")).toBe(9);
    expect(requiredFor("G5", "N")).toBe(10);
    expect(requiredFor("OCC", "M")).toBe(4);
    expect(requiredFor("OCC", "N")).toBe(7);
  });

  it("reports the deficit for a short column", () => {
    const members = cohort({ count: 9, prefix: "R", team: "C", rating: "RSR" }, ANCHOR, 1);
    const row = deficitsFor(buildCoverageBase(members, [ANCHOR]), new Map(), ANCHOR, "M")
      .find((r) => r.group === "G1");
    expect(row).toMatchObject({ available: 9, required: 12, deficit: 3 });
  });
});
