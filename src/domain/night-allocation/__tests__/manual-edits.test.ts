import { describe, expect, it } from "vitest";
import {
  applyDutyChange,
  deleteDuty,
  describeMove,
  fillBlank,
  leaveBlank,
  previewDutyChange,
  refitChannel,
  reviewChange,
  swapCandidates,
  swapPeople,
} from "../editing";
import { blankMinutes, isBlank, uncoveredMinutes, validateAllocation } from "../rules";
import { accepted, blank, channel, dbSlot, duty, messages, night, refused, team } from "./fixtures";
import type { NightAllocationState, NightDuty } from "../types";

/** TWR and SMC-S, both covered 13:30–18:30, one duty each for six people. */
function twoPositions(overrides: Partial<NightAllocationState> = {}): NightAllocationState {
  return night({
    people: team(6),
    channels: [channel("TWR", { openAt: 0, closeAt: 300 }), channel("SMC-S", { openAt: 0, closeAt: 300 })],
    duties: [
      duty("TWR", "p1", 0, 90),
      duty("TWR", "p2", 90, 180),
      duty("TWR", "p3", 180, 300),
      duty("SMC-S", "p4", 0, 90),
      duty("SMC-S", "p5", 90, 180),
      duty("SMC-S", "p6", 180, 300),
    ],
    ...overrides,
  });
}

const find = (state: NightAllocationState, channelCode: string, startMin: number): NightDuty =>
  state.duties.find(entry => entry.channelCode === channelCode && entry.startMin === startMin)!;
const blanksOf = (state: NightAllocationState) =>
  state.duties.filter(isBlank).map(entry => `${entry.channelCode} ${entry.startMin}-${entry.endMin}`);
const holder = (state: NightAllocationState, channelCode: string, startMin: number) =>
  find(state, channelCode, startMin)?.personKey;

describe("blanks in the rules", () => {
  it("counts a blank as covered, and lists it first among the suggestions", () => {
    const state = twoPositions();
    state.duties[1] = blank("TWR", 90, 180);

    const { errors, warnings } = validateAllocation(state);
    expect(messages(errors)).toEqual([]);
    expect(uncoveredMinutes(state)).toBe(0);
    expect(blankMinutes(state)).toBe(90);
    expect(warnings[0].message).toBe(
      "TWR 15:00–16:30 is left blank — nobody is on it. Tap it on the board to put someone on.",
    );
    expect(warnings[0].dutyIds).toEqual([state.duties[1].id]);
  });

  it("never reads a blank as somebody's duty", () => {
    // Two blanks at the same time would be one person on two positions if the
    // empty key were a person — and that person would be "removed".
    const state = twoPositions();
    state.duties[1] = blank("TWR", 90, 180);
    state.duties[4] = blank("SMC-S", 90, 180);
    expect(messages(validateAllocation(state).errors)).toEqual([]);
  });

  it("still keeps a blank to its position's place on the board", () => {
    const unused = twoPositions({
      channels: [
        channel("TWR", { openAt: 0, closeAt: 300 }),
        channel("SMC-S", { openAt: 0, closeAt: 300 }),
        channel("CLD", { inUse: false }),
      ],
    });
    unused.duties.push(blank("CLD", 0, 60));
    expect(messages(validateAllocation(unused).errors)).toContain(
      "CLD isn't in use tonight, but has a blank 13:30–14:30.",
    );

    const outside = twoPositions();
    outside.duties[2] = duty("TWR", "p3", 180, 270);
    outside.duties.push(blank("TWR", 270, 330));
    expect(messages(validateAllocation(outside).errors)).toContain(
      "TWR is open 13:30–18:30, but a blank on it runs 18:00–19:00.",
    );

    const onTop = twoPositions();
    onTop.duties.push(blank("TWR", 60, 90));
    expect(messages(validateAllocation(onTop).errors)).toContain(
      "TWR is both blank and held by Person 1 from 14:30 to 15:00.",
    );
  });

  it("doesn't call a short blank a short duty", () => {
    const state = twoPositions();
    state.duties[1] = duty("TWR", "p2", 90, 150);
    state.duties.push(blank("TWR", 150, 180));
    const warnings = messages(validateAllocation(state).warnings);
    expect(warnings.some(message => message.includes("Under an hour"))).toBe(false);
  });
});

describe("leaving a duty blank", () => {
  it("takes the person off and keeps the stretch, handing nothing to a neighbour", () => {
    const state = twoPositions();
    const result = accepted(leaveBlank(state, find(state, "TWR", 90).id));

    expect(blanksOf(result.state)).toEqual(["TWR 90-180"]);
    expect(find(result.state, "TWR", 0).endMin).toBe(90);
    expect(find(result.state, "TWR", 180).startMin).toBe(180);
    expect(uncoveredMinutes(result.state)).toBe(0);
    expect(messages(validateAllocation(result.state).errors)).toEqual([]);
    expect(result.note).toBe("TWR 15:00–16:30 left blank — Person 2 is off it. Tap the blank to put someone on.");
  });

  it("leaves part of a duty blank, and the person keeps the rest either side", () => {
    const state = twoPositions();
    const result = accepted(leaveBlank(state, find(state, "TWR", 180).id, 210, 270));

    expect(blanksOf(result.state)).toEqual(["TWR 210-270"]);
    const mine = result.state.duties.filter(entry => entry.personKey === "p3").map(entry => [entry.startMin, entry.endMin]);
    expect(mine).toEqual(expect.arrayContaining([[180, 210], [270, 300]]));
    expect(result.note).toContain("keeps the rest of that duty");
  });

  it("refuses to leave a sliver too short to be a duty", () => {
    const state = twoPositions();
    const refusal = refused(leaveBlank(state, find(state, "TWR", 180).id, 195, 300));
    expect(refusal.problems[0]).toMatch(/^Can't leave it blank: .*at least 30 min/);
  });

  it("joins blanks side by side into one", () => {
    const state = twoPositions();
    const first = accepted(leaveBlank(state, find(state, "TWR", 90).id));
    const second = accepted(leaveBlank(first.state, find(first.state, "TWR", 180).id));
    expect(blanksOf(second.state)).toEqual(["TWR 90-300"]);
  });

  it("won't leave someone in a half with no duty in it", () => {
    const state = twoPositions({ people: team(6, { halves: { 3: "1st" } }) });
    const refusal = refused(leaveBlank(state, find(state, "TWR", 180).id));
    expect(refusal.problems[0]).toContain("Person 3 is 1st Half but has no duty between 17:30 and 21:30.");
  });

  it("never blanks a DB slot or a blank", () => {
    const state = twoPositions();
    state.duties[1] = dbSlot("TWR", "p2", 90, 180);
    expect(refused(leaveBlank(state, state.duties[1].id)).problems[0]).toContain("A DB slot can't be left blank");

    state.duties[4] = blank("SMC-S", 90, 180);
    expect(refused(leaveBlank(state, state.duties[4].id)).problems[0]).toBe("That stretch is already blank.");
  });
});

describe("filling a blank", () => {
  const withBlank = () => {
    const state = twoPositions();
    state.duties[1] = blank("TWR", 90, 180);
    return state;
  };

  it("puts someone on the whole of it", () => {
    const state = withBlank();
    const result = accepted(fillBlank(state, state.duties[1].id, "p2"));
    expect(blanksOf(result.state)).toEqual([]);
    expect(holder(result.state, "TWR", 90)).toBe("p2");
    expect(result.note).toBe("Person 2 on TWR 15:00–16:30.");
    expect(messages(validateAllocation(result.state).errors)).toEqual([]);
  });

  it("puts someone on part of it, and the rest stays blank", () => {
    const state = withBlank();
    const result = accepted(fillBlank(state, state.duties[1].id, "p2", 90, 150));
    expect(blanksOf(result.state)).toEqual(["TWR 150-180"]);
    expect(find(result.state, "TWR", 90)).toMatchObject({ personKey: "p2", endMin: 150 });
    expect(result.note).toContain("The rest stays blank.");
  });

  it("refuses a person the rules don't allow there", () => {
    // Person 1 comes off TWR at 15:00 — straight back on would be no break.
    const state = withBlank();
    const refusal = refused(fillBlank(state, state.duties[1].id, "p1"));
    expect(refusal.problems.some(problem => problem.includes("0 min break"))).toBe(true);
  });

  it("stays inside the blank", () => {
    const state = withBlank();
    const refusal = refused(fillBlank(state, state.duties[1].id, "p2", 60, 150));
    expect(refusal.problems).toEqual(["Pick a time inside the blank, 15:00–16:30."]);
  });

  it("is what a new duty over a blank does too", () => {
    const state = withBlank();
    const preview = previewDutyChange(state, null, {
      id: "new",
      channelCode: "TWR",
      personKey: "p2",
      startMin: 90,
      endMin: 180,
    });
    expect(preview.problems).toEqual([]);
    expect(preview.duties.some(isBlank)).toBe(false);
  });
});

describe("moving a duty to another position", () => {
  it("leaves the old stretch blank and takes the new one outright", () => {
    const state = twoPositions();
    const moving = find(state, "TWR", 90);
    const result = accepted(applyDutyChange(state, { ...moving, channelCode: "SMC-S" }, moving.id));

    expect(blanksOf(result.state)).toEqual(["TWR 90-180"]);
    expect(holder(result.state, "SMC-S", 90)).toBe("p2");
    expect(result.state.duties.some(entry => entry.personKey === "p5")).toBe(false);
    expect(uncoveredMinutes(result.state)).toBe(0);
    expect(messages(validateAllocation(result.state).errors)).toEqual([]);
    expect(result.note).toBe(
      "Person 2 moved to SMC-S 15:00–16:30. TWR 15:00–16:30 is blank now — tap it to put someone on.",
    );
  });

  it("cuts back whoever is on the new position only as far as it needs", () => {
    const state = twoPositions();
    const moving = find(state, "TWR", 0);
    const draft = { ...moving, channelCode: "SMC-S", endMin: 60 };

    expect(describeMove(state, moving, draft)).toEqual([
      "TWR 13:30–15:00 is left blank — tap it afterwards to put someone on.",
      "Person 4 comes off SMC-S 13:30–14:30 and keeps the rest of that duty.",
    ]);
    const result = accepted(applyDutyChange(state, draft, moving.id));
    expect(find(result.state, "SMC-S", 60)).toMatchObject({ personKey: "p4", endMin: 90 });
    expect(find(result.state, "SMC-S", 0)).toMatchObject({ personKey: "p1", endMin: 60 });
  });

  it("won't move a duty onto a DB slot", () => {
    const state = twoPositions();
    state.duties[4] = dbSlot("SMC-S", "p5", 90, 180);
    const moving = find(state, "TWR", 90);
    const preview = previewDutyChange(state, moving, { ...moving, channelCode: "SMC-S" });
    expect(preview.problems[0]).toBe(
      "SMC-S has a DB slot 15:00–16:30, and DB slots don't move. Pick a time outside it, or change the DB slot itself.",
    );
  });
});

describe("swapping two people", () => {
  it("exchanges the people on two duties at the same time", () => {
    const state = twoPositions();
    const twr = find(state, "TWR", 90);
    const smc = find(state, "SMC-S", 90);
    expect(swapCandidates(state, twr).map(entry => entry.id)).toEqual([smc.id]);

    const result = accepted(swapPeople(state, twr.id, smc.id));
    expect(holder(result.state, "TWR", 90)).toBe("p5");
    expect(holder(result.state, "SMC-S", 90)).toBe("p2");
    expect(result.note).toBe("Swapped. Person 2 is on SMC-S 15:00–16:30, and Person 5 on TWR 15:00–16:30.");
  });

  it("moves someone onto a blank and leaves their own stretch blank", () => {
    const state = twoPositions();
    state.duties[4] = blank("SMC-S", 90, 180);
    const result = accepted(swapPeople(state, find(state, "TWR", 90).id, state.duties[4].id));
    expect(holder(result.state, "SMC-S", 90)).toBe("p2");
    expect(blanksOf(result.state)).toEqual(["TWR 90-180"]);
    expect(result.note).toBe("Person 2 moved to SMC-S 15:00–16:30. TWR 15:00–16:30 is blank now.");
  });

  it("refuses a swap that breaks a rule", () => {
    // Person 1 would come off SMC-S at 16:30 and be back on it at once.
    const state = twoPositions();
    state.duties[5] = duty("SMC-S", "p1", 180, 300);
    const refusal = refused(swapPeople(state, find(state, "TWR", 0).id, find(state, "SMC-S", 90).id));
    expect(refusal.problems[0]).toMatch(/^Can't swap: .*0 min break/);
  });

  it("never swaps a DB slot", () => {
    const state = twoPositions();
    state.duties[4] = dbSlot("SMC-S", "p5", 90, 180);
    expect(swapCandidates(state, find(state, "TWR", 90))).toEqual([]);
    expect(refused(swapPeople(state, find(state, "TWR", 90).id, state.duties[4].id)).problems[0]).toContain(
      "DB slots don't swap",
    );
  });
});

describe("blanks beside the handover chain", () => {
  /** TWR 13:30–16:30: Person 1, a blank, Person 3. */
  const chain = () =>
    night({
      people: team(4),
      channels: [channel("TWR", { openAt: 0, closeAt: 180 })],
      duties: [duty("TWR", "p1", 0, 60), blank("TWR", 60, 90), duty("TWR", "p3", 90, 180)],
    });

  it("gives a deleted duty's time to the neighbour that isn't blank", () => {
    const state = night({
      people: team(4),
      channels: [channel("TWR", { openAt: 0, closeAt: 180 })],
      duties: [blank("TWR", 0, 60), duty("TWR", "p2", 60, 120), duty("TWR", "p3", 120, 180)],
    });
    const result = accepted(deleteDuty(state, state.duties[1].id));
    expect(find(result.state, "TWR", 60)).toMatchObject({ personKey: "p3", endMin: 180 });
    expect(blanksOf(result.state)).toEqual(["TWR 0-60"]);
    expect(result.note).toBe("Duty deleted. Person 3 now covers that time on TWR.");
  });

  it("removes a blank by giving its time to the duty before it", () => {
    const state = chain();
    const result = accepted(deleteDuty(state, state.duties[1].id));
    expect(blanksOf(result.state)).toEqual([]);
    expect(find(result.state, "TWR", 0).endMin).toBe(90);
    expect(result.note).toBe("Blank removed. Person 1 now covers that time on TWR.");
  });

  it("grows a blank when the duty beside it gets shorter, and fills it when it gets longer", () => {
    const state = chain();
    const first = state.duties[0];

    const shorter = accepted(applyDutyChange(state, { ...first, endMin: 45 }, first.id));
    expect(blanksOf(shorter.state)).toEqual(["TWR 45-90"]);

    const longer = accepted(applyDutyChange(state, { ...first, endMin: 90 }, first.id));
    expect(blanksOf(longer.state)).toEqual([]);
    expect(uncoveredMinutes(longer.state)).toBe(0);
  });

  it("never stretches a blank to new hours", () => {
    const state = night({
      people: team(4),
      channels: [channel("TWR", { openAt: 60, closeAt: 300 })],
      duties: [blank("TWR", 60, 90), duty("TWR", "p2", 90, 180), duty("TWR", "p3", 180, 300)],
    });
    const earlier = refitChannel(state, "TWR", 0, 300);
    expect(blanksOf(earlier.state)).toEqual(["TWR 60-90"]);
    expect(uncoveredMinutes(earlier.state)).toBe(60);
  });
});

describe("the evening rest, while editing", () => {
  it("says when a change costs someone their rest, without refusing it", () => {
    // TWR 16:30–22:30 in three 2h duties: everyone has 4 hours off from 16:30.
    const state = night({
      people: team(3),
      channels: [channel("TWR", { openAt: 180, closeAt: 540 })],
      duties: [duty("TWR", "p1", 180, 300), duty("TWR", "p2", 300, 420), duty("TWR", "p3", 420, 540)],
    });
    const last = state.duties[2];
    const draft = { ...last, personKey: "p1" };

    const review = reviewChange(state, previewDutyChange(state, last, draft).duties, [last.id]);
    expect(review.problems).toEqual([]);
    expect(review.preferences).toEqual([
      "Person 1 would have no 4h break starting between 16:30 and 23:30 (longest 3h, 22:30–01:30). " +
        "Preferred, not required.",
    ]);
    expect(applyDutyChange(state, draft, last.id).ok).toBe(true);
  });
});
