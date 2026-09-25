import { describe, expect, it } from "vitest";
import {
  availableSpans,
  clockToNightMinute,
  describeAvailability,
  isAvailableAt,
  isFreeDuring,
  minutesAvailable,
  normalizeAvailability,
  parseAvailabilityText,
  unavailableSpans,
} from "../availability";
import { person } from "./fixtures";

/** Someone around for part of the night — the shape every check here reads. */
const partNight = (mode: "only" | "except", periods: Array<[number, number]>) =>
  person("p1", { availability: { mode, periods } });

describe("the stretches someone is away", () => {
  it("is nothing for someone around all night", () => {
    expect(unavailableSpans(person("p1"))).toEqual([]);
    expect(availableSpans(person("p1"))).toEqual([[0, 720]]);
  });

  it("is the whole night for someone marked not available, whatever their times say", () => {
    const away = person("p1", { available: false, availability: { mode: "only", periods: [[0, 240]] } });
    expect(unavailableSpans(away)).toEqual([[0, 720]]);
  });

  it("is the periods themselves when they say when someone is away", () => {
    expect(unavailableSpans(partNight("except", [[600, 720], [240, 360]]))).toEqual([
      [240, 360],
      [600, 720],
    ]);
  });

  it("is everything but the periods when they say when someone is around", () => {
    expect(unavailableSpans(partNight("only", [[0, 240], [360, 480]]))).toEqual([
      [240, 360],
      [480, 720],
    ]);
  });

  it("merges periods that touch or overlap", () => {
    expect(unavailableSpans(partNight("except", [[240, 300], [300, 360], [330, 420]]))).toEqual([[240, 420]]);
  });
});

describe("asking about a moment or a stretch", () => {
  const someone = partNight("except", [[240, 360]]);

  it("treats the end of a period as the moment they are back", () => {
    expect(isAvailableAt(someone, 239)).toBe(true);
    expect(isAvailableAt(someone, 240)).toBe(false);
    expect(isAvailableAt(someone, 359)).toBe(false);
    expect(isAvailableAt(someone, 360)).toBe(true);
  });

  it("lets a duty end exactly when they leave and start exactly when they are back", () => {
    expect(isFreeDuring(someone, 120, 240)).toBe(true);
    expect(isFreeDuring(someone, 360, 480)).toBe(true);
    expect(isFreeDuring(someone, 180, 300)).toBe(false);
  });

  it("counts the minutes of a window they are around for", () => {
    expect(minutesAvailable(someone, 240, 480)).toBe(120);
    expect(minutesAvailable(someone, 0, 720)).toBe(600);
  });
});

describe("normalizing what arrives", () => {
  it("drops anything that isn't a mode and a list of periods", () => {
    expect(normalizeAvailability(null)).toBeNull();
    expect(normalizeAvailability("away")).toBeNull();
    expect(normalizeAvailability({ mode: "sometimes", periods: [[0, 60]] })).toBeNull();
    expect(normalizeAvailability({ mode: "except", periods: "17:30" })).toBeNull();
  });

  it("clamps periods into the night, drops backwards ones and merges the rest", () => {
    expect(
      normalizeAvailability({ mode: "except", periods: [[-50, 60], [300, 200], [60, 90], ["x", 10], [700, 9999]] }),
    ).toEqual({ mode: "except", periods: [[0, 90], [700, 720]] });
  });

  it("reads no periods, or around all night, as no restriction at all", () => {
    expect(normalizeAvailability({ mode: "except", periods: [] })).toBeNull();
    expect(normalizeAvailability({ mode: "only", periods: [[0, 720]] })).toBeNull();
  });

  it("keeps a bounded number of periods, whatever a request sends", () => {
    const periods = Array.from({ length: 500 }, (_, index) => [index * 2, index * 2 + 1]);
    expect(normalizeAvailability({ mode: "except", periods })?.periods.length).toBe(8);
  });
});

describe("one line for the crew list", () => {
  it("says all night, only, or away", () => {
    expect(describeAvailability(null)).toBe("All night");
    expect(describeAvailability({ mode: "only", periods: [[0, 240]] })).toBe("Only 13:30–17:30");
    expect(describeAvailability({ mode: "except", periods: [[600, 720], [240, 360]] })).toBe(
      "Away 17:30–19:30, 23:30–01:30",
    );
  });
});

describe("clock times", () => {
  it("reads them the way the roster writes them", () => {
    expect(clockToNightMinute("1330")).toBe(0);
    expect(clockToNightMinute("17:30")).toBe(240);
    expect(clockToNightMinute("0000")).toBe(630);
    expect(clockToNightMinute("2400")).toBe(630);
    expect(clockToNightMinute("0130")).toBe(720);
  });

  it("has no minute for a time outside the night, or for nonsense", () => {
    expect(clockToNightMinute("1200")).toBeNull();
    expect(clockToNightMinute("0200")).toBeNull();
    expect(clockToNightMinute("2575")).toBeNull();
    expect(clockToNightMinute("soon")).toBeNull();
  });
});

describe("the quick entry box", () => {
  it("reads several ranges at once, after midnight included", () => {
    const parsed = parseAvailabilityText("1730-1930, 2330-0130", "except");
    expect(parsed.problems).toEqual([]);
    expect(parsed.mode).toBeNull();
    expect(parsed.periods).toEqual([
      [240, 360],
      [600, 720],
    ]);
  });

  it("takes the way round from the words in front", () => {
    expect(parseAvailabilityText("not 1730-1930", "only").mode).toBe("except");
    expect(parseAvailabilityText("away 1730-1930", "only").mode).toBe("except");
    expect(parseAvailabilityText("unavailable 1730-1930", "only").mode).toBe("except");
    expect(parseAvailabilityText("only 1330-2130", "except").mode).toBe("only");
    expect(parseAvailabilityText("available 1330-2130", "except").mode).toBe("only");
    expect(parseAvailabilityText("not available 1730-1930", "only").mode).toBe("except");
  });

  it("understands the roster's parentheses, colons and 'to'", () => {
    expect(parseAvailabilityText("(2330-0130)", "except").periods).toEqual([[600, 720]]);
    expect(parseAvailabilityText("17:30 to 19:30", "except").periods).toEqual([[240, 360]]);
    expect(parseAvailabilityText("1730 – 1930", "except").periods).toEqual([[240, 360]]);
  });

  it("reads open ends to the start or the end of the night", () => {
    const until = parseAvailabilityText("only till 2130", "except");
    expect(until.mode).toBe("only");
    expect(until.periods).toEqual([[0, 480]]);
    expect(parseAvailabilityText("away after 2330", "only").periods).toEqual([[600, 720]]);
  });

  it("keeps a range that starts before the night to the night, and says so", () => {
    const parsed = parseAvailabilityText("1200-1500", "except");
    expect(parsed.periods).toEqual([[0, 90]]);
    expect(parsed.notes.some(note => note.includes("kept to the night"))).toBe(true);
  });

  it("refuses a range wholly outside the night", () => {
    const parsed = parseAvailabilityText("0200-0400", "except");
    expect(parsed.periods).toEqual([]);
    expect(parsed.problems[0]).toContain("outside the night");
  });

  it("rounds away time out and available time in, so neither promises more than was said", () => {
    const away = parseAvailabilityText("1740-1920", "except");
    expect(away.periods).toEqual([[240, 360]]);
    const around = parseAvailabilityText("1740-1920", "only");
    expect(around.periods).toEqual([[255, 345]]);
    expect(away.notes.length && around.notes.length).toBeTruthy();
  });

  it("says what it couldn't read", () => {
    expect(parseAvailabilityText("1930-1730", "except").problems[0]).toContain("ends before it starts");
    expect(parseAvailabilityText("1730", "except").problems[0]).toContain("1730");
    expect(parseAvailabilityText("in a meeting", "except").problems[0]).toContain("No times found");
  });

  it("clears on 'all night'", () => {
    const parsed = parseAvailabilityText("all night", "except");
    expect(parsed.clear).toBe(true);
    expect(parsed.problems).toEqual([]);
  });
});
