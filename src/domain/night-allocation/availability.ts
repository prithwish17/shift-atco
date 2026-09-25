/**
 * Night Channel Allocation — part-night availability.
 *
 * Someone can be on the crew for only part of the night: available only
 * 13:30–17:30, say, or away 17:30–19:30 and again 23:30–01:30. The person
 * carries what was entered (`PersonAvailability`); everything else — the rules,
 * the solver, the board — asks this module for the stretches they are away and
 * never reads the periods directly, so "only" and "except" cannot be handled
 * differently in two places.
 *
 * Also the parser behind the quick entry box, which takes times the way the
 * roster writes them: `1730-1930`, `not 1730-1930, 2330-0130`, `only till 2130`.
 */
import { MAX_AVAILABILITY_PERIODS, NIGHT_SPAN_MIN, NIGHT_START_MIN, SLOT_MIN } from "./constants.js";
import { formatRange } from "./time.js";
import type { NightPerson, PersonAvailability } from "./types.js";

type Span = [number, number];

/** Sorted, merged and kept inside the night; empty and backwards periods go. */
export function tidyPeriods(periods: ReadonlyArray<readonly [number, number]>): Span[] {
  const inside = periods
    .map(([start, end]) => [Math.max(0, start), Math.min(NIGHT_SPAN_MIN, end)] as Span)
    .filter(([start, end]) => start < end)
    .sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const [start, end] of inside) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/** The parts of the night not in `spans`, which must already be tidy. */
function complement(spans: Span[]): Span[] {
  const out: Span[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    if (start > cursor) out.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < NIGHT_SPAN_MIN) out.push([cursor, NIGHT_SPAN_MIN]);
  return out;
}

/**
 * Whatever arrived — from the page or over the wire — as a clean availability,
 * or null when it restricts nothing. Structural only, like the rest of the
 * API's parsing: it clamps and tidies, and the rules judge what is left.
 */
export function normalizeAvailability(value: unknown): PersonAvailability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { mode?: unknown; periods?: unknown };
  if (raw.mode !== "only" && raw.mode !== "except") return null;
  if (!Array.isArray(raw.periods)) return null;

  const periods = tidyPeriods(
    raw.periods
      // Bounded before any work is done on it: this is read from requests.
      .slice(0, 64)
      .filter((entry): entry is unknown[] => Array.isArray(entry) && entry.length === 2)
      .map(([start, end]) => [Math.round(Number(start)), Math.round(Number(end))] as Span)
      .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end)),
  ).slice(0, MAX_AVAILABILITY_PERIODS);

  if (!periods.length) return null;
  // Available across the whole night is no restriction at all.
  if (raw.mode === "only" && periods.length === 1 && periods[0][0] === 0 && periods[0][1] === NIGHT_SPAN_MIN) {
    return null;
  }
  return { mode: raw.mode, periods };
}

/**
 * Stretches of the night this person can't work, sorted and merged. Someone
 * marked not available is away all night, whatever their periods say.
 */
export function unavailableSpans(person: Pick<NightPerson, "available" | "availability">): Span[] {
  if (!person.available) return [[0, NIGHT_SPAN_MIN]];
  const availability = person.availability;
  if (!availability?.periods?.length) return [];
  const periods = tidyPeriods(availability.periods);
  if (!periods.length) return [];
  return availability.mode === "only" ? complement(periods) : periods;
}

/** Stretches of the night this person can work. */
export function availableSpans(person: Pick<NightPerson, "available" | "availability">): Span[] {
  return complement(unavailableSpans(person));
}

/** Available tonight, but not for all of it. */
export function isPartNight(person: Pick<NightPerson, "available" | "availability">): boolean {
  return person.available && unavailableSpans(person).length > 0;
}

/** Can they be on a position for the whole of `[start, end)`? */
export function isFreeDuring(
  person: Pick<NightPerson, "available" | "availability">,
  start: number,
  end: number,
): boolean {
  return !unavailableSpans(person).some(([from, to]) => start < to && end > from);
}

/** Are they available for the minute starting at `minute`? */
export function isAvailableAt(person: Pick<NightPerson, "available" | "availability">, minute: number): boolean {
  return !unavailableSpans(person).some(([from, to]) => minute >= from && minute < to);
}

/** How many minutes of `[from, to)` they are available for. */
export function minutesAvailable(
  person: Pick<NightPerson, "available" | "availability">,
  from: number,
  to: number,
): number {
  return availableSpans(person).reduce(
    (sum, [start, end]) => sum + Math.max(0, Math.min(to, end) - Math.max(from, start)),
    0,
  );
}

/** The parts of `[start, end)` they are away for, for an error message. */
export function awayDuring(
  person: Pick<NightPerson, "available" | "availability">,
  start: number,
  end: number,
): Span[] {
  return unavailableSpans(person)
    .filter(([from, to]) => start < to && end > from)
    .map(([from, to]) => [Math.max(from, start), Math.min(to, end)] as Span);
}

const rangeList = (spans: Span[]) => spans.map(([start, end]) => formatRange(start, end)).join(", ");

/**
 * One line for a person's availability: "All night", "Only 13:30–17:30",
 * "Away 17:30–19:30, 23:30–01:30".
 */
export function describeAvailability(availability: PersonAvailability | null | undefined): string {
  const periods = availability ? tidyPeriods(availability.periods) : [];
  if (!availability || !periods.length) return "All night";
  return `${availability.mode === "only" ? "Only" : "Away"} ${rangeList(periods)}`;
}

// ── Quick entry ─────────────────────────────────────────────────────────────

/** Where a clock time falls relative to the night, which runs 13:30 → 01:30. */
type ClockPlace =
  | { place: "night"; minute: number }
  /** 01:30–07:30: after the night has ended. */
  | { place: "after" }
  /** 07:30–13:30: before it starts. */
  | { place: "before" };

/**
 * A clock time as the roster writes it — `1730`, `17:30`, `930`, `0130` — or
 * null when it isn't one.
 */
export function readClock(text: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$|^(\d{3,4})$/.exec(text.trim());
  if (!match) return null;
  let hours: number;
  let minutes: number;
  if (match[1] !== undefined) {
    hours = Number(match[1]);
    minutes = Number(match[2]);
  } else {
    const digits = match[3];
    hours = Number(digits.slice(0, digits.length - 2));
    minutes = Number(digits.slice(-2));
  }
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null;
  return { hours: hours % 24, minutes };
}

function placeOf(clock: { hours: number; minutes: number }): ClockPlace {
  const offset = (clock.hours * 60 + clock.minutes - NIGHT_START_MIN + 1440) % 1440;
  if (offset <= NIGHT_SPAN_MIN) return { place: "night", minute: offset };
  // The six hours after 01:30 read as "after the night", the six before 13:30
  // as "before it": 1200-1500 means away until 15:00, not an empty stretch.
  return offset <= NIGHT_SPAN_MIN + (1440 - NIGHT_SPAN_MIN) / 2 ? { place: "after" } : { place: "before" };
}

/** `"1730"` → 240, `"0130"` → 720; null for a time outside 13:30–01:30. */
export function clockToNightMinute(text: string): number | null {
  const clock = readClock(text);
  if (!clock) return null;
  const place = placeOf(clock);
  return place.place === "night" ? place.minute : null;
}

export interface ParsedAvailability {
  /** "all night" or "clear" — drop every period. */
  clear: boolean;
  /** The mode the words asked for, or null when they named none. */
  mode: PersonAvailability["mode"] | null;
  /** Tidy periods, on the 15-minute grid. */
  periods: Span[];
  /** What couldn't be read, in the user's own terms. */
  problems: string[];
  /** What was read but adjusted — rounded onto the grid, or cut to the night. */
  notes: string[];
}

const TIME = String.raw`(\d{1,2}:\d{2}|\d{3,4})`;
const RANGE = new RegExp(String.raw`${TIME}\s*(?:-|–|—|to|till|until|upto)\s*${TIME}`, "gi");
const UNTIL = new RegExp(String.raw`\b(?:till|until|upto|up to|before|by)\s*${TIME}`, "gi");
const FROM = new RegExp(String.raw`\b(?:after|from|since)\s*${TIME}`, "gi");
const LEFTOVER_TIME = new RegExp(TIME, "g");

const AWAY_WORDS = /\b(not|no|except|away|off|busy|unavailable|leave|out|absent|meeting)\b/i;
const ONLY_WORDS = /\b(only|available|avail|present|here|working)\b/i;
const CLEAR_WORDS = /\b(all night|whole night|full night|clear|reset|none)\b/i;

/**
 * Read a line typed into the quick entry box.
 *
 * Understands ranges written the roster's way (`1730-1930`, `17:30 to 19:30`,
 * `(2330-0130)`), open ends (`till 2130`, `after 2330`), several at once, and a
 * word or two saying which way round they are (`not`, `away`, `off`, `only`,
 * `available`). Times are moved onto the 15-minute grid in whichever direction
 * never promises more than was said: an away period only grows, an available
 * one only shrinks.
 */
export function parseAvailabilityText(
  text: string,
  fallbackMode: PersonAvailability["mode"],
): ParsedAvailability {
  const result: ParsedAvailability = { clear: false, mode: null, periods: [], problems: [], notes: [] };
  const input = text.trim();
  if (!input) return result;

  if (AWAY_WORDS.test(input)) result.mode = "except";
  else if (ONLY_WORDS.test(input)) result.mode = "only";
  const mode = result.mode ?? fallbackMode;

  const raw: Array<{ start: ClockPlace; end: ClockPlace; label: string }> = [];
  let rest = input;
  const take = (pattern: RegExp, read: (match: RegExpExecArray) => void) => {
    rest = rest.replace(pattern, (...args) => {
      read(args as unknown as RegExpExecArray);
      return " ";
    });
  };
  const clockPlace = (value: string): ClockPlace | null => {
    const clock = readClock(value);
    return clock ? placeOf(clock) : null;
  };

  take(RANGE, match => {
    const start = clockPlace(match[1]);
    const end = clockPlace(match[2]);
    if (!start || !end) result.problems.push(`"${match[0].trim()}" isn't a time range like 1730-1930.`);
    else raw.push({ start, end, label: match[0].trim() });
  });
  take(UNTIL, match => {
    const end = clockPlace(match[1]);
    if (!end) result.problems.push(`"${match[0].trim()}" isn't a time like 2130.`);
    else raw.push({ start: { place: "night", minute: 0 }, end, label: match[0].trim() });
  });
  take(FROM, match => {
    const start = clockPlace(match[1]);
    if (!start) result.problems.push(`"${match[0].trim()}" isn't a time like 2330.`);
    else raw.push({ start, end: { place: "night", minute: NIGHT_SPAN_MIN }, label: match[0].trim() });
  });

  for (const leftover of rest.match(LEFTOVER_TIME) ?? []) {
    result.problems.push(`Not sure what ${leftover} means on its own. Write a range like 1730-1930.`);
  }

  const periods: Span[] = [];
  let cut = false;
  let rounded = false;
  for (const { start, end, label } of raw) {
    // Before the night starts counts as 13:30 and after it ends as 01:30, so
    // 1200-1500 is away until 15:00. A stretch wholly outside is refused.
    const outside =
      start.place === "after" ||
      end.place === "before" ||
      (start.place === "night" && start.minute === NIGHT_SPAN_MIN) ||
      (end.place === "night" && end.minute === 0);
    if (outside) {
      result.problems.push(`${label} is outside the night (13:30–01:30).`);
      continue;
    }
    const from = start.place === "night" ? start.minute : 0;
    const to = end.place === "night" ? end.minute : NIGHT_SPAN_MIN;
    if (start.place !== "night" || end.place !== "night") cut = true;
    if (from >= to) {
      result.problems.push(`${label} ends before it starts.`);
      continue;
    }

    const away = mode === "except";
    const snappedFrom = (away ? Math.floor(from / SLOT_MIN) : Math.ceil(from / SLOT_MIN)) * SLOT_MIN;
    const snappedTo = (away ? Math.ceil(to / SLOT_MIN) : Math.floor(to / SLOT_MIN)) * SLOT_MIN;
    if (snappedFrom !== from || snappedTo !== to) rounded = true;
    if (snappedFrom >= snappedTo) {
      result.problems.push(`${label} is shorter than the 15-minute grid the night is planned on.`);
      continue;
    }
    periods.push([snappedFrom, snappedTo]);
  }

  result.periods = tidyPeriods(periods);
  if (cut) result.notes.push("Times outside 13:30–01:30 were kept to the night.");
  if (rounded) {
    result.notes.push(
      mode === "except"
        ? "Rounded out to the 15-minute grid, so the time away is never shorter than you typed."
        : "Rounded in to the 15-minute grid, so the time available is never longer than you typed.",
    );
  }
  if (!raw.length && !result.problems.length && CLEAR_WORDS.test(input)) result.clear = true;
  if (!raw.length && !result.problems.length && !result.clear) {
    result.problems.push("No times found. Type them like 1730-1930, or 2330-0130 after midnight.");
  }
  return result;
}
