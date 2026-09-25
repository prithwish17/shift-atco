import { describe, expect, it } from "vitest";
import {
  dutyLengthRank,
  fixedDutyErrors,
  inBoardOrder,
  isPlanned,
  personShortLabel,
  shortStretchNotices,
  staffingNotices,
  uncoveredMinutes,
  validateAllocation,
} from "../rules";
import { channel, dbSlot, duty, messages, night, person, team } from "./fixtures";

/** A night nobody could fault: one channel, two people, continuous cover. */
function simpleNight(overrides: Parameters<typeof night>[0] = {}) {
  const people = team(2);
  return night({
    people,
    channels: [channel("TWR", { starterKey: "p1" })],
    duties: [duty("TWR", "p1", 0, 120), duty("TWR", "p2", 120, 240), duty("TWR", "p1", 240, 360),
      duty("TWR", "p2", 360, 480), duty("TWR", "p1", 480, 600), duty("TWR", "p2", 600, 720)],
    ...overrides,
  });
}

const errorsOf = (state: ReturnType<typeof night>) => messages(validateAllocation(state).errors);

describe("hard rules", () => {
  it("passes a continuous, legal night", () => {
    expect(errorsOf(simpleNight())).toEqual([]);
  });

  it("requires at least one channel in use", () => {
    const state = night({ people: team(2), channels: [channel("TWR", { inUse: false })] });
    expect(errorsOf(state)).toContain("Turn on at least one channel.");
  });

  describe("continuity", () => {
    it("reports an uncovered stretch on an open channel", () => {
      const state = simpleNight();
      state.duties = state.duties.filter(entry => entry.startMin !== 240);
      const errors = errorsOf(state);
      expect(errors.some(message => message.includes("TWR has no one on duty 17:30–19:30"))).toBe(true);
      expect(uncoveredMinutes(state)).toBe(120);
    });

    it("counts a night with no duties as unplanned rather than uncovered", () => {
      const state = night({ people: team(2), channels: [channel("TWR")], duties: [] });
      expect(errorsOf(state).some(message => message.includes("no one on duty"))).toBe(false);
    });

    it("leaves a closed channel out of the continuity check", () => {
      const state = night({
        people: team(1),
        channels: [channel("TWR"), channel("SMC-S", { inUse: false })],
        duties: [duty("TWR", "p1", 0, 120)],
      });
      expect(errorsOf(state).some(message => message.startsWith("SMC-S has no one"))).toBe(false);
    });
  });

  describe("double booking", () => {
    it("rejects two people on one channel at the same time", () => {
      const state = night({
        people: team(2),
        channels: [channel("TWR", { openAt: 0, closeAt: 120 })],
        duties: [duty("TWR", "p1", 0, 120), duty("TWR", "p2", 60, 120)],
      });
      expect(errorsOf(state).some(message => message.includes("TWR has two people from 14:30 to 15:30"))).toBe(true);
    });

    it("rejects one person on two channels at the same time", () => {
      const state = night({
        people: team(2),
        channels: [channel("TWR", { openAt: 0, closeAt: 120 }), channel("CLD", { openAt: 0, closeAt: 120 })],
        duties: [duty("TWR", "p1", 0, 120), duty("CLD", "p1", 0, 120)],
      });
      expect(errorsOf(state).some(message => message.includes("is on TWR and CLD at the same time"))).toBe(true);
    });
  });

  describe("duty length", () => {
    it("rejects a duty over two hours", () => {
      const state = night({
        people: team(1),
        channels: [channel("TWR", { openAt: 0, closeAt: 135 })],
        duties: [duty("TWR", "p1", 0, 135)],
      });
      expect(errorsOf(state).some(message => message.includes("A duty can be at most 2h"))).toBe(true);
    });

    it("rejects a duty under thirty minutes", () => {
      const state = night({
        people: team(2),
        channels: [channel("TWR", { openAt: 0, closeAt: 135 })],
        duties: [duty("TWR", "p1", 0, 120), duty("TWR", "p2", 120, 135)],
      });
      expect(errorsOf(state).some(message => message.includes("A duty must be at least 30 min"))).toBe(true);
    });

    it("lets TSO run past two hours, because it has no cap", () => {
      const state = night({
        people: team(1, { tso: [1] }),
        channels: [channel("TSO", { openAt: 0, closeAt: 720 })],
        duties: [duty("TSO", "p1", 0, 720)],
      });
      expect(errorsOf(state)).toEqual([]);
    });

    it("still caps every other position at two hours", () => {
      const state = night({
        people: team(1),
        channels: [channel("TWR", { openAt: 0, closeAt: 135 })],
        duties: [duty("TWR", "p1", 0, 135)],
      });
      expect(errorsOf(state).some(message => message.includes("at most 2h"))).toBe(true);
    });

    it("accepts exactly thirty minutes and exactly two hours", () => {
      const state = night({
        people: team(2),
        channels: [channel("TWR", { openAt: 0, closeAt: 150 })],
        duties: [duty("TWR", "p1", 0, 120), duty("TWR", "p2", 120, 150)],
      });
      expect(errorsOf(state)).toEqual([]);
    });
  });

  describe("breaks", () => {
    it("rejects a break shorter than thirty minutes", () => {
      const state = night({
        people: team(2),
        channels: [channel("TWR", { openAt: 0, closeAt: 180 })],
        duties: [duty("TWR", "p1", 0, 60), duty("TWR", "p2", 60, 75), duty("TWR", "p1", 75, 180)],
      });
      expect(errorsOf(state).some(message => message.includes("15 min break"))).toBe(true);
    });

    it("applies the break rule across midnight", () => {
      // 00:45–01:30 follows 23:30–00:30 with only 15 minutes between them.
      const state = night({
        people: team(2),
        channels: [channel("TWR", { openAt: 600, closeAt: 720 }), channel("CLD", { openAt: 600, closeAt: 720 })],
        duties: [duty("TWR", "p1", 600, 660), duty("CLD", "p1", 675, 720), duty("TWR", "p2", 660, 720), duty("CLD", "p2", 600, 675)],
      });
      expect(errorsOf(state).some(message => message.includes("15 min break"))).toBe(true);
    });

    it("accepts exactly thirty minutes of break", () => {
      const state = night({
        people: team(2),
        channels: [channel("TWR", { openAt: 0, closeAt: 180 })],
        duties: [duty("TWR", "p1", 0, 60), duty("TWR", "p2", 60, 90), duty("TWR", "p1", 90, 180)],
      });
      expect(errorsOf(state)).toEqual([]);
    });
  });

  describe("halves", () => {
    it("keeps a 1st Half person out of the 2nd Half", () => {
      const people = team(2, { halves: { 1: "1st" } });
      const state = night({
        people,
        channels: [channel("TWR")],
        duties: [duty("TWR", "p2", 0, 120), duty("TWR", "p1", 120, 240), duty("TWR", "p2", 240, 360),
          duty("TWR", "p1", 360, 480), duty("TWR", "p2", 480, 600), duty("TWR", "p1", 600, 720)],
      });
      expect(errorsOf(state).some(message => message.includes("is 1st Half and can't take TWR 23:30–01:30"))).toBe(true);
    });

    it("keeps a 2nd Half person out of the 1st Half", () => {
      const people = team(2, { halves: { 1: "2nd" } });
      const state = night({
        people,
        channels: [channel("TWR")],
        duties: [duty("TWR", "p2", 0, 240), duty("TWR", "p1", 240, 360), duty("TWR", "p2", 360, 480),
          duty("TWR", "p1", 480, 600), duty("TWR", "p2", 600, 720)],
      });
      expect(errorsOf(state).some(message => message.includes("is 2nd Half and can't take TWR 17:30–19:30"))).toBe(true);
    });

    it("requires everyone in a half to hold a duty inside it", () => {
      const people = team(3, { halves: { 3: "2nd" } });
      const state = night({
        people,
        channels: [channel("TWR")],
        duties: [duty("TWR", "p1", 0, 120), duty("TWR", "p2", 120, 240), duty("TWR", "p1", 240, 360),
          duty("TWR", "p2", 360, 480), duty("TWR", "p1", 480, 600), duty("TWR", "p2", 600, 720)],
      });
      expect(errorsOf(state).some(message => message.includes("is 2nd Half but has no duty between 21:30 and 01:30"))).toBe(true);
    });

    it("lets a 1st Half person cover TSO inside the 2nd Half", () => {
      // The one exception to the halves being exclusive.
      const people = team(2, { tso: [1], halves: { 1: "1st" } });
      const state = night({
        people,
        channels: [channel("TSO", { openAt: 0, closeAt: 720 })],
        duties: [
          duty("TSO", "p1", 0, 120),
          duty("TSO", "p2", 120, 240),
          duty("TSO", "p1", 240, 360),
          duty("TSO", "p2", 360, 480),
          duty("TSO", "p1", 480, 600),
          duty("TSO", "p2", 600, 720),
        ],
      });
      expect(errorsOf(state).some(message => message.includes("is 1st Half and can't take"))).toBe(false);
    });

    it("still refuses a 1st Half person on any other position in the 2nd Half", () => {
      const people = team(2, { halves: { 1: "1st" } });
      const state = night({
        people,
        channels: [channel("TWR")],
        duties: [
          duty("TWR", "p2", 0, 120),
          duty("TWR", "p1", 120, 240),
          duty("TWR", "p2", 240, 360),
          duty("TWR", "p1", 360, 480),
          duty("TWR", "p2", 480, 600),
          duty("TWR", "p1", 600, 720),
        ],
      });
      expect(errorsOf(state).some(message => message.includes("is 1st Half and can't take TWR 23:30–01:30"))).toBe(true);
    });

    it("does not let the exception run the other way", () => {
      // A 2nd Half person has no licence to take TSO in the 1st Half.
      const people = team(2, { tso: [1, 2], halves: { 1: "2nd" } });
      const state = night({
        people,
        channels: [channel("TSO", { openAt: 240, closeAt: 480 })],
        duties: [duty("TSO", "p1", 240, 360), duty("TSO", "p2", 360, 480)],
      });
      expect(errorsOf(state).some(message => message.includes("is 2nd Half and can't take TSO"))).toBe(true);
    });

    it("flags a crossover as a suggestion so it is never silent", () => {
      const people = team(2, { tso: [1], halves: { 1: "1st" } });
      const state = night({
        people,
        channels: [channel("TSO", { openAt: 0, closeAt: 720 })],
        duties: [
          duty("TSO", "p1", 0, 120),
          duty("TSO", "p2", 120, 240),
          duty("TSO", "p1", 240, 360),
          duty("TSO", "p2", 360, 480),
          duty("TSO", "p1", 480, 600),
          duty("TSO", "p2", 600, 720),
        ],
      });
      const warnings = messages(validateAllocation(state).warnings);
      expect(warnings.some(message => message.includes("is covering TSO"))).toBe(true);
      expect(warnings.some(message => message.includes("only when the night can't be covered without it"))).toBe(true);
    });

    it("treats a night with nobody in either half as valid", () => {
      expect(errorsOf(simpleNight())).toEqual([]);
    });

    it("rejects a half person who is not available", () => {
      const people = team(2, { halves: { 2: "1st" } });
      people[1].available = false;
      const state = night({ people, channels: [channel("TWR", { inUse: false }), channel("CLD")] , duties: [] });
      expect(errorsOf(state).some(message => message.includes("is 1st Half but isn't available tonight"))).toBe(true);
    });
  });

  describe("TSO qualification", () => {
    it("rejects an unqualified person on TSO", () => {
      const state = night({
        people: team(1),
        channels: [channel("TSO", { openAt: 0, closeAt: 120 })],
        duties: [duty("TSO", "p1", 0, 120)],
      });
      expect(errorsOf(state).some(message => message.includes("isn't marked as able to take TSO but has it"))).toBe(true);
    });

    it("accepts a qualified person on TSO", () => {
      const state = night({
        people: team(1, { tso: [1] }),
        channels: [channel("TSO", { openAt: 0, closeAt: 120 })],
        duties: [duty("TSO", "p1", 0, 120)],
      });
      expect(errorsOf(state)).toEqual([]);
    });

    it("rejects an unqualified starter for TSO", () => {
      const state = night({
        people: team(1),
        channels: [channel("TSO", { openAt: 0, closeAt: 120, starterKey: "p1" })],
        duties: [],
      });
      expect(errorsOf(state).some(message => message.includes("so can't start it"))).toBe(true);
    });
  });

  describe("availability", () => {
    it("rejects a duty held by someone not available", () => {
      const people = team(2);
      people[1].available = false;
      const state = night({
        people,
        channels: [channel("TWR", { openAt: 0, closeAt: 120 })],
        duties: [duty("TWR", "p2", 0, 120)],
      });
      expect(errorsOf(state).some(message => message.includes("isn't available tonight but has TWR"))).toBe(true);
    });
  });

  describe("channel windows", () => {
    it("rejects a duty outside the channel's open time", () => {
      const state = night({
        people: team(1),
        channels: [channel("TWR", { openAt: 60, closeAt: 180 })],
        duties: [duty("TWR", "p1", 0, 180)],
      });
      expect(errorsOf(state).some(message => message.includes("is open 14:30–16:30, but"))).toBe(true);
    });

    it("rejects a channel open for under thirty minutes", () => {
      const state = night({ people: team(1), channels: [channel("TWR", { openAt: 0, closeAt: 15 })] });
      expect(errorsOf(state)).toContain("TWR must be open for at least 30 min.");
    });

    it("rejects a channel closing before it opens", () => {
      const state = night({ people: team(1), channels: [channel("TWR", { openAt: 300, closeAt: 120 })] });
      expect(errorsOf(state)).toContain("TWR: closing time must be after opening time.");
    });

    it("rejects a duty on a channel that is not in use", () => {
      const state = night({
        people: team(1),
        channels: [channel("TWR"), channel("CLD", { inUse: false })],
        duties: [duty("CLD", "p1", 0, 120), duty("TWR", "p1", 150, 270)],
      });
      expect(errorsOf(state).some(message => message.includes("CLD isn't in use tonight"))).toBe(true);
    });
  });
});

describe("staffing notices", () => {
  it("explains a window that cannot be covered continuously", () => {
    // Four capped positions need five people between them, and TSO ties up one
    // more — six in all, against five available.
    const state = night({
      people: team(5, { tso: [1, 2] }),
      channels: ["TWR", "SMC-S", "SMC-N", "CLD", "TSO"].map(code => channel(code)),
    });
    const notices = staffingNotices(state);
    expect(notices.some(notice => notice.includes("5 open channels need at least 6"))).toBe(true);
  });

  it("counts an uncapped position as one person rather than by the 2h bound", () => {
    // Six people can do it: five for the capped positions, one holding TSO.
    const state = night({
      people: team(6, { tso: [1, 2] }),
      channels: ["TWR", "SMC-S", "SMC-N", "CLD", "TSO"].map(code => channel(code)),
    });
    expect(staffingNotices(state)).toEqual([]);
  });

  it("stays quiet when there are enough people", () => {
    const state = night({
      people: team(8, { tso: [1, 2, 3] }),
      channels: ["TWR", "SMC-S", "SMC-N", "CLD", "TSO"].map(code => channel(code)),
    });
    expect(staffingNotices(state)).toEqual([]);
  });

  it("accepts one qualified person, because TSO has no two-hour cap", () => {
    const state = night({
      people: team(9, { tso: [1] }),
      channels: ["TWR", "SMC-S", "TSO"].map(code => channel(code)),
    });
    expect(staffingNotices(state).some(notice => notice.startsWith("TSO"))).toBe(false);
  });

  it("flags TSO when nobody qualified can work a window", () => {
    // The only qualified person is 2nd Half, so nobody can take TSO earlier —
    // and the crossover licence runs 1st-to-2nd, not the other way.
    const state = night({
      people: team(9, { tso: [1], halves: { 1: "2nd" } }),
      channels: [channel("TWR"), channel("TSO", { openAt: 240, closeAt: 480 })],
    });
    expect(staffingNotices(state).some(notice => notice.includes("nobody who can take TSO is free"))).toBe(true);
  });

  it("flags TSO when nobody is qualified", () => {
    const state = night({ people: team(6), channels: [channel("TSO")] });
    expect(staffingNotices(state).some(notice => notice.includes("Nobody available tonight is marked as able to take TSO"))).toBe(true);
  });
});

describe("preferences", () => {
  it("warns when a chosen starter does not open their channel", () => {
    const state = simpleNight();
    state.channels = [channel("TWR", { starterKey: "p2" })];
    const warnings = messages(validateAllocation(state).warnings);
    expect(warnings.some(message => message.includes("is set to start TWR but doesn't have it at 13:30"))).toBe(true);
    expect(validateAllocation(state).errors).toEqual([]);
  });

  it("warns about uneven load without blocking the save", () => {
    const state = night({
      people: team(3),
      channels: [channel("TWR", { openAt: 0, closeAt: 360 })],
      duties: [duty("TWR", "p1", 0, 120), duty("TWR", "p2", 120, 240), duty("TWR", "p1", 240, 360)],
    });
    const result = validateAllocation(state);
    expect(result.errors).toEqual([]);
    expect(messages(result.warnings).some(message => message.startsWith("Uneven load in No half"))).toBe(true);
  });
});

describe("board labels", () => {
  it("uses a short alphabetic code as-is", () => {
    expect(personShortLabel(person("p1", { name: "Arindam Sen", code: "AS" }))).toBe("AS");
  });

  it("falls back to initials for an employee number", () => {
    // People seeded from the duty grid carry an eight-digit employee number,
    // which is unreadable on a strip.
    expect(personShortLabel(person("p1", { name: "Dhananjay Kumar", code: "10010146" }))).toBe("DK");
  });

  it("falls back to initials when there is no code at all", () => {
    expect(personShortLabel(person("p1", { name: "Madhurima Halder", code: "" }))).toBe("MH");
  });

  it("caps initials at three letters", () => {
    expect(personShortLabel(person("p1", { name: "Aditya Kumar Singh Rao", code: "10020256" }))).toBe("AKS");
  });

  it("survives a missing person", () => {
    expect(personShortLabel(undefined)).toBe("??");
  });
});

describe("merging CLD into SMC", () => {
  /** CLD folded into SMC-S 19:00–21:30; both covered end to end otherwise. */
  function mergedNight(mergedInto: string | null = "SMC-S") {
    return night({
      people: team(4),
      channels: [
        channel("SMC-S", { openAt: 0, closeAt: 720 }),
        channel("CLD", { openAt: 0, closeAt: 720, mergedInto }),
      ],
      duties: [
        duty("SMC-S", "p1", 0, 120), duty("SMC-S", "p2", 120, 240), duty("SMC-S", "p3", 240, 360),
        duty("SMC-S", "p4", 360, 480), duty("SMC-S", "p1", 480, 600), duty("SMC-S", "p2", 600, 720),
        duty("CLD", "p3", 0, 120), duty("CLD", "p4", 120, 240), duty("CLD", "p1", 240, 330),
        duty("CLD", "p3", 480, 600), duty("CLD", "p4", 600, 720),
      ],
    });
  }

  it("does not count the merged window as uncovered", () => {
    expect(uncoveredMinutes(mergedNight())).toBe(0);
    expect(errorsOf(mergedNight()).some(message => message.includes("CLD has no one on duty"))).toBe(false);
  });

  it("calls the same gap uncovered when nothing is merged", () => {
    const state = mergedNight(null);
    expect(uncoveredMinutes(state)).toBe(150);
    expect(errorsOf(state).some(message => message.includes("CLD has no one on duty 19:00–21:30"))).toBe(true);
  });

  it("refuses a duty on the position that has been merged away", () => {
    const state = mergedNight();
    state.duties.push(duty("CLD", "p2", 330, 480));
    expect(errorsOf(state).some(message => message.includes("is merged into SMC-S"))).toBe(true);
  });

  it("refuses a merge into a position that is not in use", () => {
    const state = mergedNight();
    state.channels = state.channels.map(entry =>
      entry.code === "SMC-S" ? { ...entry, inUse: false } : entry,
    );
    expect(errorsOf(state).some(message => message.includes("which isn't in use tonight"))).toBe(true);
  });

  it("refuses a merge into a position that closes before the window ends", () => {
    const state = mergedNight();
    state.channels = state.channels.map(entry =>
      entry.code === "SMC-S" ? { ...entry, closeAt: 400 } : entry,
    );
    expect(errorsOf(state).some(message => message.includes("isn't open for the whole"))).toBe(true);
  });

  it("refuses CLD merged into itself, and still wants it covered", () => {
    // The hole a hostile payload would use: a self-merge excused CLD from cover.
    const state = mergedNight("CLD");
    expect(errorsOf(state)).toContain("CLD can only merge into SMC, SMC-S or SMC-N, not CLD.");
    expect(uncoveredMinutes(state)).toBe(150);
    expect(errorsOf(state).some(message => message.includes("CLD has no one on duty 19:00–21:30"))).toBe(true);
  });

  it("refuses CLD merged into a position that is not an SMC", () => {
    const state = mergedNight("TWR");
    state.channels.push(channel("TWR"));
    expect(errorsOf(state)).toContain("CLD can only merge into SMC, SMC-S or SMC-N, not TWR.");
    expect(uncoveredMinutes(state)).toBeGreaterThanOrEqual(150);
  });

  it("refuses a merge set on any position other than CLD", () => {
    const state = mergedNight(null);
    state.channels = state.channels.map(entry =>
      entry.code === "SMC-S" ? { ...entry, mergedInto: "CLD" } : entry,
    );
    expect(errorsOf(state)).toContain("SMC-S can't be merged into another position. Only CLD can.");
  });

  it("always reports an active merge as a suggestion", () => {
    const warnings = messages(validateAllocation(mergedNight()).warnings);
    expect(warnings.some(message => message.includes("CLD is merged into SMC-S 19:00–21:30"))).toBe(true);
  });

  it("takes the merged minutes out of the staffing arithmetic", () => {
    // Four people against four positions: short by one until CLD folds away.
    const plain = night({
      people: team(4, { tso: [1] }),
      channels: ["TWR", "SMC-S", "CLD", "TSO"].map(code => channel(code)),
    });
    const merged = {
      ...plain,
      channels: plain.channels.map(entry => (entry.code === "CLD" ? { ...entry, mergedInto: "SMC-S" } : entry)),
    };
    expect(staffingNotices(plain).length).toBeGreaterThan(staffingNotices(merged).length);
  });
});

describe("each person and position once", () => {
  it("refuses a person listed twice", () => {
    const state = night({ people: [person("p1"), person("p1")], channels: [channel("TWR")] });
    expect(errorsOf(state)).toContain("P1 is on tonight's list more than once.");
  });

  it("refuses a position listed twice, and says so only once", () => {
    const state = night({ people: [person("p1")], channels: [channel("TWR"), channel("TWR"), channel("TWR")] });
    expect(errorsOf(state).filter(message => message === "TWR is listed more than once.")).toHaveLength(1);
  });
});

describe("board order", () => {
  it("puts the defaults in their listed order and anything else after them", () => {
    const shuffled = ["TSO", "ZZZ", "CLD", "TWR", "AAA", "SMC-N", "SMC-S"].map(code => channel(code));
    expect(inBoardOrder(shuffled).map(entry => entry.code)).toEqual([
      "TWR", "SMC-S", "SMC-N", "CLD", "TSO", "AAA", "ZZZ",
    ]);
  });
});

describe("preferred duty lengths", () => {
  it("ranks 1h, 1h 30m and 2h first, other hour-plus lengths next, under an hour last", () => {
    expect([60, 90, 120].map(length => dutyLengthRank(length, "TWR"))).toEqual([0, 0, 0]);
    expect([75, 105].map(length => dutyLengthRank(length, "TWR"))).toEqual([1, 1]);
    expect([30, 45].map(length => dutyLengthRank(length, "TWR"))).toEqual([2, 2]);
  });

  it("counts any whole or half hour from 1h up as preferred on TSO, which has no cap", () => {
    expect([60, 150, 240, 720].map(length => dutyLengthRank(length, "TSO"))).toEqual([0, 0, 0, 0]);
    expect(dutyLengthRank(135, "TSO")).toBe(1);
    expect(dutyLengthRank(45, "TSO")).toBe(2);
  });

  it("names each duty under an hour, as a suggestion rather than a problem", () => {
    const state = night({
      people: team(2),
      channels: [channel("TWR", { openAt: 0, closeAt: 150 })],
      duties: [duty("TWR", "p1", 0, 60), duty("TWR", "p2", 60, 105), duty("TWR", "p1", 105, 150)],
    });
    const { errors, warnings } = validateAllocation(state);
    expect(errors).toEqual([]);
    const note = warnings.find(issue => issue.message.includes("Under an hour"));
    expect(note?.message).toBe(
      "Preferred: duties of 1h, 1h 30m or 2h. Under an hour: Person 2 TWR 14:30–15:15, Person 1 TWR 15:15–16:00.",
    );
    expect(note?.dutyIds).toHaveLength(2);
  });

  it("says nothing about a position open for under an hour, which can't do better", () => {
    const state = night({
      people: team(1),
      channels: [channel("CLD", { openAt: 0, closeAt: 45 })],
      duties: [duty("CLD", "p1", 0, 45)],
    });
    expect(validateAllocation(state).warnings.some(issue => issue.message.includes("Under an hour"))).toBe(false);
  });
});

describe("part-night availability", () => {
  const away = (key: string, periods: Array<[number, number]>, overrides: Parameters<typeof person>[1] = {}) =>
    person(key, { name: key.toUpperCase(), availability: { mode: "except", periods }, ...overrides });

  it("refuses a duty in time someone is away, naming the time", () => {
    const state = night({
      people: [away("p1", [[240, 360]]), person("p2", { name: "P2" })],
      channels: [channel("TWR", { openAt: 180, closeAt: 300 })],
      duties: [duty("TWR", "p1", 180, 300)],
    });
    expect(errorsOf(state)).toContain("P1 isn't available 17:30–18:30 but has TWR 16:30–18:30.");
  });

  it("allows a duty that ends as they leave and one that starts as they are back", () => {
    const state = night({
      people: [away("p1", [[120, 240]]), person("p2", { name: "P2" })],
      channels: [channel("TWR", { openAt: 0, closeAt: 360 })],
      duties: [duty("TWR", "p1", 0, 120), duty("TWR", "p2", 120, 240), duty("TWR", "p1", 240, 360)],
    });
    expect(errorsOf(state)).toEqual([]);
  });

  it("refuses a starter who is away when the position opens", () => {
    const state = night({
      people: [away("p1", [[0, 60]]), person("p2")],
      channels: [channel("TWR", { starterKey: "p1" })],
    });
    expect(errorsOf(state)).toContain("P1 is set to start TWR at 13:30 but isn't available then.");
  });

  it("refuses someone in a half who is away for all of it", () => {
    const state = night({
      people: [away("p1", [[240, 480]], { half: "1st" }), person("p2")],
      channels: [channel("TWR")],
    });
    expect(errorsOf(state)).toContain("P1 is 1st Half but isn't available at any time in it (17:30–21:30).");

    const nearly = night({
      people: [away("p1", [[255, 480]], { half: "1st" }), person("p2")],
      channels: [channel("TWR")],
    });
    expect(errorsOf(nearly)).toContain(
      "P1 is 1st Half but is available for only 15 min of it (17:30–21:30), too short for a duty.",
    );
  });

  it("names who is away when the times leave too few people for the positions open", () => {
    const state = night({
      people: [away("p1", [[240, 360]], { name: "Asha Rao" }), person("p2"), person("p3")],
      channels: [channel("TWR"), channel("SMC-S"), channel("CLD")],
    });
    expect(staffingNotices(state)).toContain(
      "17:30–19:30: 2 people are around for 3 open positions — Asha Rao is away then. Change someone's times, " +
        "close a position for part of it, or add someone.",
    );
  });

  it("says nothing extra when the shortfall has nothing to do with anyone's times", () => {
    const state = night({ people: team(2), channels: [channel("TWR"), channel("SMC-S"), channel("CLD")] });
    expect(staffingNotices(state).some(notice => notice.includes("away then"))).toBe(false);
  });

  it("flags TSO when everyone who can take it is away", () => {
    const state = night({
      people: [away("p1", [[480, 600]], { canTakeTso: true, name: "Asha Rao" }), person("p2"), person("p3")],
      channels: [channel("TSO"), channel("TWR")],
    });
    expect(staffingNotices(state).some(notice => notice.startsWith("TSO 21:30–23:30: everyone who can take TSO is away then (Asha Rao)"))).toBe(true);
  });

  it("stops counting someone for a window they are away for nearly all of", () => {
    // Four positions all night need five people 17:30–21:30 — which five have,
    // until one of them is away for all but fifteen minutes of it.
    const state = night({ people: team(5), channels: ["TWR", "SMC-S", "SMC-N", "CLD"].map(code => channel(code)) });
    expect(staffingNotices(state).some(notice => notice.startsWith("17:30–21:30"))).toBe(false);
    state.people[4] = { ...state.people[4], availability: { mode: "except", periods: [[255, 480]] } };
    expect(staffingNotices(state).some(notice => notice.startsWith("17:30–21:30: 4 people can work"))).toBe(true);
  });
});

describe("DB slots", () => {
  it("counts a board holding only DB slots as not planned yet", () => {
    const state = night({
      people: team(3, { halves: { 2: "1st" } }),
      channels: [channel("TWR"), channel("CLD")],
      duties: [dbSlot("TWR", "p1", 240, 360)],
    });
    expect(isPlanned(state)).toBe(false);
    expect(errorsOf(state)).toEqual([]);
  });

  it("holds a DB slot to every duty rule, as the instructor's own duty", () => {
    const state = night({
      people: team(3),
      channels: [channel("TWR"), channel("CLD")],
      duties: [dbSlot("TWR", "p1", 240, 390), dbSlot("CLD", "p1", 300, 360)],
    });
    const errors = errorsOf(state);
    expect(errors.some(message => message.includes("A duty can be at most 2h"))).toBe(true);
    expect(errors.some(message => message.includes("is on TWR and CLD at the same time"))).toBe(true);
  });

  it("lets a DB slot at the opening open the position, whoever was chosen to start it", () => {
    const people = team(3);
    const state = night({
      people,
      channels: [channel("TWR", { openAt: 0, closeAt: 240, starterKey: "p2" })],
      duties: [dbSlot("TWR", "p1", 0, 120), duty("TWR", "p2", 120, 240)],
    });
    const { errors, warnings } = validateAllocation(state);
    expect(messages(errors)).toEqual([]);
    expect(warnings.some(issue => issue.message.includes("is set to start TWR"))).toBe(false);
  });

  it("doesn't list a short DB slot among the short duties — its length was fixed on purpose", () => {
    const state = night({
      people: team(2),
      channels: [channel("TWR", { openAt: 0, closeAt: 105 })],
      duties: [duty("TWR", "p2", 0, 60), dbSlot("TWR", "p1", 60, 105)],
    });
    expect(validateAllocation(state).warnings.some(issue => issue.message.includes("Under an hour"))).toBe(false);
  });

  it("judges DB slots on their own, leaving clashes with ordinary duties to the plan", () => {
    const state = night({
      people: team(3),
      channels: [channel("TWR"), channel("CLD")],
      duties: [dbSlot("TWR", "p1", 240, 360), duty("CLD", "p1", 240, 360)],
    });
    expect(fixedDutyErrors(state)).toEqual([]);
    expect(errorsOf(state).some(message => message.includes("is on TWR and CLD at the same time"))).toBe(true);
  });

  it("names a stretch a DB slot leaves too short for any duty", () => {
    const state = night({
      people: team(4),
      channels: [channel("TWR", { openAt: 0, closeAt: 375 })],
      duties: [dbSlot("TWR", "p1", 240, 360)],
    });
    expect(shortStretchNotices(state)).toEqual([
      "TWR 19:30–19:45 is only 15 min, between a DB slot and its closing — too short for a duty. Move the DB " +
        "slot, or change when TWR opens or closes.",
    ]);
  });
});

describe("no break needed around TSO", () => {
  const breakErrors = (state: ReturnType<typeof night>) => errorsOf(state).filter(message => message.includes("min break"));

  it("lets someone relieved from TWR take TSO from the same minute", () => {
    const state = night({
      people: team(3, { tso: [1, 2, 3] }),
      channels: [channel("TWR", { openAt: 0, closeAt: 180 }), channel("TSO", { openAt: 90, closeAt: 180 })],
      duties: [duty("TWR", "p1", 0, 90), duty("TWR", "p2", 90, 180), duty("TSO", "p1", 90, 180)],
    });
    expect(errorsOf(state)).toEqual([]);
  });

  it("lets someone relieved from TSO take SMC from the same minute", () => {
    const state = night({
      people: team(3, { tso: [1, 2, 3] }),
      channels: [channel("TSO", { openAt: 0, closeAt: 180 }), channel("SMC-S", { openAt: 90, closeAt: 180 })],
      duties: [duty("TSO", "p1", 0, 90), duty("TSO", "p2", 90, 180), duty("SMC-S", "p1", 90, 180)],
    });
    expect(errorsOf(state)).toEqual([]);
  });

  it("still wants 30 minutes between any two other positions", () => {
    const state = night({
      people: team(3),
      channels: [channel("TWR", { openAt: 0, closeAt: 180 }), channel("SMC-S", { openAt: 90, closeAt: 180 })],
      duties: [duty("TWR", "p1", 0, 90), duty("TWR", "p2", 90, 180), duty("SMC-S", "p1", 90, 180)],
    });
    expect(breakErrors(state)).toEqual([
      "Person 1 has a 0 min break between TWR (ends 15:00) and SMC-S (starts 15:00). At least 30 min needed.",
    ]);
  });

  it("counts a TSO duty between two control duties towards their 30 minutes", () => {
    // TWR until 15:00, TSO 15:00–15:30, SMC from 15:30: never a moment off,
    // but the two control duties are 30 minutes apart.
    const through = night({
      people: team(1, { tso: [1] }),
      channels: [channel("TWR", { openAt: 0, closeAt: 90 }), channel("TSO", { openAt: 90, closeAt: 120 }), channel("SMC-S", { openAt: 120, closeAt: 240 })],
      duties: [duty("TWR", "p1", 0, 90), duty("TSO", "p1", 90, 120), duty("SMC-S", "p1", 120, 240)],
    });
    expect(errorsOf(through)).toEqual([]);
  });

  it("applies the same to a DB slot next to TSO", () => {
    const state = night({
      people: team(2, { tso: [1, 2] }),
      channels: [channel("TWR", { openAt: 240, closeAt: 360 }), channel("TSO", { openAt: 360, closeAt: 480 })],
      duties: [dbSlot("TWR", "p1", 240, 360), duty("TSO", "p1", 360, 480)],
    });
    expect(breakErrors(state)).toEqual([]);
  });

  it("doesn't count TSO as tying anyone up when those cleared for it can take turns", () => {
    // Four people, every one of them cleared for TSO: each works control for
    // 1h 30m and spends the next 30 minutes on TSO instead of resting.
    const turns = night({
      people: team(4, { tso: [1, 2, 3, 4] }),
      channels: ["TWR", "SMC-S", "CLD", "TSO"].map(code => channel(code)),
    });
    expect(staffingNotices(turns)).toEqual([]);

    // With only two cleared, the other two need real breaks, and it can't work.
    const fewCleared = night({
      people: team(4, { tso: [1, 2] }),
      channels: ["TWR", "SMC-S", "CLD", "TSO"].map(code => channel(code)),
    });
    expect(staffingNotices(fewCleared).some(notice => notice.includes("4 open channels need at least 5"))).toBe(true);
  });
});
