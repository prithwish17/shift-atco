import { describe, expect, it } from "vitest";
import { HOURS_TOLERANCE_MIN, SECOND_HALF, SLOT_MIN } from "../constants";
import { evenOutHours, generateAllocation, hoursSpread } from "../solver";
import {
  countedMinutesOnDuty,
  dutyHoursLabel,
  eveningRestShortfalls,
  exemptMinutesOnDuty,
  fairShares,
  hasReplaceableDuties,
  uncoveredMinutes,
  validateAllocation,
} from "../rules";
import { accepted, blank, channel, dbSlot, duty, messages, night, refused, team } from "./fixtures";
import type { NightAllocationState, NightDuty } from "../types";

/**
 * Duty hours: every position but TSO. The generator shares them out evenly —
 * against each person's fair share, which the halves, part-night times and
 * TSO decide — and gives everyone a position other than TSO. Duties put on by
 * hand are kept by a generate, which plans the rest of the night around them.
 */

const fourPositions = () => ["TWR", "SMC-S", "CLD", "TSO"].map(code => channel(code));

/** A duty put on by hand. */
const pinned = (channelCode: string, personKey: string, startMin: number, endMin: number): NightDuty => ({
  ...duty(channelCode, personKey, startMin, endMin),
  kind: "pinned",
});

/**
 * A clock that moves a millisecond per read, so how far the generator gets
 * doesn't depend on how fast the machine running the tests is.
 */
const slowClock = () => {
  let clock = 0;
  return () => (clock += 1);
};

function expectContinuousAndLegal(state: NightAllocationState) {
  expect(uncoveredMinutes(state)).toBe(0);
  expect(validateAllocation(state).errors.map(issue => issue.message)).toEqual([]);
}

describe("duty hours", () => {
  it("leave TSO out, and say it apart", () => {
    const state = night({
      people: team(2, { tso: [1] }),
      channels: [channel("TWR"), channel("TSO")],
      duties: [duty("TWR", "p1", 0, 120), duty("TSO", "p1", 120, 240), dbSlot("TWR", "p1", 300, 360)],
    });
    expect(countedMinutesOnDuty(state, "p1")).toBe(180);
    expect(exemptMinutesOnDuty(state, "p1")).toBe(120);
    expect(dutyHoursLabel(state, "p1")).toBe("3h + TSO 2h");
    expect(dutyHoursLabel(state, "p2")).toBe("0m");
  });
});

describe("fair shares", () => {
  it("are the same for everyone around for the same night", () => {
    const shares = fairShares(night({ people: team(6), channels: [channel("TWR"), channel("SMC-S")] }));
    for (const { share } of shares.values()) expect(share).toBeCloseTo(240, 3);
  });

  it("leave nothing to the one person cleared for TSO, who holds it all night", () => {
    const shares = fairShares(night({ people: team(4, { tso: [1] }), channels: [channel("TWR"), channel("TSO")] }));
    expect(shares.get("p1")?.share).toBe(0);
    for (const key of ["p2", "p3", "p4"]) expect(shares.get(key)?.share).toBeCloseTo(240, 3);
  });

  it("fall due only while someone is in their half, and count what they already hold", () => {
    const state = night({
      people: team(4, { halves: { 1: "1st" } }),
      channels: [channel("TWR")],
      duties: [pinned("TWR", "p1", 0, 120)],
    });
    const share = fairShares(state).get("p1");
    // Nothing more falls due after 21:30, when the 1st Half has gone.
    expect(share?.due[SECOND_HALF[0] / SLOT_MIN]).toBeCloseTo(share?.share ?? -1, 3);
    // The duty put on by hand is theirs from the start.
    expect(share?.due[120 / SLOT_MIN]).toBeGreaterThanOrEqual(120);
  });
});

describe("the checks", () => {
  it("name someone on TSO and nothing else who could have held another position", () => {
    const state = night({
      people: team(3, { tso: [1, 2] }),
      channels: [channel("TWR", { closeAt: 240 }), channel("TSO", { closeAt: 240 })],
      duties: [duty("TSO", "p1", 0, 240), duty("TWR", "p2", 0, 120), duty("TWR", "p3", 120, 240)],
    });
    const result = validateAllocation(state);
    expect(result.errors).toEqual([]);
    expect(messages(result.warnings)).toContain(
      "Preferred: everyone holds a position other than TSO. Only on TSO: Person 1.",
    );
  });

  it("say nothing of hours that are even", () => {
    const state = night({
      people: team(2),
      channels: [channel("TWR", { closeAt: 240 })],
      duties: [duty("TWR", "p1", 0, 120), duty("TWR", "p2", 120, 240)],
    });
    expect(messages(validateAllocation(state).warnings).some(message => message.startsWith("Uneven"))).toBe(false);
  });
});

describe("the generator", () => {
  it("shares the duty hours out evenly, TSO not counted", () => {
    const state = night({ people: team(8, { tso: [1, 2, 3] }), channels: fourPositions() });
    const result = accepted(generateAllocation(state, { budgetMs: 2000, polishMs: 5000, seed: 3, now: slowClock() }));
    expectContinuousAndLegal(result.state);
    const { spread, tsoOnly } = hoursSpread(result.state);
    expect(tsoOnly).toBe(0);
    expect(spread).toBeLessThanOrEqual(2 * HOURS_TOLERANCE_MIN);
  }, 60_000);

  it("gives the people cleared for TSO a position other than TSO too", () => {
    const state = night({ people: team(6, { tso: [1, 2] }), channels: fourPositions() });
    const result = accepted(generateAllocation(state, { budgetMs: 2000, polishMs: 500, seed: 1, now: slowClock() }));
    expectContinuousAndLegal(result.state);
    expect(countedMinutesOnDuty(result.state, "p1")).toBeGreaterThan(0);
    expect(countedMinutesOnDuty(result.state, "p2")).toBeGreaterThan(0);
  }, 60_000);

  it("keeps the duties put on by hand, replaces the rest, and plans around them", () => {
    const kept = [pinned("TWR", "p1", 0, 90), pinned("SMC-S", "p2", 90, 210)];
    const stale = [duty("CLD", "p3", 0, 120), duty("TSO", "p4", 0, 720), blank("CLD", 120, 240)];
    const state = night({ people: team(8, { tso: [1, 2, 3, 4] }), channels: fourPositions(), duties: [...kept, ...stale] });

    const result = accepted(generateAllocation(state, { budgetMs: 1500, seed: 2 }));
    expectContinuousAndLegal(result.state);
    for (const entry of kept) expect(result.state.duties).toContainEqual(entry);
    for (const entry of stale) expect(result.state.duties.some(other => other.id === entry.id)).toBe(false);
    expect(result.note).toContain("The 2 duties put on by hand were kept and the rest planned around them.");
  }, 30_000);

  it("lets a duty put on by hand open its position, whoever was chosen to start it", () => {
    const channels = fourPositions().map(entry => (entry.code === "TWR" ? { ...entry, starterKey: "p5" } : entry));
    const opener = pinned("TWR", "p2", 0, 60);
    const state = night({ people: team(8, { tso: [1, 3, 4] }), channels, duties: [opener] });
    const result = accepted(generateAllocation(state, { budgetMs: 1500, seed: 4 }));
    expectContinuousAndLegal(result.state);
    expect(result.state.duties.find(entry => entry.channelCode === "TWR" && entry.startMin === 0)).toEqual(opener);
  }, 30_000);

  it("refuses, before searching, a duty put on by hand that breaks a rule on its own", () => {
    const people = team(6, { tso: [1, 2] }).map(person => (person.key === "p3" ? { ...person, available: false } : person));
    const state = night({ people, channels: fourPositions(), duties: [pinned("TWR", "p3", 0, 90)] });
    const refusal = refused(generateAllocation(state, { budgetMs: 200, seed: 1 }));
    expect(refusal.error).toBe(
      "A duty put on by hand breaks a rule, so no plan can keep it. Change it or take it off, then generate again.",
    );
    expect(refusal.reasons.length).toBeGreaterThan(0);
  });

  it("names the stretch a duty put on by hand leaves too short to cover", () => {
    const state = night({ people: team(6, { tso: [1, 2] }), channels: fourPositions(), duties: [pinned("TWR", "p1", 15, 105)] });
    const refusal = refused(generateAllocation(state, { budgetMs: 200, seed: 1 }));
    expect(refusal.reasons).toContain(
      "TWR 13:30–13:45 is only 15 min, between its opening and a duty put on by hand — too short for a duty. " +
        "Move the duty, or change when TWR opens or closes.",
    );
  });
});

describe("the evening rest comes before even hours", () => {
  it("keeps every rest on a night that can give everyone one, and evens the hours too", () => {
    const state = night({ people: team(8, { tso: [1, 2, 3] }), channels: fourPositions() });
    const result = accepted(generateAllocation(state, { budgetMs: 2000, polishMs: 3000, seed: 3, now: slowClock() }));
    expectContinuousAndLegal(result.state);
    expect(eveningRestShortfalls(result.state)).toEqual([]);
    expect(hoursSpread(result.state).spread).toBeLessThanOrEqual(2 * HOURS_TOLERANCE_MIN);
  }, 60_000);

  it("never costs anyone their rest when evening out", () => {
    for (const [count, seed] of [[6, 1], [7, 2], [8, 3], [9, 4]] as const) {
      const state = night({ people: team(count, { tso: [1, 2, 3] }), channels: fourPositions() });
      const plan = accepted(generateAllocation(state, { budgetMs: 400, polishMs: 0, seed })).state;
      const evened = evenOutHours(plan);
      expect(validateAllocation(evened).errors).toEqual([]);
      const rested = (entry: NightAllocationState) => eveningRestShortfalls(entry).map(shortfall => shortfall.person.key);
      // Nobody who had their 4 hours off loses them.
      expect(rested(evened).filter(key => !rested(plan).includes(key)), `${count} people`).toEqual([]);
    }
  }, 60_000);
});

describe("evening out a plan", () => {
  it("hands duties from whoever has most to whoever has least, breaking no rule", () => {
    const state = night({
      people: team(4),
      channels: [channel("TWR", { closeAt: 480 })],
      duties: [duty("TWR", "p1", 0, 120), duty("TWR", "p2", 120, 240), duty("TWR", "p1", 240, 360), duty("TWR", "p3", 360, 480)],
    });
    const evened = evenOutHours(state);
    expect(validateAllocation(evened).errors).toEqual([]);
    expect(["p1", "p2", "p3", "p4"].map(key => countedMinutesOnDuty(evened, key))).toEqual([120, 120, 120, 120]);
  });

  it("never moves a DB slot, a duty put on by hand, or a locked duty", () => {
    const fixed = [dbSlot("TWR", "p1", 0, 120), pinned("TWR", "p1", 240, 360)];
    const state = night({
      people: team(3),
      channels: [channel("TWR", { closeAt: 480 })],
      duties: [...fixed, duty("TWR", "p2", 120, 240), duty("TWR", "p2", 360, 480)],
    });
    const evened = evenOutHours(state, { locked: new Set([state.duties[3].id]) });
    for (const entry of fixed) expect(evened.duties).toContainEqual(entry);
    expect(evened.duties).toContainEqual(state.duties[3]);
    // The one duty free to move goes to the person with none.
    expect(countedMinutesOnDuty(evened, "p3")).toBe(120);
  });
});

describe("what a generate would replace", () => {
  it("is nothing on a board of DB slots and duties put on by hand", () => {
    const base = night({ people: team(2), channels: [channel("TWR")] });
    expect(hasReplaceableDuties({ ...base, duties: [dbSlot("TWR", "p1", 0, 120), pinned("TWR", "p2", 120, 240)] })).toBe(false);
    expect(hasReplaceableDuties({ ...base, duties: [pinned("TWR", "p2", 120, 240), duty("TWR", "p1", 240, 360)] })).toBe(true);
    expect(hasReplaceableDuties({ ...base, duties: [blank("TWR", 0, 120)] })).toBe(true);
  });
});
