import { describe, expect, it } from "vitest";
import { generateAllocation, planEveningRests, solveContinuous } from "../solver";
import { eveningRestShortfalls, isBlank, uncoveredMinutes, validateAllocation } from "../rules";
import { accepted, blank, channel, dbSlot, duty, messages, night, person, team } from "./fixtures";
import type { NightAllocationState } from "../types";

/** Whose evening rest the rules say is missing, by key. */
const short = (state: NightAllocationState) => eveningRestShortfalls(state).map(shortfall => shortfall.person.key);

/** A night of one person's duties, each on a position of its own so nothing clashes. */
function onePerson(duties: Array<[string, number, number]>, half: "1st" | "2nd" | null = null) {
  return night({
    people: [person("p1", { name: "Asha Rao", half, canTakeTso: true })],
    channels: [...new Set(duties.map(([code]) => code))].map(code => channel(code)),
    duties: duties.map(([code, start, end]) => duty(code, "p1", start, end)),
  });
}

describe("the evening rest preference", () => {
  it("is met by a 2nd Half person, off through the 1st Half", () => {
    expect(short(onePerson([["TWR", 120, 240], ["SMC-S", 480, 600]], "2nd"))).toEqual([]);
  });

  it("is met by a 1st Half person, off from 21:30 to the end of the night", () => {
    expect(short(onePerson([["TWR", 240, 360], ["SMC-S", 390, 480]], "1st"))).toEqual([]);
  });

  it("isn't met by 30 minute breaks all evening, and says the longest break there was", () => {
    const state = onePerson([["TWR", 180, 300], ["SMC-S", 330, 450], ["TWR", 480, 600], ["SMC-S", 630, 720]]);
    const [shortfall] = eveningRestShortfalls(state);
    expect(shortfall.longest).toEqual({ from: 300, to: 330 });

    const warning = messages(validateAllocation(state).warnings).find(message => message.includes("in a row"));
    expect(warning).toBe(
      "Preferred: 4h in a row off every position, starting between 16:30 and 23:30 (TSO doesn't count). " +
        "Not met for Asha Rao (longest 30m, 18:30–19:00).",
    );
  });

  it("ignores TSO: time on it neither counts as work nor breaks the rest", () => {
    expect(short(onePerson([["TWR", 120, 240], ["TSO", 240, 480], ["SMC-S", 480, 600]]))).toEqual([]);
    // Nobody holding only TSO has anything to rest from.
    expect(short(onePerson([["TSO", 0, 720]]))).toEqual([]);
  });

  it("counts a break that began before 16:30 only from 16:30", () => {
    // Off 15:00–20:00 is 5 hours, but only 3h 30m of it is from 16:30.
    expect(short(onePerson([["TWR", 0, 90], ["SMC-S", 390, 510]]))).toEqual(["p1"]);
    expect(short(onePerson([["TWR", 0, 90], ["SMC-S", 420, 540]]))).toEqual([]);
  });

  it("counts a DB slot as time on a position", () => {
    const state = onePerson([["SMC-S", 540, 600]]);
    state.channels.push(channel("TWR"));
    state.duties.push(dbSlot("TWR", "p1", 300, 420));
    expect(short(state)).toEqual(["p1"]);
  });

  it("never counts a blank as anybody's", () => {
    const state = onePerson([["TWR", 180, 300]]);
    state.duties.push(blank("TWR", 300, 720));
    expect(short(state)).toEqual([]);
  });
});

describe("the generator and the evening rest", () => {
  it("gives everyone their 4 hours when the crew can spare them", () => {
    const state = night({ people: team(8), channels: [channel("TWR"), channel("SMC-S"), channel("CLD")] });
    const result = accepted(generateAllocation(state, { budgetMs: 2000, seed: 3 }));

    expect(uncoveredMinutes(result.state)).toBe(0);
    expect(messages(validateAllocation(result.state).errors)).toEqual([]);
    expect(short(result.state)).toEqual([]);
    expect(result.note ?? "").not.toContain("4h off in a row");
  });

  it("on a thin night gives it to as many as it can, and says the rest missed out", () => {
    const state = night({ people: team(6), channels: [channel("TWR"), channel("SMC-S"), channel("CLD")] });
    const result = accepted(generateAllocation(state, { budgetMs: 2000, seed: 3 }));

    expect(messages(validateAllocation(result.state).errors)).toEqual([]);
    const missed = short(result.state).length;
    expect(missed).toBeGreaterThan(0);
    expect(missed).toBeLessThan(6);
    expect(result.note).toContain(`${missed} people couldn't be given 4h off in a row from 16:30. See suggestions.`);
  });

  it("owes nobody in a half a rest, nor anyone away for 4 hours of the evening", () => {
    const state = night({
      people: [
        ...team(6, { halves: { 1: "1st", 2: "2nd" } }),
        person("away", { availability: { mode: "except", periods: [[240, 500]] } }),
      ],
      channels: [channel("TWR"), channel("SMC-S")],
    });
    const { rests } = planEveningRests(state);
    expect(Object.keys(rests).sort()).toEqual(["p3", "p4", "p5", "p6"]);
  });

  it("staggers the rests rather than starting them all at 16:30", () => {
    const state = night({ people: team(8), channels: [channel("TWR"), channel("SMC-S"), channel("CLD")] });
    const { rests, unplaced } = planEveningRests(state);
    expect(unplaced).toEqual([]);
    const starts = new Set(Object.values(rests).map(([start]) => start));
    expect(starts.size).toBeGreaterThan(2);
    for (const [start, end] of Object.values(rests)) {
      expect(end - start).toBe(240);
      expect(start).toBeGreaterThanOrEqual(180);
      expect(end).toBeLessThanOrEqual(720);
    }
  });

  it("keeps people off control for their rest, but lets them take TSO", () => {
    const state = night({
      people: team(6, { tso: [1, 2] }),
      channels: [channel("TWR"), channel("TSO")],
    });
    const rests = { p1: [180, 420], p2: [420, 660] } as const;
    const duties = solveContinuous(state, { rests, seed: 1 });

    expect(duties).not.toBeNull();
    for (const [key, [from, to]] of Object.entries(rests)) {
      const onControl = (duties ?? []).filter(
        entry => entry.personKey === key && entry.channelCode !== "TSO" && entry.startMin < to && entry.endMin > from,
      );
      expect(onControl).toEqual([]);
    }
  });

  it("replaces blanks along with the duties", () => {
    const state = night({
      people: team(8),
      channels: [channel("TWR"), channel("SMC-S"), channel("CLD")],
      duties: [blank("TWR", 90, 180)],
    });
    const result = accepted(generateAllocation(state, { budgetMs: 2000, seed: 3 }));
    expect(result.state.duties.some(isBlank)).toBe(false);
    expect(uncoveredMinutes(result.state)).toBe(0);
  });
});
