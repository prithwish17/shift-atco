import { describe, expect, it } from "vitest";
import { channel, duty, night, team } from "@/domain/night-allocation/__tests__/fixtures";
import { shareGate } from "../shareGate";

const planned = (version: number) =>
  night({
    version,
    people: team(1),
    channels: [channel("TWR", { closeAt: 120 })],
    duties: [duty("TWR", "p1", 0, 120)],
  });

describe("what the share sheet offers", () => {
  it("offers nothing for a board with nobody on it, even though it breaks no rule", () => {
    const gate = shareGate(night({ version: 3, people: team(1), channels: [channel("TWR")] }), {
      dirty: false,
      errorCount: 0,
    });
    expect(gate.blocked).toMatch(/Nothing is allocated yet/);
  });

  it("offers nothing while a hard rule is broken", () => {
    expect(shareGate(planned(3), { dirty: false, errorCount: 2 }).blocked).toMatch(/^2 problems still to fix/);
  });

  it("holds email back until the night has been saved", () => {
    const gate = shareGate(planned(0), { dirty: true, errorCount: 0 });
    expect(gate.blocked).toBeNull();
    expect(gate.notice).toMatch(/hasn't been saved yet/);
    expect(gate.emailBlocked).toMatch(/Save the night first/);
  });

  it("holds email back while there are unsaved changes, and says it has been saved before", () => {
    const gate = shareGate(planned(4), { dirty: true, errorCount: 0 });
    expect(gate.notice).toMatch(/unsaved changes/);
    expect(gate.notice).not.toMatch(/hasn't been saved yet/);
    expect(gate.emailBlocked).toMatch(/attachments must match/);
  });

  it("offers everything for a saved night with no changes since", () => {
    expect(shareGate(planned(4), { dirty: false, errorCount: 0 })).toEqual({
      blocked: null,
      notice: null,
      emailBlocked: null,
    });
  });
});
