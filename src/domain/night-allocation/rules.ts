/**
 * Night Channel Allocation — the rule set.
 *
 * This is the authoritative implementation. The browser runs it to keep the
 * Save button honest and to explain edits before they are applied; the API runs
 * the same functions on every save so a hand-rolled request cannot write a
 * roster with a gap in it. Client and server therefore cannot disagree.
 *
 * Hard rules (errors) block saving. Preferences and staffing notices (warnings)
 * never do — they explain why a night is awkward, they do not forbid it.
 */
import {
  BREAK_EXEMPT_CHANNELS,
  CROSS_HALF_CHANNEL,
  DEFAULT_CHANNEL_CODES,
  EVENING_REST_EXEMPT_CHANNELS,
  EVENING_REST_MIN,
  EVENING_REST_WINDOW,
  FIRST_HALF,
  MAX_DUTY_MIN,
  MERGE_SOURCE_CHANNEL,
  MERGE_TARGET_CHANNELS,
  MERGE_WINDOW,
  MIN_BREAK_MIN,
  MIN_DUTY_MIN,
  NIGHT_SPAN_MIN,
  PREFERRED_DUTY_LENGTHS,
  PREFERRED_MIN_DUTY_MIN,
  RESTRICTED_CHANNELS,
  SECOND_HALF,
  SECOND_HALF_PREFERRED_CHANNEL,
  SLOT_MIN,
  TSO_CHANNEL,
  UNCAPPED_DUTY_CHANNELS,
} from "./constants.js";
import { formatDuration, formatMinutes, formatRange } from "./time.js";
import { awayDuring, isAvailableAt, isPartNight, minutesAvailable } from "./availability.js";
import type {
  HalfKey,
  NightAllocationState,
  NightChannel,
  NightDuty,
  NightPerson,
  RuleIssue,
  ValidationResult,
} from "./types.js";

// ── Small shared helpers ────────────────────────────────────────────────────

/** A fresh set of channels for a night nobody has configured yet. */
export function defaultChannels(): NightChannel[] {
  return DEFAULT_CHANNEL_CODES.map(code => ({
    code,
    inUse: true,
    openAt: 0,
    closeAt: NIGHT_SPAN_MIN,
    starterKey: null,
    mergedInto: null,
  }));
}

// ── Merging CLD into SMC ────────────────────────────────────────────────────

/** The SMC this night's CLD would fold into, or null when there isn't one. */
export function mergeTargetFor(state: NightAllocationState): string | null {
  for (const code of MERGE_TARGET_CHANNELS) {
    const channel = state.channels.find(entry => entry.code === code);
    if (!channel?.inUse) continue;
    // It can only absorb CLD if it is itself open across the whole window.
    if (channel.openAt > MERGE_WINDOW[0] || channel.closeAt < MERGE_WINDOW[1]) continue;
    return code;
  }
  return null;
}

/**
 * Is CLD currently folded into an SMC? Returns the pair, or null.
 *
 * Only a pairing the rules allow counts. A payload claiming CLD is merged into
 * itself, or into TWR, would otherwise excuse CLD from cover for the whole
 * window; `validateChannels` reports it, and here it simply isn't a merge.
 */
export function activeMerge(
  state: NightAllocationState,
): { source: NightChannel; targetCode: string } | null {
  const source = state.channels.find(entry => entry.code === MERGE_SOURCE_CHANNEL);
  if (!source?.inUse || !source.mergedInto) return null;
  if (!MERGE_TARGET_CHANNELS.includes(source.mergedInto)) return null;
  const target = state.channels.find(entry => entry.code === source.mergedInto);
  if (!target?.inUse) return null;
  return { source, targetCode: target.code };
}

/** The stretch of a channel that needs no cover because it is merged away. */
export function mergedAwayWindow(
  state: NightAllocationState,
  channelCode: string,
): readonly [number, number] | null {
  const merge = activeMerge(state);
  if (!merge || merge.source.code !== channelCode) return null;
  return MERGE_WINDOW;
}

/**
 * Channels in board order: the defaults as `DEFAULT_CHANNEL_CODES` lists them,
 * anything else after them by name. The database returns rows in no particular
 * order, so a saved night is sorted on the way out.
 */
export function inBoardOrder(channels: NightChannel[]): NightChannel[] {
  const codes: readonly string[] = DEFAULT_CHANNEL_CODES;
  const rank = (code: string) => (codes.includes(code) ? codes.indexOf(code) : codes.length);
  return channels.slice().sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}

/** Channels ticked for tonight, in board order. */
export function activeChannels(state: NightAllocationState): NightChannel[] {
  return state.channels.filter(channel => channel.inUse);
}

/** Channels ticked for tonight that are open for a positive stretch. */
export function openChannels(state: NightAllocationState): NightChannel[] {
  return activeChannels(state).filter(channel => channel.openAt < channel.closeAt);
}

export function findPerson(state: NightAllocationState, key: string): NightPerson | undefined {
  return state.people.find(person => person.key === key);
}

export function findChannel(state: NightAllocationState, code: string): NightChannel | undefined {
  return state.channels.find(channel => channel.code === code);
}

/** Someone whose row was deleted still has to be named in an error message. */
export function personName(state: NightAllocationState, key: string): string {
  return findPerson(state, key)?.name ?? "Removed person";
}

export function peopleInHalf(state: NightAllocationState, half: Exclude<HalfKey, null>): NightPerson[] {
  return state.people.filter(person => person.half === half);
}

export function availablePeople(state: NightAllocationState): NightPerson[] {
  return state.people.filter(person => person.available);
}

export function isRestrictedChannel(code: string): boolean {
  return RESTRICTED_CHANNELS.includes(code);
}

/** May this person hold this channel? Only the TSO qualification restricts it. */
export function canTakeChannel(person: NightPerson | undefined, code: string): boolean {
  if (!isRestrictedChannel(code)) return true;
  return !!person?.canTakeTso;
}

/**
 * A short label for a board strip or a by-person row.
 *
 * People seeded from the duty grid carry their employee number as `code`, which
 * is useful in a list but is eight digits of noise on a 40-pixel strip, so
 * anything that is not already a short alphabetic code becomes initials.
 */
export function personShortLabel(person: NightPerson | undefined): string {
  if (!person) return "??";
  const code = (person.code ?? "").trim();
  if (code && code.length <= 4 && !/^\d+$/.test(code)) return code.toUpperCase();
  return (
    person.name
      .split(/\s+/)
      .map(word => word[0] ?? "")
      .join("")
      .slice(0, 3)
      .toUpperCase() || "??"
  );
}

/**
 * The longest a single duty on this position may run.
 *
 * Every position caps at two hours except TSO, which has no cap — see
 * `UNCAPPED_DUTY_CHANNELS`. Callers must use this rather than `MAX_DUTY_MIN`
 * directly, or the rules and the solver will disagree about TSO.
 */
export function maxDutyFor(channelCode: string): number {
  return UNCAPPED_DUTY_CHANNELS.includes(channelCode) ? NIGHT_SPAN_MIN : MAX_DUTY_MIN;
}

/** True when this position has no two-hour cap. */
export function isUncappedChannel(channelCode: string): boolean {
  return UNCAPPED_DUTY_CHANNELS.includes(channelCode);
}

/** True when going onto or coming off this position needs no break. */
export function isBreakExempt(channelCode: string): boolean {
  return BREAK_EXEMPT_CHANNELS.includes(channelCode);
}

/**
 * The break one person needs between a duty on `first` and their next on
 * `second`: 30 minutes, or none at all when either is TSO — relieved from TWR
 * at 15:00, they may take TSO from 15:00. Callers use this rather than
 * `MIN_BREAK_MIN`, or the rules and the solver disagree about TSO.
 */
export function breakBetween(first: string, second: string): number {
  return isBreakExempt(first) || isBreakExempt(second) ? 0 : MIN_BREAK_MIN;
}

/**
 * How well a duty length suits the office: 0 for 1h, 1h 30m or 2h (on a
 * position with no cap, any whole or half hour from 1h up), 1 for anything
 * else of an hour or more, 2 for under an hour.
 */
export function dutyLengthRank(length: number, channelCode: string): 0 | 1 | 2 {
  if (length < PREFERRED_MIN_DUTY_MIN) return 2;
  const preferred = isUncappedChannel(channelCode) ? length % 30 === 0 : PREFERRED_DUTY_LENGTHS.includes(length);
  return preferred ? 0 : 1;
}

export function dutyLength(duty: NightDuty): number {
  return duty.endMin - duty.startMin;
}

// ── DB slots ────────────────────────────────────────────────────────────────

/**
 * A DB slot: fixed in advance, held by its instructor, planned around and
 * never moved. Every hard rule still applies to it — it is the instructor on
 * the position — but nothing moves it as a side effect of anything else.
 */
export function isFixedDuty(duty: Pick<NightDuty, "kind">): boolean {
  return duty.kind === "db";
}

/**
 * Has anything been planned yet? DB slots are entered before a plan is made,
 * so a board holding only those is still an unplanned night, not one with
 * every other stretch uncovered. A blank counts: it is part of a plan.
 */
export function isPlanned(state: NightAllocationState): boolean {
  return state.duties.some(duty => !isFixedDuty(duty));
}

// ── Blanks ──────────────────────────────────────────────────────────────────

/**
 * A stretch of a position left with nobody on it, on purpose. It is not a gap:
 * it covers its stretch for the continuity rule, saves and shares as BLANK,
 * and is listed under suggestions until someone fills it. No rule about
 * people applies to it, because nobody holds it.
 */
export function isBlank(duty: Pick<NightDuty, "kind">): boolean {
  return duty.kind === "blank";
}

/** One person's duties — never a blank, whatever key a blank carries. */
export function dutiesOf(state: NightAllocationState, personKey: string): NightDuty[] {
  return state.duties.filter(duty => duty.personKey === personKey && !isBlank(duty));
}

/** The night's blanks, in board order and then by time. */
export function blanksInBoardOrder(state: NightAllocationState): NightDuty[] {
  const order = inBoardOrder(state.channels).map(channel => channel.code);
  const rank = (code: string) => (order.includes(code) ? order.indexOf(code) : order.length);
  return state.duties
    .filter(isBlank)
    .sort((a, b) => rank(a.channelCode) - rank(b.channelCode) || a.startMin - b.startMin);
}

/** Minutes of open positions left blank — shown beside the cover figure. */
export function blankMinutes(state: NightAllocationState): number {
  const open = new Set(openChannels(state).map(channel => channel.code));
  return state.duties
    .filter(duty => isBlank(duty) && open.has(duty.channelCode))
    .reduce((sum, duty) => sum + Math.max(0, dutyLength(duty)), 0);
}

// ── The evening rest ────────────────────────────────────────────────────────

/** True when a duty on this position neither counts against nor breaks the evening rest. */
export function isEveningRestExempt(channelCode: string): boolean {
  return EVENING_REST_EXEMPT_CHANNELS.includes(channelCode);
}

/**
 * The longest stretch `busy` leaves free that counts as the evening rest: it
 * starts between 16:30 and 23:30 — a break that began earlier counts from
 * 16:30 — and runs on at most to the end of the night.
 */
export function longestEveningBreak(busy: Array<[number, number]>): { from: number; to: number } {
  const [windowStart, windowEnd] = EVENING_REST_WINDOW;
  let best = { from: windowStart, to: windowStart };
  let cursor = windowStart;
  const consider = (to: number) => {
    if (cursor <= windowEnd && to - cursor > best.to - best.from) best = { from: cursor, to };
  };
  for (const [start, end] of mergeIntervals(busy.filter(([start, end]) => start < end))) {
    if (end <= cursor) continue;
    if (start >= NIGHT_SPAN_MIN) break;
    if (start > cursor) consider(start);
    cursor = Math.max(cursor, end);
  }
  if (cursor < NIGHT_SPAN_MIN) consider(NIGHT_SPAN_MIN);
  return best;
}

export interface EveningRestShortfall {
  person: NightPerson;
  /** The longest break that counts, which is under `EVENING_REST_MIN`. */
  longest: { from: number; to: number };
  /** Their duties from 16:30 on that the rest is measured around. */
  dutyIds: string[];
}

/**
 * Everyone without their evening rest: 4 hours in a row off every position
 * but TSO, starting between 16:30 and 23:30. A preference — see
 * `EVENING_REST_WINDOW`. Someone holding nothing but TSO, or nothing at all,
 * has nothing to rest from and is left out.
 */
export function eveningRestShortfalls(state: NightAllocationState): EveningRestShortfall[] {
  const out: EveningRestShortfall[] = [];
  for (const person of state.people) {
    const work = dutiesOf(state, person.key).filter(duty => !isEveningRestExempt(duty.channelCode));
    if (!work.length) continue;
    const longest = longestEveningBreak(work.map(duty => [duty.startMin, duty.endMin] as [number, number]));
    if (longest.to - longest.from >= EVENING_REST_MIN) continue;
    out.push({
      person,
      longest,
      dutyIds: work
        .filter(duty => duty.endMin > EVENING_REST_WINDOW[0])
        .sort((a, b) => a.startMin - b.startMin)
        .map(duty => duty.id),
    });
  }
  return out;
}

/** "longest 2h 30m, 19:00–21:30", or "no break at all", for a shortfall. */
export function describeEveningBreak(longest: { from: number; to: number }): string {
  const length = longest.to - longest.from;
  return length > 0
    ? `longest ${formatDuration(length)}, ${formatRange(longest.from, longest.to)}`
    : "no break at all";
}

/** The DB slot that holds a position's opening minute, if one does. */
export function fixedOpeningDuty(state: NightAllocationState, channel: NightChannel): NightDuty | undefined {
  return state.duties.find(
    duty =>
      isFixedDuty(duty) &&
      duty.channelCode === channel.code &&
      duty.startMin <= channel.openAt &&
      duty.endMin > channel.openAt,
  );
}

/**
 * The stretches of an open position that ordinary duties have to cover: its
 * open window, less any time it is merged away and less its DB slots. This is
 * what the generator plans, one stretch at a time.
 */
export function stretchesToPlan(state: NightAllocationState, channel: NightChannel): Array<[number, number]> {
  if (channel.openAt >= channel.closeAt) return [];
  const blocked: Array<[number, number]> = [];
  const merged = mergedAwayWindow(state, channel.code);
  if (merged) blocked.push([merged[0], merged[1]]);
  for (const duty of state.duties) {
    if (isFixedDuty(duty) && duty.channelCode === channel.code && duty.startMin < duty.endMin) {
      blocked.push([duty.startMin, duty.endMin]);
    }
  }

  const out: Array<[number, number]> = [];
  let cursor = channel.openAt;
  for (const [start, end] of mergeIntervals(blocked)) {
    if (start > cursor) out.push([cursor, Math.min(start, channel.closeAt)]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < channel.closeAt) out.push([cursor, channel.closeAt]);
  return out.filter(([start, end]) => start < end);
}

/**
 * Stretches too short to be anybody's duty. A DB slot, or the merge, can leave
 * one — a position opening at 17:15 with a DB from 17:30 leaves fifteen minutes
 * nothing can legally cover — and the night is then impossible however many
 * people there are, so it is named rather than left for the generator to fail
 * on.
 */
export function shortStretchNotices(state: NightAllocationState): string[] {
  const notices: string[] = [];
  const merge = activeMerge(state);
  for (const channel of openChannels(state)) {
    const fixed = state.duties.filter(duty => isFixedDuty(duty) && duty.channelCode === channel.code);
    const merged = mergedAwayWindow(state, channel.code);
    for (const [start, end] of stretchesToPlan(state, channel)) {
      if (end - start >= MIN_DUTY_MIN) continue;
      // A whole position open under 30 minutes is already a hard error.
      if (start === channel.openAt && end === channel.closeAt) continue;
      const leftDb = fixed.some(duty => duty.endMin === start);
      const rightDb = fixed.some(duty => duty.startMin === end);
      const left = start === channel.openAt ? "its opening" : leftDb ? "a DB slot" : "the merge";
      const right = end === channel.closeAt ? "its closing" : rightDb ? "a DB slot" : "the merge";
      const fix =
        leftDb || rightDb
          ? `Move the DB slot, or change when ${channel.code} opens or closes.`
          : merged && merge
            ? `Change when ${channel.code} opens or closes, or turn the merge off.`
            : `Change when ${channel.code} opens or closes.`;
      notices.push(
        `${channel.code} ${formatRange(start, end)} is only ${end - start} min, between ${left} and ${right} — ` +
          `too short for a duty. ${fix}`,
      );
    }
  }
  return notices;
}

export function overlaps(duty: NightDuty, startMin: number, endMin: number): boolean {
  return duty.startMin < endMin && duty.endMin > startMin;
}

export function halfWindow(half: Exclude<HalfKey, null>): readonly [number, number] {
  return half === "1st" ? FIRST_HALF : SECOND_HALF;
}

/** Union of a set of intervals, as sorted `[start, end]` pairs. */
export function mergeIntervals(spans: Array<[number, number]>): Array<[number, number]> {
  const sorted = spans.slice().sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * Stretches of an open channel with nobody on it.
 *
 * `mergedAway` is the window the channel is folded into another one for — it is
 * covered by that position's holder, so it is not a gap. A blank is not a gap
 * either: it was left empty on purpose, and says so.
 */
export function gapsForChannel(
  duties: NightDuty[],
  channel: NightChannel,
  mergedAway?: readonly [number, number] | null,
): Array<[number, number]> {
  if (channel.openAt >= channel.closeAt) return [];
  const covered = mergeIntervals(
    [
      ...duties
        .filter(duty => duty.channelCode === channel.code && duty.startMin < duty.endMin)
        .map(duty => [duty.startMin, duty.endMin] as [number, number]),
      ...(mergedAway ? [[mergedAway[0], mergedAway[1]] as [number, number]] : []),
    ],
  );
  const gaps: Array<[number, number]> = [];
  let cursor = channel.openAt;
  for (const [start, end] of covered) {
    if (start > cursor && start <= channel.closeAt) gaps.push([cursor, Math.min(start, channel.closeAt)]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < channel.closeAt) gaps.push([cursor, channel.closeAt]);
  return gaps;
}

/**
 * Total minutes of open channel time with nobody on duty. The editing layer
 * compares this before and after a change: an edit that raises it is refused,
 * which is what keeps handovers from silently opening a hole.
 */
export function uncoveredMinutes(state: NightAllocationState): number {
  let total = 0;
  for (const channel of openChannels(state)) {
    total += gapsForChannel(state.duties, channel, mergedAwayWindow(state, channel.code)).reduce(
      (sum, [start, end]) => sum + (end - start),
      0,
    );
  }
  return total;
}

/** Minutes a person is on duty across the night. */
export function minutesOnDuty(state: NightAllocationState, personKey: string): number {
  return dutiesOf(state, personKey).reduce((sum, duty) => sum + Math.max(0, dutyLength(duty)), 0);
}

// ── Staffing feasibility ────────────────────────────────────────────────────

/** Windows staffing is assessed over: before the halves, 1st Half, 2nd Half. */
const STAFFING_WINDOWS: Array<readonly [number, number]> = [
  [0, FIRST_HALF[0]],
  [FIRST_HALF[0], FIRST_HALF[1]],
  [SECOND_HALF[0], SECOND_HALF[1]],
];

/**
 * How many people can work inside a window, given the halves they are in and
 * the part of the night they are available for. Someone away for all but a
 * few minutes of it can't hold a duty there, so they don't count.
 */
function poolForWindow(
  state: NightAllocationState,
  windowStart: number,
  people?: NightPerson[],
  windowEnd?: number,
): number {
  const end = windowEnd ?? STAFFING_WINDOWS.find(([start]) => start === windowStart)?.[1] ?? NIGHT_SPAN_MIN;
  const pool = (people ?? availablePeople(state)).filter(
    person => minutesAvailable(person, windowStart, end) >= MIN_DUTY_MIN,
  );
  // 13:30–17:30 is outside both halves, so everyone available can work it.
  if (windowStart < FIRST_HALF[0]) return pool.length;
  if (windowStart < SECOND_HALF[0]) return pool.filter(person => person.half !== "2nd").length;
  return pool.filter(person => person.half !== "1st").length;
}

/** Most channels open at once inside a window. */
function peakOpenChannels(channels: NightChannel[], windowStart: number, windowEnd: number): number {
  let peak = 0;
  for (let m = windowStart; m < windowEnd; m += SLOT_MIN) {
    peak = Math.max(peak, channels.filter(c => c.openAt <= m && c.closeAt > m).length);
  }
  return peak;
}

/**
 * Why a continuous plan may be impossible, in the office's own terms.
 *
 * The bound: over a long stretch one person can be on a capped position for at
 * most 120 of every 150 minutes (a 2h duty then a 30 min break), so covering
 * `need` channel-minutes inside a window of length `L` takes `need × 150 / 120`
 * minutes of people's time — and never fewer people than channels open at once.
 *
 * TSO has no cap and needs no break either side, so its minutes are added on
 * top, less whatever of them can be worked in those breaks: someone cleared for
 * TSO can spend the 30 minutes after a control duty on TSO instead of resting.
 * That saving is limited by the breaks there are, and by how much of them the
 * people cleared for TSO take — at most a fifth of their time. With nobody to
 * take turns, TSO ties one person up as it always did.
 */
export function staffingNotices(state: NightAllocationState): string[] {
  const channels = openChannels(state);
  const notices: string[] = [];
  if (!channels.length) return notices;

  // Uncapped positions are counted separately: one person can hold TSO for a
  // whole window without a break, so the "120 of every 150 minutes" bound —
  // which exists because of the two-hour cap — does not apply to it.
  const capped = channels.filter(channel => !isUncappedChannel(channel.code));
  const uncapped = channels.filter(channel => isUncappedChannel(channel.code));
  // Of those, the ones that need no break either side can be worked in the
  // breaks between control duties; any other would tie somebody up.
  const restable = uncapped.filter(channel => isBreakExempt(channel.code));
  const tying = uncapped.filter(channel => !isBreakExempt(channel.code));
  const canTakeRestable = availablePeople(state).filter(person =>
    restable.every(channel => canTakeChannel(person, channel.code)),
  );

  const minutesIn = (list: NightChannel[], windowStart: number, windowEnd: number) =>
    list.reduce(
      (sum, c) => sum + Math.max(0, Math.min(windowEnd, c.closeAt) - Math.max(windowStart, c.openAt)),
      0,
    );

  for (const [windowStart, windowEnd] of STAFFING_WINDOWS) {
    const length = windowEnd - windowStart;
    const cappedNeed = capped.reduce((sum, c) => {
      const open = Math.max(0, Math.min(windowEnd, c.closeAt) - Math.max(windowStart, c.openAt));
      const merged = mergedAwayWindow(state, c.code);
      if (!merged) return sum + open;
      // Minutes folded into another position are covered by its holder.
      const folded = Math.max(0, Math.min(windowEnd, merged[1]) - Math.max(windowStart, merged[0]));
      return sum + Math.max(0, open - folded);
    }, 0);
    const peak = peakOpenChannels(channels, windowStart, windowEnd);
    if (!peak) continue;
    const pool = poolForWindow(state, windowStart);

    const restableNeed = minutesIn(restable, windowStart, windowEnd);
    const cleared = poolForWindow(state, windowStart, canTakeRestable, windowEnd);
    const workedInBreaks = Math.min(
      restableNeed,
      (cappedNeed * MIN_BREAK_MIN) / MAX_DUTY_MIN,
      (cleared * length * MIN_BREAK_MIN) / (MAX_DUTY_MIN + MIN_BREAK_MIN),
    );
    const personMinutes =
      (cappedNeed * (MAX_DUTY_MIN + MIN_BREAK_MIN)) / MAX_DUTY_MIN + restableNeed - workedInBreaks;
    const required = Math.max(
      peak,
      // The small allowance keeps an exact fit from rounding up a person.
      peakOpenChannels(tying, windowStart, windowEnd) + Math.ceil(personMinutes / length - 1e-9),
    );
    if (pool >= required) continue;
    notices.push(
      `${formatRange(windowStart, windowEnd)}: ${pool} ${pool === 1 ? "person" : "people"} can work, but ` +
        `${peak} open ${peak === 1 ? "channel needs" : "channels need"} at least ${required} for continuous ` +
        `cover with 2h duties and 30 min breaks. Close a position for part of this time, move someone out of ` +
        `a half, or add people.`,
    );
  }

  notices.push(...restrictedChannelNotices(state, channels));
  notices.push(...availabilityShortfalls(state, channels));
  notices.push(...shortStretchNotices(state));
  return notices;
}

/**
 * Stretches where the people around can't fill the open positions because of
 * the times somebody is away — so the notice can say who. Checked minute by
 * minute on the grid, which is exact rather than a bound: every open position
 * needs a different person on it at every moment.
 *
 * Only shortfalls the entered times cause are reported. One that exists with
 * everyone around all night is the window check's to explain, and saying it
 * twice would bury it.
 */
function availabilityShortfalls(state: NightAllocationState, channels: NightChannel[]): string[] {
  const people = availablePeople(state);
  if (!people.some(isPartNight)) return [];

  const merge = activeMerge(state);
  const openAt = (channel: NightChannel, minute: number) =>
    channel.openAt <= minute &&
    channel.closeAt > minute &&
    !(merge && channel.code === merge.source.code && minute >= MERGE_WINDOW[0] && minute < MERGE_WINDOW[1]);
  const halfAllows = (person: NightPerson, minute: number) =>
    minute < FIRST_HALF[0] || (minute < SECOND_HALF[0] ? person.half !== "2nd" : person.half !== "1st");

  type Shortfall = { start: number; end: number; label: string; needed: number; free: number; away: string[] };
  const found: Shortfall[] = [];
  const record = (minute: number, label: string, needed: number, free: number, away: string[]) => {
    const last = found[found.length - 1];
    if (
      last &&
      last.end === minute &&
      last.label === label &&
      last.needed === needed &&
      last.free === free &&
      last.away.join("|") === away.join("|")
    ) {
      last.end = minute + SLOT_MIN;
    } else {
      found.push({ start: minute, end: minute + SLOT_MIN, label, needed, free, away });
    }
  };

  for (let minute = 0; minute < NIGHT_SPAN_MIN; minute += SLOT_MIN) {
    const open = channels.filter(channel => openAt(channel, minute));
    if (!open.length) continue;

    // A 1st Half person may still hold TSO in the 2nd Half — one of them, on
    // that one position — so they are counted for it and for nothing else.
    const tsoOpen = open.some(channel => channel.code === CROSS_HALF_CHANNEL);
    const crossover = (person: NightPerson) =>
      tsoOpen && minute >= SECOND_HALF[0] && person.half === "1st" && person.canTakeTso;
    const eligible = people.filter(person => halfAllows(person, minute));
    const crossing = people.filter(crossover);
    const capacity = (withTimes: boolean) =>
      eligible.filter(person => !withTimes || isAvailableAt(person, minute)).length +
      (crossing.some(person => !withTimes || isAvailableAt(person, minute)) ? 1 : 0);

    const awayNow = [...eligible, ...crossing]
      .filter(person => !isAvailableAt(person, minute))
      .map(person => person.name);
    if (capacity(false) >= open.length && capacity(true) < open.length) {
      record(minute, "positions", open.length, capacity(true), awayNow);
    }

    const tso = open.find(channel => channel.code === TSO_CHANNEL);
    if (tso) {
      const qualified = [...eligible, ...crossing].filter(person => person.canTakeTso);
      const freeQualified = qualified.filter(person => isAvailableAt(person, minute));
      if (qualified.length && !freeQualified.length) {
        record(minute, "TSO", 1, 0, qualified.map(person => person.name));
      }
    }
  }

  const names = (away: string[]) =>
    away.length > 3 ? `${away.slice(0, 3).join(", ")} and ${away.length - 3} more` : away.join(", ");
  return found.map(shortfall =>
    shortfall.label === "TSO"
      ? `TSO ${formatRange(shortfall.start, shortfall.end)}: everyone who can take TSO is away then ` +
        `(${names(shortfall.away)}). Change someone's times, turn on "TSO" for someone who is around, or close TSO for part of it.`
      : `${formatRange(shortfall.start, shortfall.end)}: ${shortfall.free} ${shortfall.free === 1 ? "person is" : "people are"} ` +
        `around for ${shortfall.needed} open ${shortfall.needed === 1 ? "position" : "positions"} — ${names(shortfall.away)} ` +
        `${shortfall.away.length === 1 ? "is" : "are"} away then. Change someone's times, close a position for ` +
        `part of it, or add someone.`,
  );
}

/** The same feasibility check, run against TSO-qualified people only. */
function restrictedChannelNotices(state: NightAllocationState, channels: NightChannel[]): string[] {
  const tso = channels.find(channel => channel.code === TSO_CHANNEL);
  if (!tso) return [];

  const qualified = availablePeople(state).filter(person => person.canTakeTso);
  if (!qualified.length) {
    return [
      'Nobody available tonight is marked as able to take TSO. Turn on "TSO" for at least one person, or untick TSO in Channels.',
    ];
  }

  // TSO has no two-hour cap, so one qualified person can hold it for a whole
  // window. What matters is whether anyone qualified is free at all — and in
  // the 2nd Half the 1st Half's qualified people count, because TSO is the
  // position the halves may be crossed for.
  const notices: string[] = [];
  for (const [windowStart, windowEnd] of STAFFING_WINDOWS) {
    const need = Math.max(0, Math.min(windowEnd, tso.closeAt) - Math.max(windowStart, tso.openAt));
    if (!need) continue;
    const pool =
      windowStart >= SECOND_HALF[0] && tso.code === CROSS_HALF_CHANNEL
        ? qualified.filter(person => minutesAvailable(person, windowStart, windowEnd) >= MIN_DUTY_MIN).length
        : poolForWindow(state, windowStart, qualified, windowEnd);
    if (pool >= 1) continue;
    notices.push(
      `TSO ${formatRange(Math.max(windowStart, tso.openAt), Math.min(windowEnd, tso.closeAt))}: nobody who can ` +
        `take TSO is free. Turn on "TSO" for someone who can work this stretch, or close TSO for part of it.`,
    );
  }
  return notices;
}

/**
 * When the chosen duty length cannot be kept for part of the night, say so in
 * the same terms the generator used to decide: `k` channels relieved every `I`
 * minutes give duties of `k × I` and breaks of `(pool − k) × I`.
 */
export function dutyLengthNote(state: NightAllocationState): string | undefined {
  const preferred = state.dutyLengthPref || 0;
  if (!preferred) return undefined;

  const channels = openChannels(state);
  const notes: string[] = [];

  for (const [windowStart, windowEnd] of STAFFING_WINDOWS) {
    const pool = poolForWindow(state, windowStart);
    const peak = peakOpenChannels(channels, windowStart, windowEnd);
    if (!peak || pool <= peak) continue;

    const shortest = peak * Math.max(SLOT_MIN, Math.ceil(MIN_BREAK_MIN / (pool - peak) / SLOT_MIN) * SLOT_MIN);
    const longest = peak * Math.floor(MAX_DUTY_MIN / peak / SLOT_MIN) * SLOT_MIN;
    if (preferred < shortest) {
      notes.push(
        `${formatRange(windowStart, windowEnd)}, duties are around ` +
          `${formatDuration(Math.min(shortest, MAX_DUTY_MIN))} so everyone still gets a 30 min break`,
      );
    } else if (preferred > longest && longest >= MIN_DUTY_MIN) {
      notes.push(
        `${formatRange(windowStart, windowEnd)}, duties are around ${formatDuration(longest)} to keep handovers staggered`,
      );
    }
  }

  if (!notes.length) return undefined;
  // Every window saying the same thing reads better as one sentence.
  const tails = notes.map(note => note.slice("13:30–17:30".length));
  if (notes.length === STAFFING_WINDOWS.length && tails.every(tail => tail === tails[0])) {
    return `Continuous plan made. All night${tails[0]}.`;
  }
  return `Continuous plan made. ${notes.join("; ")}.`;
}

// ── Hard rules ──────────────────────────────────────────────────────────────

function validateChannels(state: NightAllocationState, errors: RuleIssue[]) {
  const active = activeChannels(state);
  if (!active.length) errors.push({ message: "Turn on at least one channel.", dutyIds: [] });

  for (const channel of active) {
    if (channel.openAt >= channel.closeAt) {
      errors.push({ message: `${channel.code}: closing time must be after opening time.`, dutyIds: [] });
    } else if (channel.closeAt - channel.openAt < MIN_DUTY_MIN) {
      errors.push({ message: `${channel.code} must be open for at least 30 min.`, dutyIds: [] });
    }
    if (channel.openAt < 0 || channel.closeAt > NIGHT_SPAN_MIN) {
      errors.push({ message: `${channel.code} must be open inside 13:30–01:30.`, dutyIds: [] });
    }
    if (channel.mergedInto) {
      const target = state.channels.find(entry => entry.code === channel.mergedInto);
      if (channel.code !== MERGE_SOURCE_CHANNEL) {
        errors.push({
          message: `${channel.code} can't be merged into another position. Only ${MERGE_SOURCE_CHANNEL} can.`,
          dutyIds: [],
        });
      } else if (!MERGE_TARGET_CHANNELS.includes(channel.mergedInto)) {
        errors.push({
          message:
            `${channel.code} can only merge into ${MERGE_TARGET_CHANNELS.slice(0, -1).join(", ")} or ` +
            `${MERGE_TARGET_CHANNELS[MERGE_TARGET_CHANNELS.length - 1]}, ` +
            `not ${channel.mergedInto}.`,
          dutyIds: [],
        });
      } else if (!target?.inUse) {
        errors.push({
          message: `${channel.code} is set to merge into ${channel.mergedInto}, which isn't in use tonight.`,
          dutyIds: [],
        });
      } else if (target.openAt > MERGE_WINDOW[0] || target.closeAt < MERGE_WINDOW[1]) {
        errors.push({
          message:
            `${channel.code} is set to merge into ${target.code}, but ${target.code} isn't open for the whole ` +
            `${formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1])} merge.`,
          dutyIds: [],
        });
      }
    }

    // A DB slot at the opening minute opens the position itself, so there is
    // no starter to check — the generator ignores the setting there too.
    if (fixedOpeningDuty(state, channel)) continue;

    const starter = channel.starterKey ? findPerson(state, channel.starterKey) : undefined;
    if (channel.starterKey && !starter) {
      errors.push({ message: `${channel.code} is set to start with someone no longer on tonight's shift.`, dutyIds: [] });
    } else if (starter && !starter.available) {
      errors.push({ message: `${starter.name} is set to start ${channel.code} but isn't available tonight.`, dutyIds: [] });
    } else if (starter && !canTakeChannel(starter, channel.code)) {
      errors.push({ message: `${starter.name} isn't marked as able to take TSO, so can't start it.`, dutyIds: [] });
    } else if (starter && channel.openAt < channel.closeAt && !isAvailableAt(starter, channel.openAt)) {
      errors.push({
        message:
          `${starter.name} is set to start ${channel.code} at ${formatMinutes(channel.openAt)} but isn't ` +
          `available then.`,
        dutyIds: [],
      });
    }
  }
}

/**
 * Each person and each position appears once. The page cannot produce a
 * duplicate, but a request can, and every other rule would silently read the
 * first copy — while the database refuses the second outright.
 */
function validateUniqueness(state: NightAllocationState, errors: RuleIssue[]) {
  const people = new Set<string>();
  const reportedPeople = new Set<string>();
  for (const person of state.people) {
    if (people.has(person.key) && !reportedPeople.has(person.key)) {
      errors.push({ message: `${person.name} is on tonight's list more than once.`, dutyIds: [] });
      reportedPeople.add(person.key);
    }
    people.add(person.key);
  }

  const channels = new Set<string>();
  const reportedChannels = new Set<string>();
  for (const channel of state.channels) {
    if (channels.has(channel.code) && !reportedChannels.has(channel.code)) {
      errors.push({ message: `${channel.code} is listed more than once.`, dutyIds: [] });
      reportedChannels.add(channel.code);
    }
    channels.add(channel.code);
  }
}

function validateHalves(state: NightAllocationState, errors: RuleIssue[]) {
  for (const person of state.people) {
    if (!person.half) continue;
    const label = person.half === "1st" ? "1st Half" : "2nd Half";
    if (!person.available) {
      errors.push({ message: `${person.name} is ${label} but isn't available tonight.`, dutyIds: [] });
      continue;
    }
    // Everyone in a half needs a duty inside it, which needs 30 minutes of it.
    const [from, to] = halfWindow(person.half);
    const minutes = minutesAvailable(person, from, to);
    if (minutes >= MIN_DUTY_MIN) continue;
    errors.push({
      message: minutes
        ? `${person.name} is ${label} but is available for only ${minutes} min of it (${formatRange(from, to)}), ` +
          `too short for a duty.`
        : `${person.name} is ${label} but isn't available at any time in it (${formatRange(from, to)}).`,
      dutyIds: [],
      personKeys: [person.key],
    });
  }
}

/**
 * A blank holds nobody, so only its place on the board is checked: inside the
 * night, on a position in use and open then, and not where the position is
 * merged away.
 */
function validateBlank(state: NightAllocationState, blank: NightDuty, errors: RuleIssue[]) {
  const range = formatRange(blank.startMin, blank.endMin);
  if (!(blank.startMin >= 0 && blank.endMin <= NIGHT_SPAN_MIN && blank.endMin > blank.startMin)) {
    errors.push({ message: `A blank on ${blank.channelCode} must end after it starts.`, dutyIds: [blank.id] });
    return;
  }
  const channel = findChannel(state, blank.channelCode);
  if (!channel || !channel.inUse) {
    errors.push({
      message: `${blank.channelCode} isn't in use tonight, but has a blank ${range}.`,
      dutyIds: [blank.id],
    });
  } else if (blank.startMin < channel.openAt || blank.endMin > channel.closeAt) {
    errors.push({
      message: `${blank.channelCode} is open ${formatRange(channel.openAt, channel.closeAt)}, but a blank on it runs ${range}.`,
      dutyIds: [blank.id],
    });
  }
  const merged = mergedAwayWindow(state, blank.channelCode);
  if (merged && overlaps(blank, merged[0], merged[1])) {
    errors.push({
      message:
        `${blank.channelCode} is merged into ${channel?.mergedInto} ${formatRange(merged[0], merged[1])}, ` +
        `so it can't have a blank of its own then.`,
      dutyIds: [blank.id],
    });
  }
}

function validateDuty(state: NightAllocationState, duty: NightDuty, errors: RuleIssue[]) {
  if (isBlank(duty)) {
    validateBlank(state, duty, errors);
    return;
  }
  const name = personName(state, duty.personKey);
  const length = dutyLength(duty);
  const range = formatRange(duty.startMin, duty.endMin);

  const cap = maxDutyFor(duty.channelCode);
  if (!(duty.startMin >= 0 && duty.endMin <= NIGHT_SPAN_MIN && length > 0)) {
    errors.push({ message: `${duty.channelCode} for ${name}: end time must be after start time.`, dutyIds: [duty.id] });
  } else if (length > cap) {
    errors.push({
      message: `${name} has ${duty.channelCode} for ${formatDuration(length)} (${range}). A duty can be at most ${formatDuration(cap)}.`,
      dutyIds: [duty.id],
    });
  } else if (length < MIN_DUTY_MIN) {
    errors.push({
      message: `${name} has ${duty.channelCode} for only ${formatDuration(length)} (${range}). A duty must be at least 30 min.`,
      dutyIds: [duty.id],
    });
  }

  const person = findPerson(state, duty.personKey);
  if (!person?.available) {
    errors.push({ message: `${name} isn't available tonight but has ${duty.channelCode} ${range}.`, dutyIds: [duty.id] });
  } else if (length > 0) {
    const away = awayDuring(person, duty.startMin, duty.endMin);
    if (away.length) {
      errors.push({
        message:
          `${name} isn't available ${away.map(([start, end]) => formatRange(start, end)).join(", ")} but has ` +
          `${duty.channelCode} ${range}.`,
        dutyIds: [duty.id],
      });
    }
  }
  if (person && !canTakeChannel(person, duty.channelCode)) {
    errors.push({
      message: `${name} isn't marked as able to take TSO but has it ${range}.`,
      dutyIds: [duty.id],
    });
  }

  const merged = mergedAwayWindow(state, duty.channelCode);
  if (merged && overlaps(duty, merged[0], merged[1])) {
    errors.push({
      message:
        `${duty.channelCode} is merged into ${findChannel(state, duty.channelCode)?.mergedInto} ` +
        `${formatRange(merged[0], merged[1])}, so it can't have a duty of its own then. ` +
        `${name} has it ${range}.`,
      dutyIds: [duty.id],
    });
  }

  const channel = findChannel(state, duty.channelCode);
  if (!channel || !channel.inUse) {
    errors.push({
      message: `${duty.channelCode} isn't in use tonight, but ${name} has it ${range}.`,
      dutyIds: [duty.id],
    });
  } else if (length > 0 && (duty.startMin < channel.openAt || duty.endMin > channel.closeAt)) {
    errors.push({
      message:
        `${duty.channelCode} is open ${formatRange(channel.openAt, channel.closeAt)}, but ${name}'s duty runs ${range}.`,
      dutyIds: [duty.id],
    });
  }
}

function validatePersonTimeline(state: NightAllocationState, errors: RuleIssue[]) {
  const byPerson = new Map<string, NightDuty[]>();
  for (const duty of state.duties) {
    if (isBlank(duty)) continue;
    const list = byPerson.get(duty.personKey) ?? [];
    list.push(duty);
    byPerson.set(duty.personKey, list);
  }

  for (const [key, duties] of byPerson) {
    const sorted = duties.slice().sort((a, b) => a.startMin - b.startMin);
    const name = personName(state, key);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const first = sorted[i];
        const second = sorted[j];
        if (overlaps(first, second.startMin, second.endMin)) {
          errors.push({
            message: `${name} is on ${first.channelCode} and ${second.channelCode} at the same time from ${formatMinutes(second.startMin)}.`,
            dutyIds: [first.id, second.id],
          });
          continue;
        }
        // Every pair, not just neighbours: two control duties either side of a
        // TSO duty still need their 30 minutes, which the TSO duty provides.
        const gap = second.startMin - first.endMin;
        if (gap < breakBetween(first.channelCode, second.channelCode)) {
          errors.push({
            message:
              `${name} has a ${gap} min break between ${first.channelCode} (ends ${formatMinutes(first.endMin)}) and ` +
              `${second.channelCode} (starts ${formatMinutes(second.startMin)}). At least 30 min needed.`,
            dutyIds: [first.id, second.id],
          });
        }
      }
    }
  }
}

function validateChannelTimeline(state: NightAllocationState, errors: RuleIssue[]) {
  const codes = [...new Set(state.duties.map(duty => duty.channelCode))];
  for (const code of codes) {
    const sorted = state.duties.filter(duty => duty.channelCode === code).sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const first = sorted[i];
        const second = sorted[j];
        if (!overlaps(first, second.startMin, second.endMin)) continue;
        const from = formatMinutes(Math.max(first.startMin, second.startMin));
        const to = formatMinutes(Math.min(first.endMin, second.endMin));
        const blanks = [first, second].filter(isBlank);
        const held = [first, second].find(entry => !isBlank(entry));
        errors.push({
          message:
            blanks.length === 2
              ? `${code} has two blanks at once from ${from} to ${to}.`
              : blanks.length === 1 && held
                ? `${code} is both blank and held by ${personName(state, held.personKey)} from ${from} to ${to}.`
                : `${code} has two people from ${from} to ${to}: ${personName(state, first.personKey)} and ` +
                  `${personName(state, second.personKey)}.`,
          dutyIds: [first.id, second.id],
        });
      }
    }
  }
}

/**
 * A 1st Half person may hold this duty inside the 2nd Half.
 *
 * TSO is the single exception to the halves being exclusive — see
 * `CROSS_HALF_CHANNEL`. It runs one way only: a 2nd Half person has no
 * equivalent licence in the 1st Half.
 */
export function isAllowedHalfCrossover(person: NightPerson, duty: NightDuty): boolean {
  return person.half === "1st" && duty.channelCode === CROSS_HALF_CHANNEL;
}

/** Duties a 1st Half person is holding inside the 2nd Half on the exception. */
export function halfCrossovers(state: NightAllocationState): Array<{ person: NightPerson; duty: NightDuty }> {
  const out: Array<{ person: NightPerson; duty: NightDuty }> = [];
  for (const person of state.people) {
    if (person.half !== "1st") continue;
    for (const duty of dutiesOf(state, person.key)) {
      if (!overlaps(duty, SECOND_HALF[0], SECOND_HALF[1])) continue;
      if (isAllowedHalfCrossover(person, duty)) out.push({ person, duty });
    }
  }
  return out;
}

function validateHalfDuties(state: NightAllocationState, errors: RuleIssue[]) {
  for (const person of state.people) {
    if (!person.half) continue;
    const label = person.half === "1st" ? "1st Half" : "2nd Half";
    const otherLabel = person.half === "1st" ? "2nd Half" : "1st Half";
    const own = halfWindow(person.half);
    const other = halfWindow(person.half === "1st" ? "2nd" : "1st");
    const mine = dutiesOf(state, person.key);

    for (const duty of mine) {
      if (!overlaps(duty, other[0], other[1])) continue;
      // TSO is the one position that crosses from the 1st Half into the 2nd.
      if (isAllowedHalfCrossover(person, duty)) continue;
      errors.push({
        message:
          `${person.name} is ${label} and can't take ${duty.channelCode} ` +
          `${formatRange(duty.startMin, duty.endMin)}, which falls in the ${otherLabel}.`,
        dutyIds: [duty.id],
      });
    }

    // A half with no duties at all is a night nobody has planned yet, not a
    // breach — and DB slots alone are not a plan.
    if (isPlanned(state) && !mine.some(duty => overlaps(duty, own[0], own[1]))) {
      errors.push({
        message: `${person.name} is ${label} but has no duty between ${formatMinutes(own[0])} and ${formatMinutes(own[1])}.`,
        dutyIds: [],
        personKeys: [person.key],
      });
    }
  }
}

function validateContinuity(state: NightAllocationState, errors: RuleIssue[]) {
  // Nothing planned yet — DB slots entered ahead of the plan don't count as one.
  if (!isPlanned(state)) return;
  for (const channel of openChannels(state)) {
    const gaps = gapsForChannel(state.duties, channel, mergedAwayWindow(state, channel.code));
    if (!gaps.length) continue;
    errors.push({
      message:
        `${channel.code} has no one on duty ${gaps.map(([start, end]) => formatRange(start, end)).join(", ")}. ` +
        `Every open channel needs continuous cover.`,
      dutyIds: [],
      isGap: true,
    });
  }
}

// ── Preferences ─────────────────────────────────────────────────────────────

function collectWarnings(state: NightAllocationState): RuleIssue[] {
  const warnings: RuleIssue[] = [];
  for (const message of staffingNotices(state)) {
    warnings.push({ message, dutyIds: [], isStaffing: true });
  }
  if (!isPlanned(state)) return warnings;

  // Each channel's chosen starter should actually hold it at its opening minute
  // — unless a DB slot opens it, which the starter setting gives way to.
  for (const channel of activeChannels(state)) {
    const starterKey = channel.starterKey;
    if (!starterKey || fixedOpeningDuty(state, channel)) continue;
    const held = state.duties.some(
      duty => duty.channelCode === channel.code && duty.startMin === channel.openAt && duty.personKey === starterKey,
    );
    if (held) continue;
    warnings.push({
      message: `${personName(state, starterKey)} is set to start ${channel.code} but doesn't have it at ${formatMinutes(channel.openAt)}.`,
      dutyIds: [],
    });
  }

  warnings.unshift(...blankWarnings(state));
  warnings.push(...shortDutyWarnings(state));
  warnings.push(...eveningRestWarnings(state));
  warnings.push(...secondHalfChannelPreferences(state));
  warnings.push(...crossoverWarnings(state));
  warnings.push(...mergeWarnings(state));
  warnings.push(...workloadWarnings(state));
  return warnings;
}

/**
 * A 1st Half person on TSO in the 2nd Half is legal but exceptional, so it is
 * always surfaced — the reader should never have to work out whether it was
 * deliberate.
 */
function crossoverWarnings(state: NightAllocationState): RuleIssue[] {
  const crossovers = halfCrossovers(state);
  if (!crossovers.length) return [];
  return crossovers.map(({ person, duty }) => ({
    message:
      `${person.name} is 1st Half and is covering ${duty.channelCode} ` +
      `${formatRange(duty.startMin, duty.endMin)}, inside the 2nd Half. Allowed for ` +
      `${CROSS_HALF_CHANNEL} only, and only when the night can't be covered without it.`,
    dutyIds: [duty.id],
  }));
}

/**
 * A merge is legal but exceptional, so it is always surfaced — the reader
 * should never have to notice it from the shape of the board alone.
 */
function mergeWarnings(state: NightAllocationState): RuleIssue[] {
  const merge = activeMerge(state);
  if (!merge) return [];
  return [
    {
      message:
        `${merge.source.code} is merged into ${merge.targetCode} ` +
        `${formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1])} — whoever holds ${merge.targetCode} holds both. ` +
        `Only do this when the 1st Half is too thin to cover them separately.`,
      dutyIds: [],
    },
  ];
}

/**
 * Duties under an hour. Legal, and sometimes the only way to keep a night
 * continuous, but the office prefers 1h, 1h 30m or 2h, so each one is named.
 * A position open for under an hour can only have a short duty, and is left
 * out — as is a DB slot, whose length the office fixed.
 */
function shortDutyWarnings(state: NightAllocationState): RuleIssue[] {
  const short = state.duties
    .filter(duty => {
      const length = dutyLength(duty);
      if (length <= 0 || length >= PREFERRED_MIN_DUTY_MIN || isFixedDuty(duty) || isBlank(duty)) return false;
      const channel = findChannel(state, duty.channelCode);
      return !channel || channel.closeAt - channel.openAt >= PREFERRED_MIN_DUTY_MIN;
    })
    .sort((a, b) => a.startMin - b.startMin);
  if (!short.length) return [];
  return [
    {
      message:
        `Preferred: duties of 1h, 1h 30m or 2h. Under an hour: ` +
        short
          .map(duty => `${personName(state, duty.personKey)} ${duty.channelCode} ${formatRange(duty.startMin, duty.endMin)}`)
          .join(", ") +
        ".",
      dutyIds: short.map(duty => duty.id),
    },
  ];
}

/**
 * Every blank, one line each and first in the list. A blank is allowed — it
 * was left on purpose, and it saves and shares as BLANK — but a position with
 * nobody on it is the last thing a reader should have to find for themselves.
 */
function blankWarnings(state: NightAllocationState): RuleIssue[] {
  return blanksInBoardOrder(state).map(blank => ({
    message:
      `${blank.channelCode} ${formatRange(blank.startMin, blank.endMin)} is left blank — nobody is on it. ` +
      `Tap it on the board to put someone on.`,
    dutyIds: [blank.id],
  }));
}

/**
 * Everyone who doesn't get 4 hours in a row off every position — TSO aside —
 * starting between 16:30 and 23:30. One line, like the short duties: the
 * generator keeps to it wherever staffing allows, so what is left is usually
 * the night's doing rather than a choice.
 */
function eveningRestWarnings(state: NightAllocationState): RuleIssue[] {
  const shortfalls = eveningRestShortfalls(state);
  if (!shortfalls.length) return [];
  return [
    {
      message:
        `Preferred: ${formatDuration(EVENING_REST_MIN)} in a row off every position, starting between ` +
        `${formatMinutes(EVENING_REST_WINDOW[0])} and ${formatMinutes(EVENING_REST_WINDOW[1])} ` +
        `(TSO doesn't count). Not met for ` +
        shortfalls.map(({ person, longest }) => `${person.name} (${describeEveningBreak(longest)})`).join(", ") +
        ".",
      dutyIds: shortfalls.flatMap(shortfall => shortfall.dutyIds),
      personKeys: shortfalls.map(shortfall => shortfall.person.key),
    },
  ];
}

/** CLD from 21:30 for a 2nd Half person, and CLD as their earlier relieving duty. */
function secondHalfChannelPreferences(state: NightAllocationState): RuleIssue[] {
  const secondHalf = peopleInHalf(state, "2nd");
  const channel = findChannel(state, SECOND_HALF_PREFERRED_CHANNEL);
  if (!secondHalf.length || !channel?.inUse) return [];
  if (!(channel.openAt <= SECOND_HALF[0] && channel.closeAt > SECOND_HALF[0])) return [];

  const warnings: RuleIssue[] = [];
  const takenAtHandover = state.duties.some(
    duty =>
      duty.channelCode === SECOND_HALF_PREFERRED_CHANNEL &&
      duty.startMin === SECOND_HALF[0] &&
      secondHalf.some(person => person.key === duty.personKey),
  );
  if (!takenAtHandover) {
    warnings.push({
      message: `Preferred: a 2nd Half person takes ${SECOND_HALF_PREFERRED_CHANNEL} at ${formatMinutes(SECOND_HALF[0])}.`,
      dutyIds: [],
    });
  }

  const missingEarlyCld = secondHalf.filter(person => {
    const early = state.duties.filter(duty => duty.personKey === person.key && duty.endMin <= FIRST_HALF[0]);
    return early.length > 0 && !early.some(duty => duty.channelCode === SECOND_HALF_PREFERRED_CHANNEL);
  });
  if (missingEarlyCld.length) {
    warnings.push({
      message:
        `Preferred: earlier duty on ${SECOND_HALF_PREFERRED_CHANNEL} for ` +
        `${missingEarlyCld.map(person => person.name).join(", ")} (2nd Half).`,
      dutyIds: state.duties
        .filter(duty => missingEarlyCld.some(person => person.key === duty.personKey) && duty.endMin <= FIRST_HALF[0])
        .map(duty => duty.id),
    });
  }
  return warnings;
}

/** Workload is compared inside a group, because the groups work different hours. */
function workloadWarnings(state: NightAllocationState): RuleIssue[] {
  const groups: Array<[string, NightPerson[]]> = [
    ["1st Half", peopleInHalf(state, "1st")],
    ["2nd Half", peopleInHalf(state, "2nd")],
    ["No half", availablePeople(state).filter(person => !person.half)],
  ];
  const warnings: RuleIssue[] = [];
  for (const [label, members] of groups) {
    if (members.length < 2) continue;
    const load = members
      .map(person => ({ person, minutes: minutesOnDuty(state, person.key) }))
      .sort((a, b) => a.minutes - b.minutes);
    const lightest = load[0];
    const heaviest = load[load.length - 1];
    if (heaviest.minutes - lightest.minutes <= MAX_DUTY_MIN) continue;
    warnings.push({
      message:
        `Uneven load in ${label}: ${heaviest.person.name} has ${formatDuration(heaviest.minutes)}, ` +
        `${lightest.person.name} has ${formatDuration(lightest.minutes)}.`,
      dutyIds: [],
    });
  }
  return warnings;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Every hard rule and every preference, for one night.
 *
 * The API calls this on save and refuses the write while `errors` is non-empty,
 * so the rules hold regardless of what the client believes.
 */
export function validateAllocation(state: NightAllocationState): ValidationResult {
  const errors: RuleIssue[] = [];
  validateUniqueness(state, errors);
  validateChannels(state, errors);
  validateHalves(state, errors);
  for (const duty of state.duties) validateDuty(state, duty, errors);
  validatePersonTimeline(state, errors);
  validateChannelTimeline(state, errors);
  validateHalfDuties(state, errors);
  validateContinuity(state, errors);
  return { errors, warnings: collectWarnings(state) };
}

/** Convenience for callers that only need the yes/no. */
export function hasHardErrors(state: NightAllocationState): boolean {
  return validateAllocation(state).errors.length > 0;
}

/**
 * What is wrong with the DB slots themselves, judged as if nothing else were
 * on the board: an instructor who is away then, not cleared for TSO, in the
 * other half, on two slots at once, or a slot outside its position's hours.
 *
 * A clash with an ordinary duty is left out on purpose. Those are the plan's
 * to give way — the next generate plans around the slot — whereas a slot that
 * breaks a rule on its own makes every plan impossible.
 */
export function fixedDutyErrors(state: NightAllocationState): RuleIssue[] {
  const fixed = state.duties.filter(isFixedDuty);
  if (!fixed.length) return [];
  const ids = new Set(fixed.map(duty => duty.id));
  return validateAllocation({ ...state, duties: fixed }).errors.filter(issue =>
    issue.dutyIds.some(id => ids.has(id)),
  );
}
