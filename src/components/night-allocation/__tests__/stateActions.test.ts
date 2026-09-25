import { describe, expect, it } from "vitest";
import { validateAllocation } from "@/domain/night-allocation";
import { channel, dbSlot, duty, night, team } from "@/domain/night-allocation/__tests__/fixtures";
import {
  mergeToggle,
  removeDbSlot,
  setChannelInUse,
  setMergeSmcCld,
  setPersonAvailability,
} from "../stateActions";

/** CLD folded into SMC-S, nothing planned yet. */
function mergedNight() {
  const base = night({
    people: team(4),
    channels: [channel("TWR"), channel("SMC-S"), channel("SMC-N", { inUse: false }), channel("CLD")],
  });
  return setMergeSmcCld(base, true).state;
}

describe("unticking the position CLD is merged into", () => {
  it("separates CLD again rather than leaving a merge into nothing", () => {
    const { state, note } = setChannelInUse(mergedNight(), "SMC-S", false);

    expect(state.channels.find(entry => entry.code === "CLD")?.mergedInto).toBeNull();
    expect(validateAllocation(state).errors.map(issue => issue.message).join("\n")).not.toContain("merge");
    expect(note).toContain("CLD no longer merged into it");
  });

  it("leaves the merge alone when some other position is unticked", () => {
    const { state } = setChannelInUse(mergedNight(), "TWR", false);
    expect(state.channels.find(entry => entry.code === "CLD")?.mergedInto).toBe("SMC-S");
  });
});

describe("the merge switch", () => {
  it("is off and offers the SMC in use when nothing is merged", () => {
    const state = night({ channels: [channel("SMC-S"), channel("CLD")] });
    expect(mergeToggle(state)).toEqual({ on: false, enabled: true, targetCode: "SMC-S" });
  });

  it("is disabled when there is nothing to merge into", () => {
    const state = night({ channels: [channel("TWR"), channel("CLD")] });
    expect(mergeToggle(state)).toEqual({ on: false, enabled: false, targetCode: null });
  });

  it("shows a merge that no longer holds as on, so it can still be turned off", () => {
    // Saved or edited into a state where the SMC went away without the merge
    // being cleared: the checks panel reports it, so the switch must reach it.
    const stale = night({
      channels: [channel("SMC-S", { inUse: false }), channel("CLD", { mergedInto: "SMC-S" })],
    });
    expect(validateAllocation(stale).errors.some(issue => issue.message.includes("merge into SMC-S"))).toBe(true);
    expect(mergeToggle(stale)).toEqual({ on: true, enabled: true, targetCode: "SMC-S" });

    const cleared = setMergeSmcCld(stale, false).state;
    expect(cleared.channels.find(entry => entry.code === "CLD")?.mergedInto).toBeNull();
    expect(validateAllocation(cleared).errors).toEqual([]);
  });
});

describe("someone's times", () => {
  it("clears a starter who is away when their position opens, and says which duties clash", () => {
    const base = night({
      people: team(3),
      channels: [channel("TWR", { starterKey: "p1" }), channel("CLD", { openAt: 480, starterKey: "p1" })],
      duties: [duty("TWR", "p1", 0, 120), duty("TWR", "p1", 240, 360)],
    });
    const { state, note } = setPersonAvailability(base, "p1", { mode: "except", periods: [[0, 60], [300, 330]] });

    expect(state.channels.find(entry => entry.code === "TWR")?.starterKey).toBeNull();
    // CLD opens at 21:30, when they are back: that start stands.
    expect(state.channels.find(entry => entry.code === "CLD")?.starterKey).toBe("p1");
    expect(note).toBe(
      "Person 1: away 13:30–14:30, 18:30–19:00. They're away when TWR opens — pick a new starter. " +
        "2 of their duties fall in that time — generate again, or reassign them.",
    );
  });

  it("goes back to all night", () => {
    const base = night({
      people: [{ ...team(1)[0], availability: { mode: "only", periods: [[0, 240]] } }],
      channels: [channel("TWR")],
    });
    const { state, note } = setPersonAvailability(base, "p1", null);
    expect(state.people[0].availability).toBeNull();
    expect(note).toBe("Person 1 is around all night.");
  });
});

describe("DB slots and the page's own switches", () => {
  it("won't merge CLD away from under a DB slot", () => {
    const base = night({
      people: team(4),
      channels: [channel("TWR"), channel("SMC-S"), channel("CLD")],
      duties: [dbSlot("CLD", "p1", 360, 420)],
    });
    const { state, note } = setMergeSmcCld(base, true);
    expect(state).toBe(base);
    expect(note).toContain("CLD has a DB slot 19:30–20:30, so it can't be merged");
  });

  it("says so when unticking a position takes its DB slot with it", () => {
    const base = night({
      people: team(4),
      channels: [channel("TWR"), channel("CLD")],
      duties: [dbSlot("TWR", "p1", 240, 360)],
    });
    const { state, note } = setChannelInUse(base, "TWR", false);
    expect(state.duties).toEqual([]);
    expect(note).toBe("TWR not needed tonight. Removed its 1 duty. That included its DB slot.");
  });

  it("removes a slot from the DB panel", () => {
    const base = night({ people: team(2), channels: [channel("TWR")], duties: [dbSlot("TWR", "p1", 240, 360)] });
    const { state, note } = removeDbSlot(base, base.duties[0].id);
    expect(state.duties).toEqual([]);
    expect(note).toBe("DB slot on TWR 17:30–19:30 removed.");
  });
});
