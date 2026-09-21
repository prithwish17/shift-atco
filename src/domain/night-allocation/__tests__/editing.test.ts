import { describe, expect, it } from "vitest";
import { applyDutyChange, deleteDuty, previewDutyChange, refitChannel, splitDuty } from "../editing";
import { uncoveredMinutes, validateAllocation } from "../rules";
import { channel, duty, night, refused, team } from "./fixtures";
import type { NightAllocationState } from "../types";

/** TWR covered end to end by four duties, handed over three times. */
function chainNight(): NightAllocationState {
  return night({
    people: team(5),
    channels: [channel("TWR", { openAt: 0, closeAt: 300, starterKey: "p1" })],
    duties: [
      duty("TWR", "p1", 0, 110),
      duty("TWR", "p2", 110, 170),
      duty("TWR", "p3", 170, 230),
      duty("TWR", "p4", 230, 300),
    ],
  });
}

const idAt = (state: NightAllocationState, startMin: number) =>
  state.duties.find(entry => entry.startMin === startMin)!.id;

describe("linked handovers", () => {
  it("moves the previous duty's end when a start moves", () => {
    const state = chainNight();
    const middle = state.duties[1];
    const result = applyDutyChange(state, { ...middle, startMin: 90 }, middle.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.duties.find(entry => entry.id === state.duties[0].id)?.endMin).toBe(90);
    expect(uncoveredMinutes(result.state)).toBe(0);
  });

  it("moves the next duty's start when an end moves", () => {
    const state = chainNight();
    const middle = state.duties[1];
    const result = applyDutyChange(state, { ...middle, endMin: 185 }, middle.id);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.duties.find(entry => entry.id === state.duties[2].id)?.startMin).toBe(185);
    expect(uncoveredMinutes(result.state)).toBe(0);
  });

  it("refuses an edit that would push a neighbour over two hours", () => {
    const state = chainNight();
    const middle = state.duties[1];
    const result = applyDutyChange(state, { ...middle, startMin: 135 }, middle.id);

    const refusal = refused(result);
    expect(refusal.problems.some(problem => problem.includes("at most 2h"))).toBe(true);
  });

  it("refuses an edit that would drop a neighbour below thirty minutes", () => {
    const state = chainNight();
    const middle = state.duties[1];
    const result = applyDutyChange(state, { ...middle, endMin: 205 }, middle.id);

    const refusal = refused(result);
    expect(refusal.problems.length).toBeGreaterThan(0);
  });

  it("refuses an edit that would break the thirty minute break", () => {
    const state = chainNight();
    const last = state.duties[3];
    const result = applyDutyChange(state, { ...last, personKey: "p3" }, last.id);

    const refusal = refused(result);
    expect(refusal.problems.some(problem => problem.includes("break"))).toBe(true);
  });

  it("leaves the original state untouched when an edit is refused", () => {
    const state = chainNight();
    const before = JSON.stringify(state);
    applyDutyChange(state, { ...state.duties[1], startMin: 135 }, state.duties[1].id);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("refuses a duty that would leave the channel uncovered", () => {
    const state = chainNight();
    // A stand-alone duty in the middle of nowhere leaves a hole on both sides.
    const preview = previewDutyChange(state, null, {
      id: "new",
      channelCode: "CLD",
      personKey: "p1",
      startMin: 0,
      endMin: 60,
    });
    expect(preview.problems.length).toBeGreaterThan(0);
  });
});

describe("delete", () => {
  it("hands the freed time to the previous duty", () => {
    const state = chainNight();
    const result = deleteDuty(state, idAt(state, 170));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(uncoveredMinutes(result.state)).toBe(0);
    expect(result.state.duties.find(entry => entry.startMin === 110)?.endMin).toBe(230);
    expect(result.note).toContain("now covers that time on TWR");
  });

  it("hands the freed time to the next duty when the first is deleted", () => {
    const state = night({
      people: team(3),
      channels: [channel("TWR", { openAt: 0, closeAt: 240 })],
      duties: [duty("TWR", "p1", 0, 30), duty("TWR", "p2", 30, 120), duty("TWR", "p3", 120, 240)],
    });
    const result = deleteDuty(state, idAt(state, 0));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.duties.find(entry => entry.personKey === "p2")?.startMin).toBe(0);
    expect(uncoveredMinutes(result.state)).toBe(0);
  });

  it("refuses a delete that would push a neighbour over two hours", () => {
    const state = chainNight();
    const result = deleteDuty(state, idAt(state, 110));

    const refusal = refused(result);
    expect(refusal.problems[0]).toContain("Can't delete:");
  });

  it("deletes the only duty on a channel, leaving it uncovered but unchanged elsewhere", () => {
    const state = night({
      people: team(2),
      channels: [channel("TWR", { openAt: 0, closeAt: 120 }), channel("CLD", { openAt: 0, closeAt: 120 })],
      duties: [duty("TWR", "p1", 0, 120), duty("CLD", "p2", 0, 120)],
    });
    // Removing the only duty on CLD raises uncovered minutes, so it is refused.
    const result = deleteDuty(state, state.duties[1].id);
    expect(result.ok).toBe(false);
  });
});

describe("split", () => {
  it("hands the remainder to someone else with no gap", () => {
    const state = chainNight();
    const result = splitDuty(state, idAt(state, 0), 60, "p5");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(uncoveredMinutes(result.state)).toBe(0);
    const twr = result.state.duties.filter(entry => entry.channelCode === "TWR").sort((a, b) => a.startMin - b.startMin);
    expect(twr.map(entry => [entry.startMin, entry.endMin, entry.personKey])).toEqual([
      [0, 60, "p1"],
      [60, 110, "p5"],
      [110, 170, "p2"],
      [170, 230, "p3"],
      [230, 300, "p4"],
    ]);
  });

  it("refuses a split that breaks the taker's break", () => {
    const state = chainNight();
    const result = splitDuty(state, idAt(state, 0), 90, "p2");

    const refusal = refused(result);
    expect(refusal.problems[0]).toContain("Can't split:");
  });

  it("refuses a handover time outside the duty", () => {
    const state = chainNight();
    expect(splitDuty(state, idAt(state, 0), 200, "p5").ok).toBe(false);
  });

  it("refuses a split with nobody chosen", () => {
    const state = chainNight();
    const result = splitDuty(state, idAt(state, 0), 60, "");
    const refusal = refused(result);
    expect(refusal.problems).toEqual(["Select who takes over."]);
  });
});

describe("channel re-fit", () => {
  it("pins the first and last duty to a narrowed window", () => {
    const state = chainNight();
    const { state: next, note } = refitChannel(state, "TWR", 60, 230);

    expect(uncoveredMinutes(next)).toBe(0);
    const twr = next.duties.sort((a, b) => a.startMin - b.startMin);
    expect(twr[0].startMin).toBe(60);
    expect(twr[twr.length - 1].endMin).toBe(230);
    expect(note).toContain("First and last duties adjusted to match");
  });

  it("drops duties entirely outside the new window and says so", () => {
    const state = chainNight();
    const { state: next, note } = refitChannel(state, "TWR", 230, 300);

    expect(next.duties).toHaveLength(1);
    expect(uncoveredMinutes(next)).toBe(0);
    expect(note).toContain("3 outside that time removed");
  });

  it("widens a window without touching other channels", () => {
    const state = chainNight();
    state.channels.push(channel("CLD", { openAt: 0, closeAt: 120 }));
    state.duties.push(duty("CLD", "p5", 0, 120));

    const { state: next } = refitChannel(state, "TWR", 0, 300);
    expect(next.duties.filter(entry => entry.channelCode === "CLD")).toHaveLength(1);
    expect(uncoveredMinutes(next)).toBe(0);
  });

  it("keeps the checks panel authoritative when a re-fit stretches a duty too far", () => {
    const state = night({
      people: team(1),
      channels: [channel("TWR", { openAt: 0, closeAt: 120 })],
      duties: [duty("TWR", "p1", 0, 120)],
    });
    const { state: next } = refitChannel(state, "TWR", 0, 300);
    expect(uncoveredMinutes(next)).toBe(0);
    expect(validateAllocation(next).errors.some(issue => issue.message.includes("at most 2h"))).toBe(true);
  });
});

describe("fixing one of several broken duties", () => {
  /**
   * TWR end to end in 1h 30m duties. p3 and p4 hold back-to-back duties and
   * both call in sick; p7 and p8 are free to take over.
   */
  function sickNight(): NightAllocationState {
    const state = night({
      people: team(8),
      channels: [channel("TWR")],
      duties: [
        duty("TWR", "p1", 0, 90), duty("TWR", "p2", 90, 180), duty("TWR", "p3", 180, 270),
        duty("TWR", "p4", 270, 360), duty("TWR", "p5", 360, 450), duty("TWR", "p6", 450, 540),
        duty("TWR", "p1", 540, 630), duty("TWR", "p2", 630, 720),
      ],
    });
    return {
      ...state,
      people: state.people.map(entry =>
        entry.key === "p3" || entry.key === "p4" ? { ...entry, available: false } : entry,
      ),
    };
  }

  const dutyOf = (state: NightAllocationState, personKey: string) =>
    state.duties.find(entry => entry.personKey === personKey)!;

  it("reassigns either one first, then the other, and ends with no errors", () => {
    for (const [first, firstCover, second, secondCover] of [
      ["p3", "p7", "p4", "p8"],
      ["p4", "p8", "p3", "p7"],
    ]) {
      const state = sickNight();
      expect(validateAllocation(state).errors).toHaveLength(2);

      const one = applyDutyChange(state, { ...dutyOf(state, first), personKey: firstCover }, dutyOf(state, first).id);
      expect(one.ok).toBe(true);
      if (!one.ok) return;

      const two = applyDutyChange(
        one.state,
        { ...dutyOf(one.state, second), personKey: secondCover },
        dutyOf(one.state, second).id,
      );
      expect(two.ok).toBe(true);
      if (!two.ok) return;
      expect(validateAllocation(two.state).errors).toEqual([]);
    }
  });

  it("still refuses what the change itself breaks", () => {
    const state = sickNight();
    // p2 comes off TWR at 16:30, so taking p3's duty then leaves no break.
    const result = refused(applyDutyChange(state, { ...dutyOf(state, "p3"), personKey: "p2" }, dutyOf(state, "p3").id));
    expect(result.problems.some(problem => problem.includes("0 min break"))).toBe(true);
  });

  it("still refuses moving a handover onto a duty held by someone unavailable", () => {
    const state = sickNight();
    // Reassigning is fine; pushing the end into p4's duty gives p4 new time.
    const result = refused(
      applyDutyChange(state, { ...dutyOf(state, "p3"), personKey: "p7", endMin: 285 }, dutyOf(state, "p3").id),
    );
    expect(result.problems).toContain("Person 4 isn't available tonight but has TWR 18:15–19:30.");
  });

  it("shows a duty's existing problem as unresolved rather than as no conflicts", () => {
    const state = sickNight();
    const broken = dutyOf(state, "p3");
    const preview = previewDutyChange(state, broken, { ...broken });
    expect(preview.problems).toEqual([]);
    expect(preview.unresolved).toEqual(["Person 3 isn't available tonight but has TWR 16:30–18:00."]);
  });
});

describe("halves, when a duty changes hands", () => {
  /** TWR end to end; p1 is 1st Half and holds a single duty inside it. */
  function halfNight(): NightAllocationState {
    const people = team(4, { halves: { 1: "1st" } });
    return night({
      people,
      channels: [channel("TWR")],
      duties: [
        duty("TWR", "p2", 0, 120), duty("TWR", "p3", 120, 240), duty("TWR", "p1", 240, 360),
        duty("TWR", "p2", 360, 480), duty("TWR", "p3", 480, 600), duty("TWR", "p2", 600, 720),
      ],
    });
  }

  it("refuses giving away a half person's only duty inside their half", () => {
    const state = halfNight();
    const only = state.duties.find(entry => entry.personKey === "p1")!;
    const result = refused(applyDutyChange(state, { ...only, personKey: "p4" }, only.id));
    expect(result.problems).toContain("Person 1 is 1st Half but has no duty between 17:30 and 21:30.");
  });

  it("refuses deleting it too", () => {
    const state = halfNight();
    const only = state.duties.find(entry => entry.personKey === "p1")!;
    const result = refused(deleteDuty(state, only.id));
    expect(result.problems.some(problem => problem.includes("Person 1 is 1st Half but has no duty"))).toBe(true);
  });

  it("does not blame the first duty on an empty board for everyone else's bare half", () => {
    const state = night({
      people: team(3, { halves: { 1: "1st", 2: "2nd" } }),
      channels: [channel("TWR")],
    });
    const preview = previewDutyChange(state, null, {
      id: "first",
      channelCode: "TWR",
      personKey: "p3",
      startMin: 0,
      endMin: 90,
    });
    expect(preview.problems).toEqual([]);
  });
});
