import { describe, expect, it } from "vitest";
import {
  cleanDbNote,
  dbSlots,
  dbTag,
  placeDbSlot,
  removeDbSlot,
  reviewDbSlot,
  type DbSlotDraft,
} from "../db-slots";
import { isPlanned, uncoveredMinutes, validateAllocation } from "../rules";
import { accepted, channel, dbSlot, duty, messages, night, person, refused, team } from "./fixtures";
import type { NightAllocationState } from "../types";

/** TWR 17:30–19:30 with p1 instructing — the example the office gave. */
const twrDb = (overrides: Partial<DbSlotDraft> = {}): DbSlotDraft => ({
  channelCode: "TWR",
  personKey: "p1",
  startMin: 240,
  endMin: 360,
  note: "",
  ...overrides,
});

/** Nothing planned yet: four people, TWR and CLD all night. */
function setupNight(): NightAllocationState {
  return night({ people: team(4, { tso: [4] }), channels: [channel("TWR"), channel("CLD"), channel("TSO")] });
}

/** TWR covered end to end by alternating duties, the other positions closed. */
function plannedNight(): NightAllocationState {
  return night({
    people: team(4),
    channels: [channel("TWR")],
    duties: [
      duty("TWR", "p2", 0, 120),
      duty("TWR", "p3", 120, 210),
      duty("TWR", "p4", 210, 300),
      duty("TWR", "p2", 300, 420),
      duty("TWR", "p3", 420, 540),
      duty("TWR", "p4", 540, 660),
      duty("TWR", "p2", 660, 720),
    ],
  });
}

describe("putting a DB slot down before anything is planned", () => {
  it("keeps the position for the instructor, marked as a DB", () => {
    const result = accepted(placeDbSlot(setupNight(), twrDb({ note: "Sulagna" })));
    const [slot] = dbSlots(result.state);
    expect(slot).toMatchObject({ channelCode: "TWR", personKey: "p1", startMin: 240, endMin: 360, kind: "db" });
    expect(slot.note).toBe("Sulagna");
    expect(result.note).toBe("DB slot on TWR 17:30–19:30, with Person 1 instructing.");
  });

  it("leaves the night unplanned, so nothing else reads as uncovered", () => {
    const { state } = accepted(placeDbSlot(setupNight(), twrDb()));
    expect(isPlanned(state)).toBe(false);
    expect(messages(validateAllocation(state).errors)).toEqual([]);
  });

  it("asks for the instructor", () => {
    expect(reviewDbSlot(setupNight(), twrDb({ personKey: "" })).problems).toEqual(["Select the instructor."]);
    expect(refused(placeDbSlot(setupNight(), twrDb({ personKey: "" }))).problems).toEqual(["Select the instructor."]);
  });
});

describe("a slot that can't work on its own terms", () => {
  it("is refused when the instructor is away then", () => {
    const state = setupNight();
    state.people[0] = { ...state.people[0], availability: { mode: "except", periods: [[270, 330]] } };
    const refusal = refused(placeDbSlot(state, twrDb()));
    expect(refusal.problems[0]).toBe("Person 1 isn't available 18:00–19:00 but has TWR 17:30–19:30.");
  });

  it("is refused on TSO for an instructor not cleared for it", () => {
    const refusal = refused(placeDbSlot(setupNight(), twrDb({ channelCode: "TSO" })));
    expect(refusal.problems.some(problem => problem.includes("isn't marked as able to take TSO"))).toBe(true);
  });

  it("is refused past two hours on a capped position, like any duty", () => {
    const refusal = refused(placeDbSlot(setupNight(), twrDb({ endMin: 390 })));
    expect(refusal.problems.some(problem => problem.includes("A duty can be at most 2h"))).toBe(true);
  });

  it("is refused for an instructor in the other half", () => {
    const state = setupNight();
    state.people[0] = { ...state.people[0], half: "2nd" };
    const refusal = refused(placeDbSlot(state, twrDb()));
    expect(refusal.problems.some(problem => problem.includes("falls in the 1st Half"))).toBe(true);
  });

  it("is refused on top of another DB slot, or with the instructor on two at once", () => {
    const first = accepted(placeDbSlot(setupNight(), twrDb())).state;
    expect(refused(placeDbSlot(first, twrDb({ personKey: "p2", startMin: 300, endMin: 420 }))).problems[0]).toContain(
      "TWR has two people",
    );
    expect(refused(placeDbSlot(first, twrDb({ channelCode: "CLD" }))).problems[0]).toContain(
      "is on TWR and CLD at the same time",
    );
  });

  it("warns, without refusing, about a stretch left too short to cover", () => {
    const state = night({ people: team(4), channels: [channel("TWR", { openAt: 225 })] });
    const review = reviewDbSlot(state, twrDb());
    expect(review.problems).toEqual([]);
    expect(review.notices).toEqual([
      "TWR 17:15–17:30 is only 15 min, between its opening and a DB slot — too short for a duty. Move the DB slot, " +
        "or change when TWR opens or closes.",
    ]);
  });
});

describe("putting a DB slot into a planned night", () => {
  it("cuts the plan back to make room, with no gap", () => {
    const before = plannedNight();
    const { state, note } = accepted(placeDbSlot(before, twrDb()));

    expect(uncoveredMinutes(state)).toBe(0);
    const twr = state.duties.filter(entry => entry.channelCode === "TWR").sort((a, b) => a.startMin - b.startMin);
    expect(twr.map(entry => [entry.personKey, entry.startMin, entry.endMin, entry.kind ?? "duty"])).toEqual([
      ["p2", 0, 120, "duty"],
      ["p3", 120, 210, "duty"],
      ["p4", 210, 240, "duty"],
      ["p1", 240, 360, "db"],
      ["p2", 360, 420, "duty"],
      ["p3", 420, 540, "duty"],
      ["p4", 540, 660, "duty"],
      ["p2", 660, 720, "duty"],
    ]);
    expect(note).toContain("Made room on TWR by cutting back 2 duties.");
  });

  it("keeps a duty that spans the whole slot either side of it", () => {
    const state = night({
      people: team(3),
      channels: [channel("TSO", { openAt: 0, closeAt: 480 })],
      duties: [duty("TSO", "p2", 0, 480)],
    });
    state.people = state.people.map(entry => ({ ...entry, canTakeTso: true }));
    const { state: next } = accepted(placeDbSlot(state, twrDb({ channelCode: "TSO" })));
    const pieces = next.duties.filter(entry => entry.personKey === "p2").map(entry => [entry.startMin, entry.endMin]);
    expect(pieces).toEqual([
      [0, 240],
      [360, 480],
    ]);
    expect(uncoveredMinutes(next)).toBe(0);
  });

  it("goes down even when the instructor is busy in the plan, and says to generate again", () => {
    const state = plannedNight();
    // The instructor, p1, already holds SMC-S for the whole of the slot.
    state.channels.push(channel("SMC-S", { openAt: 240, closeAt: 360 }));
    state.duties.push(duty("SMC-S", "p1", 240, 360));

    const review = reviewDbSlot(state, twrDb());
    expect(review.problems).toEqual([]);
    expect(review.clashes.some(clash => clash.includes("is on SMC-S and TWR at the same time"))).toBe(true);

    const placed = accepted(placeDbSlot(state, twrDb()));
    expect(placed.note).toContain("Generate again to plan around it.");
  });
});

describe("moving and removing a slot", () => {
  it("keeps the slot's identity when it is moved", () => {
    const first = accepted(placeDbSlot(setupNight(), twrDb())).state;
    const [slot] = dbSlots(first);
    const moved = accepted(placeDbSlot(first, { ...twrDb({ startMin: 300, endMin: 420 }), id: slot.id })).state;
    expect(dbSlots(moved).map(entry => [entry.id, entry.startMin, entry.endMin])).toEqual([[slot.id, 300, 420]]);
  });

  it("leaves the stretch uncovered on a planned night, and says so", () => {
    const placed = accepted(placeDbSlot(plannedNight(), twrDb())).state;
    const [slot] = dbSlots(placed);
    const { state, note } = removeDbSlot(placed, slot.id);
    expect(dbSlots(state)).toEqual([]);
    expect(uncoveredMinutes(state)).toBe(120);
    expect(note).toBe(
      "DB slot on TWR 17:30–19:30 removed. TWR needs cover 17:30–19:30 now — generate again or add a duty there.",
    );
  });

  it("ignores an id that isn't a DB slot", () => {
    const state = plannedNight();
    expect(removeDbSlot(state, state.duties[0].id).state).toBe(state);
  });
});

describe("the label and the note", () => {
  it("reads DB, or DB and the trainee", () => {
    expect(dbTag(dbSlot("TWR", "p1", 240, 360))).toBe("DB");
    expect(dbTag(dbSlot("TWR", "p1", 240, 360, "Sulagna"))).toBe("DB · Sulagna");
    expect(dbTag(duty("TWR", "p1", 240, 360))).toBeNull();
  });

  it("keeps a trainee note short and whole", () => {
    expect(cleanDbNote("  Sulagna   Roy ")).toBe("Sulagna Roy");
    expect(cleanDbNote("")).toBeNull();
    expect(cleanDbNote(42)).toBeNull();
    expect(cleanDbNote("x".repeat(80))).toHaveLength(40);
    // An emoji straddling the limit goes whole, never as half a surrogate pair.
    const note = cleanDbNote(`${"x".repeat(39)}🎓🎓`) as string;
    expect(Array.from(note)).toHaveLength(40);
    expect(note.endsWith("🎓")).toBe(true);
  });

  it("orders slots by position, then time", () => {
    const state = night({
      people: [person("p1"), person("p2")],
      channels: [channel("TWR"), channel("CLD")],
      duties: [dbSlot("CLD", "p1", 0, 60), dbSlot("TWR", "p2", 300, 360), dbSlot("TWR", "p1", 120, 180)],
    });
    expect(dbSlots(state).map(entry => `${entry.channelCode}@${entry.startMin}`)).toEqual([
      "TWR@120",
      "TWR@300",
      "CLD@0",
    ]);
  });
});
