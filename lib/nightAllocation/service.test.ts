import { describe, expect, it } from "vitest";
import { NIGHT_DATE_PATTERN, parseIncomingState, validate } from "./service.js";

/**
 * The API's structural gate. Everything that arrives over the wire passes
 * through `parseIncomingState` before the rules see it, so this is where a
 * malformed or hostile payload has to be made harmless — the rules themselves
 * then decide whether the night may be saved.
 */
describe("night date", () => {
  it("accepts an ISO date and nothing else", () => {
    expect(NIGHT_DATE_PATTERN.test("2026-09-17")).toBe(true);
    expect(NIGHT_DATE_PATTERN.test("17-09-2026")).toBe(false);
    expect(NIGHT_DATE_PATTERN.test("2026-09-17'; DROP TABLE")).toBe(false);
  });
});

describe("parseIncomingState", () => {
  const body = {
    state: {
      nightDate: "1999-01-01",
      version: 3,
      dutyLengthPref: 90,
      status: "final",
      people: [
        {
          key: "p1",
          userId: "11111111-1111-1111-1111-111111111111",
          name: "Person One",
          code: "P1",
          role: "ATCO",
          available: true,
          canTakeTso: true,
          half: "1st",
          manual: false,
          colorIndex: 0,
        },
      ],
      channels: [{ code: "TWR", inUse: true, openAt: 0, closeAt: 720, starterKey: "p1" }],
      duties: [{ id: "d1", channelCode: "TWR", personKey: "p1", startMin: 0, endMin: 120 }],
    },
  };

  it("keeps a well-formed state intact", () => {
    const state = parseIncomingState("2026-09-17", body);
    expect(state.people).toHaveLength(1);
    expect(state.channels[0].starterKey).toBe("p1");
    expect(state.duties[0].endMin).toBe(120);
    expect(state.status).toBe("final");
    expect(state.version).toBe(3);
  });

  it("takes the night date from the route, not the body", () => {
    expect(parseIncomingState("2026-09-17", body).nightDate).toBe("2026-09-17");
  });

  it("clamps times into the night", () => {
    const state = parseIncomingState("2026-09-17", {
      state: { ...body.state, duties: [{ id: "d", channelCode: "TWR", personKey: "p1", startMin: -500, endMin: 9999 }] },
    });
    expect(state.duties[0].startMin).toBe(0);
    expect(state.duties[0].endMin).toBe(720);
  });

  it("rejects an unknown half and an out-of-range duty length preference", () => {
    const state = parseIncomingState("2026-09-17", {
      state: {
        ...body.state,
        dutyLengthPref: 400,
        people: [{ ...body.state.people[0], half: "3rd" }],
      },
    });
    expect(state.people[0].half).toBeNull();
    expect(state.dutyLengthPref).toBe(0);
  });

  it("drops entries with no key and falls back to the default channels", () => {
    const state = parseIncomingState("2026-09-17", {
      state: { ...body.state, people: [{ name: "No key" }], channels: "not an array" },
    });
    expect(state.people).toEqual([]);
    expect(state.channels.map(channel => channel.code)).toEqual(["TWR", "SMC-S", "SMC-N", "CLD", "TSO"]);
  });

  it("survives an empty body", () => {
    const state = parseIncomingState("2026-09-17", undefined);
    expect(state.duties).toEqual([]);
    expect(state.version).toBe(0);
    expect(state.status).toBe("draft");
  });

  it("caps the size of a payload", () => {
    const duties = Array.from({ length: 900 }, (_, index) => ({
      id: `d${index}`,
      channelCode: "TWR",
      personKey: "p1",
      startMin: 0,
      endMin: 30,
    }));
    expect(parseIncomingState("2026-09-17", { state: { ...body.state, duties } }).duties).toHaveLength(500);
  });

  it("truncates oversized strings rather than storing them", () => {
    const state = parseIncomingState("2026-09-17", {
      state: { ...body.state, people: [{ ...body.state.people[0], name: "x".repeat(500) }] },
    });
    expect(state.people[0].name).toHaveLength(120);
  });
});

describe("server-side validation", () => {
  it("refuses a night with an uncovered channel, whatever the client claims", () => {
    const state = parseIncomingState("2026-09-17", {
      state: {
        people: [{ key: "p1", name: "Person One", available: true, canTakeTso: true }],
        channels: [{ code: "TWR", inUse: true, openAt: 0, closeAt: 720, starterKey: "p1" }],
        duties: [{ id: "d1", channelCode: "TWR", personKey: "p1", startMin: 0, endMin: 120 }],
      },
    });
    const result = validate(state);
    expect(result.errors.some(issue => issue.message.includes("has no one on duty"))).toBe(true);
  });

  it("refuses CLD 'merged' into itself to dodge cover 19:00–21:30", () => {
    const people = ["p1", "p2", "p3", "p4"].map(key => ({ key, name: key, available: true }));
    const cover = (code: string, keys: string[], spans: Array<[number, number]>) =>
      spans.map(([startMin, endMin], index) => ({
        id: `${code}${index}`,
        channelCode: code,
        personKey: keys[index % keys.length],
        startMin,
        endMin,
      }));
    const state = parseIncomingState("2026-09-17", {
      state: {
        people,
        channels: [
          { code: "TWR", inUse: true, openAt: 0, closeAt: 720 },
          { code: "CLD", inUse: true, openAt: 0, closeAt: 720, mergedInto: "CLD" },
        ],
        duties: [
          ...cover("TWR", ["p1", "p2"], [[0, 120], [120, 240], [240, 360], [360, 480], [480, 600], [600, 720]]),
          // Nobody on CLD 19:00–21:30.
          ...cover("CLD", ["p3", "p4"], [[0, 120], [120, 240], [240, 330], [480, 600], [600, 720]]),
        ],
      },
    });
    const messages = validate(state).errors.map(issue => issue.message);
    expect(messages).toContain("CLD can only merge into SMC, SMC-S or SMC-N, not CLD.");
    expect(messages.some(message => message.includes("CLD has no one on duty 19:00–21:30"))).toBe(true);
  });

  it("refuses an unqualified person on TSO", () => {
    const state = parseIncomingState("2026-09-17", {
      state: {
        people: [{ key: "p1", name: "Person One", available: true, canTakeTso: false }],
        channels: [{ code: "TSO", inUse: true, openAt: 0, closeAt: 120, starterKey: "p1" }],
        duties: [{ id: "d1", channelCode: "TSO", personKey: "p1", startMin: 0, endMin: 120 }],
      },
    });
    expect(validate(state).errors.some(issue => issue.message.includes("able to take TSO"))).toBe(true);
  });
});

describe("DB slots and part-night times over the wire", () => {
  const person = {
    key: "p1",
    name: "Person One",
    available: true,
    availability: { mode: "except", periods: [[240, 360], [-100, 30], [500, 400]] },
  };

  it("keeps a DB slot's kind and trainee note, and nothing like it on an ordinary duty", () => {
    const state = parseIncomingState("2026-09-17", {
      state: {
        people: [person],
        channels: [{ code: "TWR", inUse: true, openAt: 0, closeAt: 720 }],
        duties: [
          { id: "db1", channelCode: "TWR", personKey: "p1", startMin: 240, endMin: 360, kind: "db", note: " Sulagna " },
          { id: "d1", channelCode: "TWR", personKey: "p1", startMin: 0, endMin: 120, kind: "vip", note: "ignored" },
        ],
      },
    });
    expect(state.duties[0]).toMatchObject({ kind: "db", note: "Sulagna" });
    expect(state.duties[1].kind).toBeUndefined();
    expect(state.duties[1].note).toBeUndefined();
  });

  it("bounds a trainee note however long it arrives", () => {
    const state = parseIncomingState("2026-09-17", {
      state: {
        people: [person],
        duties: [{ id: "db1", channelCode: "TWR", personKey: "p1", startMin: 240, endMin: 360, kind: "db", note: "x".repeat(5000) }],
      },
    });
    expect(state.duties[0].note).toHaveLength(40);
  });

  it("tidies part-night times into the night and drops ones that make no sense", () => {
    const state = parseIncomingState("2026-09-17", { state: { people: [person] } });
    expect(state.people[0].availability).toEqual({ mode: "except", periods: [[0, 30], [240, 360]] });

    const nonsense = parseIncomingState("2026-09-17", {
      state: { people: [{ ...person, availability: { mode: "whenever", periods: [[0, 60]] } }] },
    });
    expect(nonsense.people[0].availability).toBeNull();
  });

  it("refuses to save a duty in time someone is away", () => {
    const state = parseIncomingState("2026-09-17", {
      state: {
        people: [person, { key: "p2", name: "Person Two", available: true }],
        channels: [{ code: "TWR", inUse: true, openAt: 180, closeAt: 300 }],
        duties: [{ id: "d1", channelCode: "TWR", personKey: "p1", startMin: 180, endMin: 300 }],
      },
    });
    expect(validate(state).errors.map(issue => issue.message)).toContain(
      "Person One isn't available 17:30–18:30 but has TWR 16:30–18:30.",
    );
  });
});
