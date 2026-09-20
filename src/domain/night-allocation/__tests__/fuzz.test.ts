import { describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_CODES, NIGHT_SPAN_MIN, SLOT_MIN } from "../constants";
import { generateAllocation } from "../solver";
import { uncoveredMinutes, validateAllocation } from "../rules";
import { channel, night, refused, team } from "./fixtures";
import type { HalfKey, NightAllocationState } from "../types";

/**
 * Property test. The generator's contract is narrow and absolute: whatever it
 * returns is continuous and breaks no hard rule, and whatever it refuses comes
 * with an explanation. Random nights are the only honest way to check that the
 * pruning and the restarts never quietly produce a plan with a hole in it.
 */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function randomNight(seed: number): NightAllocationState {
  const random = mulberry32(seed);
  const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)];

  const headcount = 5 + Math.floor(random() * 10); // 5–14
  const tso = Array.from({ length: headcount }, (_, index) => index + 1).filter(() => random() < 0.4);
  const halves: Record<number, HalfKey> = {};
  for (let number = 1; number <= headcount; number++) {
    const roll = random();
    if (roll < 0.15) halves[number] = "1st";
    else if (roll < 0.3) halves[number] = "2nd";
  }
  const people = team(headcount, { tso, halves });

  const channelCount = 3 + Math.floor(random() * 3); // 3–5
  const codes = DEFAULT_CHANNEL_CODES.slice(0, channelCount);
  const channels = codes.map(code => {
    // Two thirds of positions run all night; the rest open late or close early.
    const roll = random();
    let openAt = 0;
    let closeAt = NIGHT_SPAN_MIN;
    if (roll < 0.17) closeAt = 240 + Math.floor(random() * 16) * SLOT_MIN;
    else if (roll < 0.33) openAt = Math.floor(random() * 16) * SLOT_MIN;

    const eligible = people.filter(
      person =>
        person.available &&
        (code !== "TSO" || person.canTakeTso) &&
        !(person.half === "1st" && openAt >= 480) &&
        !(person.half === "2nd" && openAt >= 240 && openAt < 480),
    );
    return channel(code, { openAt, closeAt, starterKey: eligible.length ? pick(eligible).key : null });
  });

  return night({
    people,
    channels,
    dutyLengthPref: pick([0, 0, 60, 90, 120]),
  });
}

describe("random nights", () => {
  it("never returns a plan with a gap or a broken rule", () => {
    const runs = 250;
    let planned = 0;
    let refusals = 0;
    const startedAt = Date.now();

    for (let seed = 1; seed <= runs; seed++) {
      const state = randomNight(seed);
      const result = generateAllocation(state, { budgetMs: 120 });

      if (result.ok) {
        planned++;
        // The returned state carries whatever the search chose for itself, so
        // this is the board a caller would actually end up with.
        expect(uncoveredMinutes(result.state), `seed ${seed} left a channel uncovered`).toBe(0);
        expect(
          validateAllocation(result.state).errors.map(issue => issue.message),
          `seed ${seed} broke a hard rule`,
        ).toEqual([]);
      } else {
        refusals++;
        const refusal = refused(result);
        expect((refusal as { state?: unknown }).state, `seed ${seed} returned a board with a refusal`).toBeUndefined();
        expect(refusal.error.length, `seed ${seed} refused without an explanation`).toBeGreaterThan(0);
      }
    }

    // Both outcomes must actually occur, or the property proves nothing.
    expect(planned).toBeGreaterThan(0);
    expect(refusals).toBeGreaterThan(0);
    // Budget: 120ms of restarts each, plus validation. Generous, but it does
    // catch a pruning change that makes the search explore the whole tree.
    expect(Date.now() - startedAt).toBeLessThan(runs * 400);
  }, 120_000);

  it("stays inside its time budget on an impossible night", () => {
    const state = night({
      people: team(4, { tso: [1] }),
      channels: DEFAULT_CHANNEL_CODES.map((code, index) =>
        channel(code, { starterKey: index === 4 ? "p1" : `p${index + 1}` }),
      ),
    });

    const startedAt = Date.now();
    const result = generateAllocation(state, { budgetMs: 500 });
    expect(result.ok).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(5000);
  }, 30_000);
});
