import { describe, expect, it } from "vitest";
import { DEFAULT_CHANNEL_CODES, NIGHT_SPAN_MIN, SLOT_MIN } from "../constants";
import { generateAllocation } from "../solver";
import { canTakeChannel, isFixedDuty, uncoveredMinutes, validateAllocation } from "../rules";
import { isAvailableAt } from "../availability";
import { channel, dbSlot, night, refused, team } from "./fixtures";
import type { HalfKey, NightAllocationState, NightPerson } from "../types";

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

/**
 * The same night with part-night times and DB slots on top: about a third of
 * the crew away for a stretch or around for only part of the night, and every
 * other night a DB slot somewhere, instructed by whoever the dice pick. Some of
 * those slots are unsound on purpose — the generator must refuse them with a
 * reason, not plan around them.
 */
function randomNightWithTimes(seed: number): NightAllocationState {
  const state = randomNight(seed);
  const random = mulberry32(seed * 7919 + 17);
  const slot = (value: number) => Math.floor(value / SLOT_MIN) * SLOT_MIN;

  const people: NightPerson[] = state.people.map(person => {
    const roll = random();
    if (roll >= 0.35) return person;
    if (roll < 0.2) {
      const start = slot(random() * (NIGHT_SPAN_MIN - 60));
      const end = Math.min(NIGHT_SPAN_MIN, start + slot(30 + random() * 150));
      return { ...person, availability: { mode: "except", periods: [[start, end]] } };
    }
    const start = slot(random() * 360);
    const end = Math.min(NIGHT_SPAN_MIN, start + slot(180 + random() * 300));
    return { ...person, availability: { mode: "only", periods: [[start, end]] } };
  });

  // A starter away at their position's opening is refused before any search,
  // which would leave most of these nights proving nothing about the search.
  const channels = state.channels.map(entry => {
    const starter = people.find(person => person.key === entry.starterKey);
    return starter && !isAvailableAt(starter, entry.openAt) ? { ...entry, starterKey: null } : entry;
  });

  const duties = [];
  if (random() < 0.5) {
    const open = channels.filter(entry => entry.inUse && entry.closeAt - entry.openAt >= 60);
    const target = open[Math.floor(random() * open.length)];
    const instructors = people.filter(person => person.available && canTakeChannel(person, target?.code ?? ""));
    if (target && instructors.length) {
      const start = target.openAt + slot(random() * (target.closeAt - target.openAt - 60));
      const end = Math.min(target.closeAt, start + slot(60 + random() * 60));
      const instructor = instructors[Math.floor(random() * instructors.length)];
      duties.push(dbSlot(target.code, instructor.key, start, end, random() < 0.5 ? "Trainee" : null));
    }
  }
  return { ...state, people, channels, duties };
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

  it("keeps to everyone's times and plans around DB slots without moving them", () => {
    const runs = 150;
    let planned = 0;
    let refusals = 0;
    let slotsPlanned = 0;

    for (let seed = 1; seed <= runs; seed++) {
      const state = randomNightWithTimes(seed);
      const slots = state.duties.filter(isFixedDuty);
      const result = generateAllocation(state, { budgetMs: 100, seed });

      if (result.ok) {
        planned++;
        if (slots.length) slotsPlanned++;
        expect(uncoveredMinutes(result.state), `seed ${seed} left a channel uncovered`).toBe(0);
        expect(
          validateAllocation(result.state).errors.map(issue => issue.message),
          `seed ${seed} broke a hard rule`,
        ).toEqual([]);
        expect(result.state.duties.filter(isFixedDuty), `seed ${seed} moved a DB slot`).toEqual(slots);
      } else {
        refusals++;
        expect(refused(result).error.length, `seed ${seed} refused without an explanation`).toBeGreaterThan(0);
      }
    }

    expect(planned).toBeGreaterThan(0);
    expect(refusals).toBeGreaterThan(0);
    // Plans with a slot in them must actually occur, or the slots prove nothing.
    expect(slotsPlanned).toBeGreaterThan(0);
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
