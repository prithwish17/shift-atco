import { describe, expect, it } from "vitest";
import { validateAllocation } from "@/domain/night-allocation";
import { channel, night, team } from "@/domain/night-allocation/__tests__/fixtures";
import { mergeToggle, setChannelInUse, setMergeSmcCld } from "../stateActions";

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
