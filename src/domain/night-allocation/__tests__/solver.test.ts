import { describe, expect, it } from "vitest";
import { NIGHT_SPAN_MIN } from "../constants";
import { generateAllocation, restartBudgets, solveContinuous } from "../solver";
import { uncoveredMinutes, validateAllocation } from "../rules";
import { channel, dbSlot, duty, night, refused, team, withStarters } from "./fixtures";
import type { NightAllocationState } from "../types";

/**
 * The two properties every accepted plan owes, checked together. Takes the
 * state the solver returned — which carries any setting it chose for itself.
 */
function expectContinuousAndLegal(planned: NightAllocationState) {
  expect(uncoveredMinutes(planned)).toBe(0);
  expect(validateAllocation(planned).errors.map(issue => issue.message)).toEqual([]);
}

describe("the classic night", () => {
  it("covers 3 channels with 4 people and relieves them in turn", () => {
    const people = team(4);
    const state = night({
      people,
      channels: withStarters([channel("TWR"), channel("SMC-S"), channel("CLD")], people),
      dutyLengthPref: 90,
    });

    const result = generateAllocation(state, { budgetMs: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    // 3 channels and 4 people: handovers every 30 minutes, duties of 1h 30m.
    const lengths = result.state.duties.map(duty => duty.endMin - duty.startMin);
    const typical = lengths.filter(length => length === 90).length;
    expect(typical / lengths.length).toBeGreaterThan(0.5);

    // Nobody is relieved at the same minute on two channels back to back —
    // that is what leaves everyone a break.
    const handovers = result.state.duties.filter(duty => duty.endMin < NIGHT_SPAN_MIN).map(duty => duty.endMin);
    expect(new Set(handovers).size).toBeGreaterThan(1);
  });

  it("starts each channel with the person chosen for it", () => {
    const people = team(4);
    const channels = withStarters([channel("TWR"), channel("SMC-S"), channel("CLD")], people);
    const state = night({ people, channels });

    const result = generateAllocation(state, { budgetMs: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const entry of channels) {
      const opening = result.state.duties.find(duty => duty.channelCode === entry.code && duty.startMin === entry.openAt);
      expect(opening?.personKey).toBe(entry.starterKey);
    }
  });
});

describe("TSO", () => {
  it("covers TSO all night with exactly two qualified people", () => {
    const people = team(6, { tso: [1, 2] });
    const state = night({
      people,
      channels: [
        channel("TWR", { starterKey: "p3" }),
        channel("SMC-S", { starterKey: "p4" }),
        channel("TSO", { starterKey: "p1" }),
      ],
    });

    const result = generateAllocation(state, { budgetMs: 3000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    const tsoHolders = new Set(result.state.duties.filter(duty => duty.channelCode === "TSO").map(duty => duty.personKey));
    expect([...tsoHolders].every(key => ["p1", "p2"].includes(key))).toBe(true);
  });

  it("covers a whole night of TSO with one qualified person", () => {
    // TSO has no two-hour cap, so a single qualified person is enough for it.
    const people = team(6, { tso: [1] });
    const state = night({
      people,
      channels: [channel("TWR", { starterKey: "p2" }), channel("TSO", { starterKey: "p1" })],
    });

    const result = generateAllocation(state, { budgetMs: 3000, seed: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    const tso = result.state.duties.filter(duty => duty.channelCode === "TSO");
    expect(new Set(tso.map(duty => duty.personKey))).toEqual(new Set(["p1"]));
    expect(Math.max(...tso.map(duty => duty.endMin - duty.startMin))).toBeGreaterThan(120);
  });
});

describe("part-night channels", () => {
  it("covers a channel that closes at 21:30 and leaves it alone after", () => {
    const people = team(5);
    const state = night({
      people,
      channels: withStarters(
        [channel("TWR"), channel("SMC-S"), channel("SMC-N", { closeAt: 480 })],
        people,
      ),
    });

    const result = generateAllocation(state, { budgetMs: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);
    expect(result.state.duties.filter(duty => duty.channelCode === "SMC-N").every(duty => duty.endMin <= 480)).toBe(true);
  });

  it("covers a channel that opens late", () => {
    const people = team(5);
    const channels = withStarters([channel("TWR"), channel("CLD"), channel("SMC-S", { openAt: 240 })], people);
    const state = night({ people, channels });

    const result = generateAllocation(state, { budgetMs: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);
    expect(result.state.duties.filter(duty => duty.channelCode === "SMC-S").every(duty => duty.startMin >= 240)).toBe(true);
  });
});

describe("halves", () => {
  it("plans a night with several people in each half", () => {
    const people = team(7, { halves: { 1: "1st", 2: "1st", 3: "2nd", 4: "2nd" } });
    const state = night({
      people,
      channels: withStarters([channel("TWR"), channel("SMC-S"), channel("CLD")], [people[4], people[5], people[6]]),
    });

    const result = generateAllocation(state, { budgetMs: 3000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    // Everyone in a half holds something inside it, and nothing in the other.
    for (const key of ["p1", "p2"]) {
      const mine = result.state.duties.filter(duty => duty.personKey === key);
      expect(mine.some(duty => duty.startMin < 480 && duty.endMin > 240)).toBe(true);
      expect(mine.every(duty => duty.endMin <= 480)).toBe(true);
    }
    for (const key of ["p3", "p4"]) {
      const mine = result.state.duties.filter(duty => duty.personKey === key);
      expect(mine.some(duty => duty.endMin > 480)).toBe(true);
      expect(mine.every(duty => !(duty.startMin < 480 && duty.endMin > 240))).toBe(true);
    }
  });
});

describe("duty length preference", () => {
  it("honours an hour when staffing allows it", () => {
    const people = team(6);
    const state = night({
      people,
      channels: withStarters([channel("TWR"), channel("SMC-S"), channel("CLD")], people),
      dutyLengthPref: 60,
    });

    const result = generateAllocation(state, { budgetMs: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    const lengths = result.state.duties.map(duty => duty.endMin - duty.startMin);
    const median = lengths.slice().sort((a, b) => a - b)[Math.floor(lengths.length / 2)];
    expect(median).toBeLessThanOrEqual(75);
  });

  it("explains itself when the preference cannot be kept", () => {
    const people = team(4);
    const state = night({
      people,
      channels: withStarters([channel("TWR"), channel("SMC-S"), channel("CLD")], people),
      dutyLengthPref: 30,
    });

    const result = generateAllocation(state, { budgetMs: 2000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toContain("so everyone still gets a 30 min break");
  });
});

describe("refusals", () => {
  it("returns reasons and no duties when staffing cannot work", () => {
    // Three people cannot hold five positions at once, whatever the duty rules.
    const people = team(3, { tso: [1] });
    const state = night({
      people,
      channels: ["TWR", "SMC-S", "SMC-N", "CLD", "TSO"].map(code => channel(code)),
    });

    const result = generateAllocation(state, { budgetMs: 400, seed: 1 });
    const refusal = refused(result);
    expect(refusal.reasons.length).toBeGreaterThan(0);
  });

  it("refuses one person starting two channels that open together", () => {
    const people = team(4);
    const state = night({
      people,
      channels: [channel("TWR", { starterKey: "p1" }), channel("CLD", { starterKey: "p1" })],
    });
    const result = generateAllocation(state, { budgetMs: 100 });
    const refusal = refused(result);
    expect(refusal.error).toContain("can't start both TWR and CLD");
  });

  it("never returns a partial plan", () => {
    const people = team(3);
    const state = night({
      people,
      channels: withStarters([channel("TWR"), channel("SMC-S"), channel("CLD"), channel("SMC-N")], people),
    });
    const solved = solveContinuous(state, { nodeLimit: 5000 });
    expect(solved).toBeNull();
  });
});

describe("determinism", () => {
  it("produces the same plan for the same settings", () => {
    const people = team(5);
    const state = night({ people, channels: withStarters([channel("TWR"), channel("SMC-S")], people) });
    const first = solveContinuous(state, { seed: 7 });
    const second = solveContinuous(state, { seed: 7 });
    expect(first?.map(duty => [duty.channelCode, duty.personKey, duty.startMin, duty.endMin])).toEqual(
      second?.map(duty => [duty.channelCode, duty.personKey, duty.startMin, duty.endMin]),
    );
  });
});

describe("starters are optional", () => {
  it("plans a night with nobody chosen to start anything", () => {
    const people = team(5);
    const state = night({ people, channels: [channel("TWR"), channel("SMC-S"), channel("CLD")] });

    const result = generateAllocation(state, { budgetMs: 2000, seed: 11 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    // Every channel still gets somebody at its opening minute — the solver
    // chose them rather than the user.
    for (const entry of state.channels) {
      const opening = result.state.duties.find(duty => duty.channelCode === entry.code && duty.startMin === entry.openAt);
      expect(opening, `${entry.code} has no opening duty`).toBeDefined();
    }
  });

  it("honours the starters that were chosen and fills in the rest", () => {
    const people = team(5);
    const state = night({
      people,
      channels: [channel("TWR", { starterKey: "p4" }), channel("SMC-S"), channel("CLD")],
    });

    const result = generateAllocation(state, { budgetMs: 2000, seed: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.duties.find(duty => duty.channelCode === "TWR" && duty.startMin === 0)?.personKey).toBe("p4");
    expectContinuousAndLegal(result.state);
  });

  it("offers a different night on a second run when nothing is pinned", () => {
    const people = team(6);
    const state = night({ people, channels: [channel("TWR"), channel("SMC-S"), channel("CLD")] });

    const openers = (seed: number) => {
      const result = generateAllocation(state, { budgetMs: 1500, seed });
      if (!result.ok) return "";
      return state.channels
        .map(entry => result.state.duties.find(d => d.channelCode === entry.code && d.startMin === 0)?.personKey)
        .join(",");
    };

    // Not a guarantee for any particular pair of seeds, but across a spread the
    // opening line-up must not be constant, or "chosen at random" is a lie.
    const shapes = new Set([openers(1), openers(2), openers(3), openers(4), openers(5)]);
    expect(shapes.size).toBeGreaterThan(1);
  }, 20_000);
});

describe("the TSO half crossover", () => {
  /** 1st Half people only, so the 2nd Half cannot be covered without help. */
  function crossoverNight() {
    const people = team(4, { tso: [1, 2], halves: { 1: "1st", 2: "1st", 3: "1st", 4: "1st" } });
    return night({
      people,
      channels: [
        channel("TWR", { closeAt: 480 }),
        channel("TSO", { starterKey: "p1" }),
      ],
    });
  }

  it("reaches for it only when the night cannot be covered otherwise", () => {
    const state = crossoverNight();
    const result = generateAllocation(state, { budgetMs: 3000, seed: 7 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    // TSO runs all night and only 1st Half people exist, so the 2nd Half of TSO
    // has to be covered across the half boundary.
    const late = result.state.duties.filter(duty => duty.channelCode === "TSO" && duty.endMin > 480);
    expect(late.length).toBeGreaterThan(0);
    expect(result.note).toContain("1st Half person cover TSO in the 2nd Half");
  });

  it("gets restart time of its own instead of waiting for the plain night to use it all", () => {
    // A fake clock that moves 100 ms per read. Spent from one pool, the plain
    // night (which cannot work) used the whole 3 s before the crossover was
    // tried at all; now it stops at its half and the crossover gets the rest.
    let clock = 0;
    const result = generateAllocation(crossoverNight(), { budgetMs: 3000, seed: 7, now: () => (clock += 100) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toContain("1st Half person cover TSO in the 2nd Half");
    expect(clock).toBeLessThan(3000);
  }, 60_000);

  it("does not use it on a night that works without it", () => {
    const people = team(6, { halves: { 1: "1st", 2: "2nd" } });
    const state = night({ people, channels: [channel("TWR"), channel("SMC-S")] });

    const result = generateAllocation(state, { budgetMs: 2000, seed: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    const firstHalfLate = result.state.duties.filter(
      duty => duty.personKey === "p1" && duty.endMin > 480,
    );
    expect(firstHalfLate).toEqual([]);
  });
});

describe("merging CLD into SMC", () => {
  /** Five in the 1st Half against four positions — thin, but workable. */
  function thinFirstHalf(mergedInto: string | null = null) {
    const people = team(11, {
      tso: [1, 6],
      halves: {
        1: "1st", 2: "1st", 3: "1st", 4: "1st", 5: "1st",
        6: "2nd", 7: "2nd", 8: "2nd", 9: "2nd", 10: "2nd", 11: "2nd",
      },
    });
    return night({
      people,
      channels: [
        channel("TWR"),
        channel("SMC-S"),
        channel("CLD", { mergedInto }),
        channel("TSO"),
      ],
    });
  }

  it("covers nothing on CLD during the merge — SMC's holder holds both", () => {
    const state = thinFirstHalf("SMC-S");
    const result = generateAllocation(state, { budgetMs: 4000, seed: 8 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    const duringMerge = result.state.duties.filter(
      duty => duty.channelCode === "CLD" && duty.startMin < 480 && duty.endMin > 330,
    );
    expect(duringMerge).toEqual([]);

    // CLD still runs normally either side of the window.
    expect(result.state.duties.some(duty => duty.channelCode === "CLD" && duty.endMin <= 330)).toBe(true);
    expect(result.state.duties.some(duty => duty.channelCode === "CLD" && duty.startMin >= 480)).toBe(true);
  });

  it("does not report a ticked merge as a last resort", () => {
    const result = generateAllocation(thinFirstHalf("SMC-S"), { budgetMs: 4000, seed: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mergedInto ?? null).toBeNull();
    expect(result.note ?? "").not.toContain("only by merging");
  });

  it("leaves CLD covered throughout when nothing is merged", () => {
    const state = thinFirstHalf(null);
    const result = generateAllocation(state, { budgetMs: 4000, seed: 6 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mergedInto ?? null).toBeNull();
    expectContinuousAndLegal(result.state);
    expect(
      result.state.duties.some(duty => duty.channelCode === "CLD" && duty.startMin < 480 && duty.endMin > 330),
    ).toBe(true);
  });
});

describe("sharing the restart budget", () => {
  it("shares it in proportion to each attempt's weight", () => {
    expect(restartBudgets(1500, [1])).toEqual([1500]);
    expect(restartBudgets(1500, [2, 2, 1])).toEqual([600, 600, 300]);
    expect(restartBudgets(1400, [2, 2, 1, 1, 1])).toEqual([400, 400, 200, 200, 200]);
  });

  it("never hands out more than the budget", () => {
    for (const weights of [[1], [2, 2, 1], [2, 2, 1, 1, 1], [2, 1]]) {
      const shares = restartBudgets(500, weights);
      expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(500);
      expect(shares.every(share => share > 0)).toBe(true);
    }
  });
});

describe("preferred duty lengths", () => {
  const under =(duties: Array<{ startMin: number; endMin: number }>, minutes: number) =>
    duties.filter(duty => duty.endMin - duty.startMin < minutes);

  it("keeps every duty to an hour or more on the nights the office actually runs", () => {
    const nights = [
      night({ people: team(4), channels: [channel("TWR"), channel("SMC-S"), channel("CLD")] }),
      night({
        people: team(9, { tso: [1, 2, 5], halves: { 1: "1st", 2: "1st", 3: "1st", 4: "2nd", 5: "2nd", 6: "2nd" } }),
        channels: ["TWR", "SMC-S", "CLD", "TSO"].map(code => channel(code)),
      }),
      night({
        people: team(11, { tso: [1, 2, 3], halves: { 1: "1st", 2: "1st", 3: "2nd", 4: "2nd" } }),
        channels: ["TWR", "SMC-S", "SMC-N", "CLD", "TSO"].map(code => channel(code)),
      }),
    ];
    for (const [index, state] of nights.entries()) {
      const result = generateAllocation(state, { budgetMs: 2000, seed: 3 + index });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expectContinuousAndLegal(result.state);
      expect(under(result.state.duties, 60)).toEqual([]);
    }
  }, 60_000);

  it("reaches for 1h, 1h 30m and 2h first", () => {
    const state = night({
      people: team(9, { tso: [1, 2, 5], halves: { 1: "1st", 2: "1st", 3: "1st", 4: "2nd", 5: "2nd", 6: "2nd" } }),
      channels: ["TWR", "SMC-S", "CLD", "TSO"].map(code => channel(code)),
    });
    const result = generateAllocation(state, { budgetMs: 2000, seed: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const capped = result.state.duties.filter(duty => duty.channelCode !== "TSO");
    const preferred = capped.filter(duty => [60, 90, 120].includes(duty.endMin - duty.startMin));
    expect(preferred.length / capped.length).toBeGreaterThanOrEqual(0.8);
  }, 30_000);

  it("holds short duties back entirely when asked to, and fails rather than use one", () => {
    // Two positions 13:30–15:45 with three people. Each splits only as 60 + 75
    // or 75 + 60, and whoever opened the other position can't be back in time:
    // no plan without a duty under an hour exists.
    const state = night({ people: team(3), channels: [channel("TWR", { closeAt: 135 }), channel("SMC-S", { closeAt: 135 })] });
    expect(solveContinuous(state, { forceStarters: false, shortDuties: false })).toBeNull();

    const withShort = solveContinuous(state, { forceStarters: false, shortDuties: true });
    expect(withShort).not.toBeNull();
    expect(under(withShort ?? [], 60).length).toBeGreaterThan(0);
  });

  it("uses a short duty when nothing longer works, and says so", () => {
    const state = night({ people: team(3), channels: [channel("TWR", { closeAt: 135 }), channel("SMC-S", { closeAt: 135 })] });
    const result = generateAllocation(state, { budgetMs: 200, seed: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);
    expect(result.note).toContain("not every duty could be 1h or more");
    const warnings = validateAllocation(result.state).warnings.map(issue => issue.message);
    expect(warnings.some(message => message.startsWith("Preferred: duties of 1h, 1h 30m or 2h. Under an hour:"))).toBe(true);
  });

  it("lets a position open for under an hour have its one short duty, without comment", () => {
    const state = night({
      people: team(4),
      channels: [channel("TWR"), channel("CLD", { openAt: 0, closeAt: 45 })],
    });
    const result = generateAllocation(state, { budgetMs: 1000, seed: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);
    expect(result.state.duties.filter(duty => duty.channelCode === "CLD").map(duty => duty.endMin - duty.startMin)).toEqual([45]);
    expect(result.note ?? "").not.toContain("not every duty could be 1h or more");
    expect(validateAllocation(result.state).warnings.some(issue => issue.message.includes("Under an hour"))).toBe(false);
  });

  it("still gives short duties when someone chose a short usual length", () => {
    const state = night({ people: team(6), channels: [channel("TWR"), channel("SMC-S")], dutyLengthPref: 45 });
    const result = generateAllocation(state, { budgetMs: 1000, seed: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(under(result.state.duties, 60).length).toBeGreaterThan(0);
  });
});

describe("DB slots", () => {
  it("plans the night around a slot and hands it back untouched", () => {
    const slot = dbSlot("TWR", "p1", 240, 360, "Sulagna");
    const state = night({
      people: team(5),
      channels: [channel("TWR"), channel("SMC-S"), channel("CLD")],
      duties: [slot],
    });

    const result = generateAllocation(state, { budgetMs: 2000, seed: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    expect(result.state.duties.filter(duty => duty.kind === "db")).toEqual([slot]);
    // Nobody else is on TWR during the slot, and the instructor is rested
    // either side of it like after any duty.
    const onTwrDuringSlot = result.state.duties.filter(
      duty => duty.channelCode === "TWR" && duty.id !== slot.id && duty.startMin < 360 && duty.endMin > 240,
    );
    expect(onTwrDuringSlot).toEqual([]);
    for (const duty of result.state.duties.filter(entry => entry.personKey === "p1" && entry.id !== slot.id)) {
      expect(duty.endMin <= 210 || duty.startMin >= 390, `p1 has ${duty.channelCode} too close to the slot`).toBe(true);
    }
  });

  it("lets a slot open a position, whoever was chosen to start it", () => {
    const slot = dbSlot("TWR", "p1", 0, 120);
    const state = night({
      people: team(5),
      channels: [channel("TWR", { starterKey: "p2" }), channel("SMC-S"), channel("CLD")],
      duties: [slot],
    });
    const result = generateAllocation(state, { budgetMs: 2000, seed: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);
    expect(result.state.duties.find(duty => duty.channelCode === "TWR" && duty.startMin === 0)?.id).toBe(slot.id);
  });

  it("keeps TSO's qualification on the stretch after a slot on TSO", () => {
    const state = night({
      people: team(6, { tso: [1, 2, 3] }),
      channels: [channel("TWR"), channel("TSO")],
      duties: [dbSlot("TSO", "p1", 240, 360)],
    });
    const result = generateAllocation(state, { budgetMs: 2000, seed: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);
    const tsoHolders = new Set(result.state.duties.filter(duty => duty.channelCode === "TSO").map(duty => duty.personKey));
    expect([...tsoHolders].every(key => ["p1", "p2", "p3"].includes(key))).toBe(true);
  });

  it("covers two slots back to back", () => {
    const first = dbSlot("TWR", "p1", 240, 360);
    const second = dbSlot("TWR", "p2", 360, 480, "Richa");
    const state = night({ people: team(6), channels: [channel("TWR"), channel("SMC-S")], duties: [first, second] });
    const result = generateAllocation(state, { budgetMs: 2000, seed: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);
    expect(result.state.duties.filter(duty => duty.kind === "db")).toEqual([first, second]);
  });

  it("returns the slots alone when they already cover every open minute", () => {
    const slot = dbSlot("TWR", "p1", 240, 360);
    const state = night({ people: team(2), channels: [channel("TWR", { openAt: 240, closeAt: 360 })], duties: [slot] });
    expect(solveContinuous(state)).toEqual([slot]);
  });

  it("refuses, naming the stretch, when a slot leaves too little to cover", () => {
    const state = night({
      people: team(5),
      channels: [channel("TWR", { closeAt: 375 })],
      duties: [dbSlot("TWR", "p1", 240, 360)],
    });
    const refusal = refused(generateAllocation(state, { budgetMs: 200, seed: 1 }));
    expect(refusal.error).toBe("Part of a position is too short for any duty, so no plan can cover it.");
    expect(refusal.reasons[0]).toContain("TWR 19:30–19:45 is only 15 min");
  });

  it("refuses a slot that breaks a rule on its own, before searching", () => {
    const people = team(4);
    people[0].available = false;
    const state = night({ people, channels: [channel("TWR")], duties: [dbSlot("TWR", "p1", 240, 360)] });
    const refusal = refused(generateAllocation(state, { budgetMs: 200, seed: 1 }));
    expect(refusal.error).toContain("A DB slot breaks a rule");
    expect(refusal.reasons).toContain("Person 1 isn't available tonight but has TWR 17:30–19:30.");
  });

  it("replaces an old plan but not the slots", () => {
    const slot = dbSlot("TWR", "p1", 240, 360);
    const state = night({
      people: team(5),
      channels: [channel("TWR"), channel("SMC-S")],
      duties: [slot, duty("SMC-S", "p2", 0, 120)],
    });
    const result = generateAllocation(state, { budgetMs: 2000, seed: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.duties.some(duty => duty.id === slot.id)).toBe(true);
    expectContinuousAndLegal(result.state);
  });
});

describe("part-night availability", () => {
  it("gives nobody a duty in time they're away, and keeps someone around only early to the early part", () => {
    const people = team(6);
    people[0].availability = { mode: "except", periods: [[240, 360]] };
    people[1].availability = { mode: "only", periods: [[0, 240]] };
    const state = night({ people, channels: [channel("TWR"), channel("SMC-S"), channel("CLD")] });

    const result = generateAllocation(state, { budgetMs: 2000, seed: 9 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    for (const duty of result.state.duties) {
      if (duty.personKey === "p1") expect(duty.endMin <= 240 || duty.startMin >= 360).toBe(true);
      if (duty.personKey === "p2") expect(duty.endMin).toBeLessThanOrEqual(240);
    }
  });

  it("covers a night where someone leaves partway through", () => {
    // Two positions until 19:00 and four people, one of whom leaves at 17:30:
    // the other three rotate through the last stretch between them.
    const people = team(4);
    people[3].availability = { mode: "only", periods: [[0, 240]] };
    const state = night({
      people,
      channels: [channel("TWR", { closeAt: 330 }), channel("SMC-S", { closeAt: 330 })],
    });
    const result = generateAllocation(state, { budgetMs: 2000, seed: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);
  });

  it("refuses a starter who is away when the position opens", () => {
    const people = team(4);
    people[0].availability = { mode: "except", periods: [[0, 60]] };
    const state = night({ people, channels: [channel("TWR", { starterKey: "p1" }), channel("SMC-S")] });
    const refusal = refused(generateAllocation(state, { budgetMs: 200, seed: 1 }));
    expect(refusal.error).toBe("Person 1 isn't available at 13:30, so can't start TWR. Pick someone else, or change their times.");
  });

  it("refuses someone in a half they're away for", () => {
    const people = team(5, { halves: { 1: "1st" } });
    people[0].availability = { mode: "except", periods: [[240, 480]] };
    const state = night({ people, channels: [channel("TWR"), channel("SMC-S")] });
    const refusal = refused(generateAllocation(state, { budgetMs: 200, seed: 1 }));
    expect(refusal.error).toBe(
      "Person 1 is in a half but away for nearly all of it. Take them out of the half, or change their times.",
    );
  });

  it("explains a refusal the times cause, with who is away", () => {
    const people = team(3);
    people[0].availability = { mode: "except", periods: [[240, 360]] };
    const state = night({ people, channels: [channel("TWR"), channel("SMC-S"), channel("CLD")] });
    const refusal = refused(generateAllocation(state, { budgetMs: 300, seed: 1 }));
    expect(refusal.reasons.some(reason => reason.includes("Person 1 is away then"))).toBe(true);
  });
});

describe("no break needed around TSO", () => {
  /** Consecutive duties of one person with no gap at all, as "TWR>TSO". */
  const straightThrough = (duties: Array<{ personKey: string; channelCode: string; startMin: number; endMin: number }>) => {
    const sorted = duties.slice().sort((a, b) => a.personKey.localeCompare(b.personKey) || a.startMin - b.startMin);
    const out: string[] = [];
    for (let index = 1; index < sorted.length; index++) {
      const [before, after] = [sorted[index - 1], sorted[index]];
      if (before.personKey === after.personKey && before.endMin === after.startMin) {
        out.push(`${before.channelCode}>${after.channelCode}`);
      }
    }
    return out;
  };

  it("covers four positions with four people when all of them can take TSO", () => {
    // Impossible with a break after every duty: nobody would ever be free.
    // With TSO as the break between control duties, it works all night.
    const state = night({ people: team(4, { tso: [1, 2, 3, 4] }), channels: ["TWR", "SMC-S", "CLD", "TSO"].map(code => channel(code)) });
    const result = generateAllocation(state, { budgetMs: 3000, seed: 7 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);

    const moves = straightThrough(result.state.duties);
    expect(moves.length).toBeGreaterThan(0);
    // Every straight-through move goes onto or off TSO, and TSO is never
    // handed from someone to themselves.
    expect(moves.every(move => move.includes("TSO"))).toBe(true);
    expect(moves).not.toContain("TSO>TSO");
  }, 30_000);

  it("still gives a real break after every duty when there are enough people for one", () => {
    const state = night({ people: team(5, { tso: [1, 2, 3] }), channels: ["TWR", "SMC-S", "CLD", "TSO"].map(code => channel(code)) });
    const result = generateAllocation(state, { budgetMs: 2000, seed: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expectContinuousAndLegal(result.state);
    expect(straightThrough(result.state.duties)).toEqual([]);
  });

  it("can be switched off, and then keeps a break around TSO too", () => {
    const state = night({ people: team(4, { tso: [1, 2, 3, 4] }), channels: ["TWR", "SMC-S", "CLD", "TSO"].map(code => channel(code)) });
    expect(solveContinuous(state, { tsoWithoutBreak: false, nodeLimit: 20_000 })).toBeNull();
  });
});
