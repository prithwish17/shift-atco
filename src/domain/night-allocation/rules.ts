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
  CROSS_HALF_CHANNEL,
  DEFAULT_CHANNEL_CODES,
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
 * covered by that position's holder, so it is not a gap.
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
  return state.duties
    .filter(duty => duty.personKey === personKey)
    .reduce((sum, duty) => sum + Math.max(0, dutyLength(duty)), 0);
}

// ── Staffing feasibility ────────────────────────────────────────────────────

/** Windows staffing is assessed over: before the halves, 1st Half, 2nd Half. */
const STAFFING_WINDOWS: Array<readonly [number, number]> = [
  [0, FIRST_HALF[0]],
  [FIRST_HALF[0], FIRST_HALF[1]],
  [SECOND_HALF[0], SECOND_HALF[1]],
];

/** How many people can work inside a window, given the halves they are in. */
function poolForWindow(state: NightAllocationState, windowStart: number, people?: NightPerson[]): number {
  const pool = people ?? availablePeople(state);
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
 * The bound: over a long stretch one person can be on duty for at most 120 of
 * every 150 minutes (a 2h duty then a 30 min break), so covering `need`
 * channel-minutes inside a window of length `L` needs at least
 * `need × 150 / 120 / L` people — and never fewer than the number of channels
 * open at once.
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

  for (const [windowStart, windowEnd] of STAFFING_WINDOWS) {
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
    const uncappedPeak = peakOpenChannels(uncapped, windowStart, windowEnd);
    const pool = poolForWindow(state, windowStart);
    const required = Math.max(
      peak,
      uncappedPeak +
        Math.ceil((cappedNeed * (MAX_DUTY_MIN + MIN_BREAK_MIN)) / MAX_DUTY_MIN / (windowEnd - windowStart)),
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
  return notices;
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
        ? qualified.length
        : poolForWindow(state, windowStart, qualified);
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

    const starter = channel.starterKey ? findPerson(state, channel.starterKey) : undefined;
    if (channel.starterKey && !starter) {
      errors.push({ message: `${channel.code} is set to start with someone no longer on tonight's shift.`, dutyIds: [] });
    } else if (starter && !starter.available) {
      errors.push({ message: `${starter.name} is set to start ${channel.code} but isn't available tonight.`, dutyIds: [] });
    } else if (starter && !canTakeChannel(starter, channel.code)) {
      errors.push({ message: `${starter.name} isn't marked as able to take TSO, so can't start it.`, dutyIds: [] });
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
    if (person.half && !person.available) {
      const label = person.half === "1st" ? "1st Half" : "2nd Half";
      errors.push({ message: `${person.name} is ${label} but isn't available tonight.`, dutyIds: [] });
    }
  }
}

function validateDuty(state: NightAllocationState, duty: NightDuty, errors: RuleIssue[]) {
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
        const gap = second.startMin - first.endMin;
        if (gap < MIN_BREAK_MIN) {
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
        errors.push({
          message:
            `${code} has two people from ${formatMinutes(Math.max(first.startMin, second.startMin))} to ` +
            `${formatMinutes(Math.min(first.endMin, second.endMin))}: ${personName(state, first.personKey)} and ` +
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
    for (const duty of state.duties) {
      if (duty.personKey !== person.key) continue;
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
    const mine = state.duties.filter(duty => duty.personKey === person.key);

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

    // A half with no duties at all is a night nobody has planned yet, not a breach.
    if (state.duties.length && !mine.some(duty => overlaps(duty, own[0], own[1]))) {
      errors.push({
        message: `${person.name} is ${label} but has no duty between ${formatMinutes(own[0])} and ${formatMinutes(own[1])}.`,
        dutyIds: [],
        personKeys: [person.key],
      });
    }
  }
}

function validateContinuity(state: NightAllocationState, errors: RuleIssue[]) {
  if (!state.duties.length) return;
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
  if (!state.duties.length) return warnings;

  // Each channel's chosen starter should actually hold it at its opening minute.
  for (const channel of activeChannels(state)) {
    const starterKey = channel.starterKey;
    if (!starterKey) continue;
    const held = state.duties.some(
      duty => duty.channelCode === channel.code && duty.startMin === channel.openAt && duty.personKey === starterKey,
    );
    if (held) continue;
    warnings.push({
      message: `${personName(state, starterKey)} is set to start ${channel.code} but doesn't have it at ${formatMinutes(channel.openAt)}.`,
      dutyIds: [],
    });
  }

  warnings.push(...shortDutyWarnings(state));
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
 * out.
 */
function shortDutyWarnings(state: NightAllocationState): RuleIssue[] {
  const short = state.duties
    .filter(duty => {
      const length = dutyLength(duty);
      if (length <= 0 || length >= PREFERRED_MIN_DUTY_MIN) return false;
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
