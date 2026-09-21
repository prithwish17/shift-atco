import { describe, expect, it } from "vitest";
import { NIGHT_SPAN_MIN } from "../constants";
import { generateAllocation, restartBudgets, solveContinuous } from "../solver";
import { uncoveredMinutes, validateAllocation } from "../rules";
import { channel, night, refused, team, withStarters } from "./fixtures";
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
  it("keeps half for the plain night and splits the rest between the relaxations", () => {
    expect(restartBudgets(1500, 1)).toEqual([1500]);
    expect(restartBudgets(1500, 2)).toEqual([750, 750]);
    expect(restartBudgets(1500, 4)).toEqual([750, 250, 250, 250]);
  });

  it("never hands out more than the budget", () => {
    for (const attempts of [1, 2, 3, 4]) {
      const shares = restartBudgets(500, attempts);
      expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(500);
      expect(shares.every(share => share > 0)).toBe(true);
    }
  });
});
