/**
 * Night Channel Allocation — the generator.
 *
 * It produces a plan with **no gaps at all** or nothing. A partial plan would
 * be worse than none: the board would look finished while a position sat empty.
 *
 * The search is a handover search. Repeatedly take the channel whose cover ends
 * earliest, choose who takes it next and until when, and backtrack on failure.
 * Handovers are staggered on purpose: with `k` channels relieved every `I`
 * minutes, duties come out `k × I` long and breaks `(pool − k) × I` long. That
 * is the classic night — 3 channels, 4 people, 1h 30m duties, channels relieved
 * 30 minutes apart, each relieved person resting 30 minutes before the next.
 *
 * Pure and deterministic for a given seed: the API runs it, the browser calls
 * the API, and the tests run it directly.
 */
import {
  CROSS_HALF_CHANNEL,
  DEFAULT_TARGET_DUTY_MIN,
  EVENING_REST_MIN,
  EVENING_REST_WINDOW,
  FIRST_HALF,
  HOURS_TOLERANCE_MIN,
  MERGE_SOURCE_CHANNEL,
  MERGE_WINDOW,
  MAX_DUTY_MIN,
  MIN_BREAK_MIN,
  MIN_DUTY_MIN,
  NIGHT_SPAN_MIN,
  PREFERRED_MIN_DUTY_MIN,
  SECOND_HALF,
  SECOND_HALF_PREFERRED_CHANNEL,
  SLOT_MIN,
} from "./constants.js";
import { makeDutyId } from "./ids.js";
import {
  activeMerge,
  availablePeople,
  canTakeChannel,
  countedMinutesOnDuty,
  countsTowardsHours,
  dutyLengthRank,
  eveningRestShortfalls,
  fairShares,
  findPerson,
  fixedDutyErrors,
  fixedOpeningDuty,
  halfWindow,
  hardRuleErrors,
  hoursImbalance,
  isBlank,
  isBreakExempt,
  isEveningRestExempt,
  isKeptDuty,
  isPinnedDuty,
  isRestrictedChannel,
  longestEveningBreak,
  maxDutyFor,
  mergeTargetFor,
  mergedAwayWindow,
  openChannels,
  shortStretchNotices,
  staffingNotices,
  stretchesToPlan,
  dutyLengthNote,
} from "./rules.js";
import { availableSpans, isAvailableAt, isFreeDuring, minutesAvailable, unavailableSpans } from "./availability.js";
import type { HalfKey, NightChannel, NightPerson } from "./types.js";
import { formatDuration, formatMinutes, formatRange } from "./time.js";
import type { GenerateResult, NightAllocationState, NightDuty } from "./types.js";

/**
 * A position the search has to cover in more than one stretch — either side
 * of a DB slot, or of the merge — is given one channel per stretch, because
 * the search models a channel as one continuous window. Every stretch after
 * the first carries this separator and its number so they never collide, and
 * it is stripped again on the way out.
 */
const SEGMENT_SEPARATOR = "\u0000";

const baseCode = (code: string) => code.split(SEGMENT_SEPARATOR)[0];

/**
 * The channels as the search should see them: each open position's stretches
 * that ordinary duties must cover. With CLD merged into SMC, CLD disappears
 * for the merge window; with a DB slot on TWR, TWR disappears for the slot.
 *
 * A stretch too short for any duty is kept, not dropped. The search then fails
 * on it rather than returning a plan with a hole where it was.
 */
function solverChannels(state: NightAllocationState): NightChannel[] {
  const out: NightChannel[] = [];
  for (const channel of openChannels(state)) {
    stretchesToPlan(state, channel).forEach(([openAt, closeAt], index) => {
      out.push({
        ...channel,
        code: index === 0 ? channel.code : `${channel.code}${SEGMENT_SEPARATOR}${index}`,
        openAt,
        closeAt,
        // Whoever was chosen to open the position opens its first stretch —
        // and only if that stretch starts at the opening. A DB slot there
        // opens it instead.
        starterKey: index === 0 && openAt === channel.openAt ? channel.starterKey : null,
      });
    });
  }
  return out;
}

/** Narrow a refusal — see the note on `isRefusedEdit`. */
export function isGenerateFailure(
  result: GenerateResult,
): result is Extract<GenerateResult, { ok: false }> {
  return !result.ok;
}

export interface SolveOptions {
  /** Require each channel's chosen starter to take its opening duty. */
  forceStarters?: boolean;
  /** Node budget. The search abandons a branch tree rather than hanging. */
  nodeLimit?: number;
  /** How many candidate people to try at each handover. */
  width?: number;
  /** Non-zero seeds shuffle candidate order, for randomised restarts. */
  seed?: number;
  /**
   * Let a 1st Half person hold the crossover position (TSO) inside the 2nd
   * Half. Off by default: the generator plans without it first and only
   * reaches for it when there is no continuous plan otherwise.
   */
  allowCrossHalfTso?: boolean;
  /**
   * Allow duties under `PREFERRED_MIN_DUTY_MIN` where a longer one would also
   * fit. Off, a short duty is used only where a position has less than that
   * left to cover. On by default; the generator turns it off for its first
   * attempt, so short duties appear only when an all-long night is impossible.
   */
  shortDuties?: boolean;
  /**
   * Let people go straight onto TSO, or off it, with no break — the rule. On
   * by default. The generator turns it off for its first attempts: a night
   * that works with a break after every duty is found much faster by the
   * narrower search, and gives everyone a real rest besides.
   */
  tsoWithoutBreak?: boolean;
  /**
   * Evening rests to keep, by person key: 4 hours off every position but TSO,
   * placed by `planEveningRests`. The search keeps each person off control for
   * theirs exactly as if they were away — TSO they may still take, because the
   * rest ignores it. None by default; the generator tries a night with them
   * first where it could work.
   */
  rests?: Readonly<Record<string, readonly [number, number]>>;
  /**
   * Keep everyone's duty hours — TSO not counted — within this many minutes
   * of their fair share (`fairShares`). Null, the default, only leans the
   * choices towards even; the generator asks for it first and falls back
   * without it.
   */
  balance?: number | null;
  /**
   * Give everyone with a fair share of the duty hours at least one duty on a
   * position that counts — nobody spends the night on TSO alone. On by
   * default. Someone whose share is nothing, because they are the only
   * person cleared for TSO whenever they are around, is owed none.
   */
  everyoneOnControl?: boolean;
  /**
   * A moment on the real clock (`Date.now()`) after which the search gives up
   * as if its node budget had run out. The generator's safety net — see
   * `GENERATE_HARD_STOP_MS`.
   */
  stopAt?: number;
}

/**
 * A half that hands its people the evening rest whatever the plan, because
 * the half rules already keep them off every position for long enough: the
 * 2nd Half through the 1st Half, and the 1st Half from the start of the 2nd —
 * bar the crossover position, which the rest ignores.
 */
function halfGivesEveningRest(half: HalfKey): boolean {
  if (!half) return false;
  if (half === "1st" && !isEveningRestExempt(CROSS_HALF_CHANNEL)) return false;
  const [from, to] = half === "2nd" ? FIRST_HALF : [SECOND_HALF[0], NIGHT_SPAN_MIN];
  return from >= EVENING_REST_WINDOW[0] && from <= EVENING_REST_WINDOW[1] && to - from >= EVENING_REST_MIN;
}

/** Nothing about a night changes while the solver runs, so this is all local. */
export function solveContinuous(
  state: NightAllocationState,
  {
    forceStarters = true,
    nodeLimit = 120_000,
    width = 6,
    seed = 0,
    allowCrossHalfTso = false,
    shortDuties = true,
    tsoWithoutBreak = true,
    rests,
    balance = null,
    everyoneOnControl = true,
    stopAt,
  }: SolveOptions = {},
): NightDuty[] | null {
  const preferred = state.dutyLengthPref || 0;
  // A usual length the person chose under an hour is a choice, not a fallback.
  const holdBackShort = !preferred || preferred >= PREFERRED_MIN_DUTY_MIN;

  // Small deterministic PRNG so a seeded restart is reproducible.
  let randomState = seed >>> 0;
  const random = () => {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let x = randomState;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  const people = availablePeople(state);
  const n = people.length;
  const channels = solverChannels(state);
  // A stretch is planned as the position it belongs to: TSO's second stretch is
  // still TSO, qualification, uncapped length and all.
  const codes = channels.map(channel => baseCode(channel.code));
  const k = channels.length;
  // DB slots and duties put on by hand are part of the plan as they stand. The
  // search places everything else around them and hands them back untouched.
  const fixed = state.duties.filter(isKeptDuty);
  if (!n) return null;
  if (!k) return fixed.length ? fixed.map(duty => ({ ...duty })) : null;

  /** 0 = no half, 1 = 1st Half, 2 = 2nd Half. */
  const half = people.map(person => (person.half === "1st" ? 1 : person.half === "2nd" ? 2 : 0));
  const qualified = people.map(person => person.canTakeTso);
  const starterIndex = channels.map(channel =>
    channel.starterKey ? people.findIndex(person => person.key === channel.starterKey) : -1,
  );

  /**
   * Whether TSO's exemption from the break is in play for this search. Off,
   * every duty needs its 30 minutes after it, TSO included — the night as it
   * was planned before, which the generator tries first because the search
   * finds it fastest.
   */
  const exemptHere = (code: string) => tsoWithoutBreak && isBreakExempt(code);
  const breakFor = (first: string, second: string) =>
    exemptHere(first) || exemptHere(second) ? 0 : MIN_BREAK_MIN;

  const lastEnd = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
  /**
   * When each person last came off a position that needs a break after it.
   * TSO needs none either side, so a TSO duty moves `lastEnd` but not this:
   * off TWR at 15:00 they may take TSO at 15:00, and off TSO at 21:30 they may
   * take SMC at 21:30 — as long as their last control duty ended by 21:00.
   */
  const lastControlEnd = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
  const lastChannel = new Array<number>(n).fill(-1);
  /** Duty hours so far, in minutes: time on every position but TSO. */
  const worked = new Array<number>(n).fill(0);
  const counts = codes.map(countsTowardsHours);
  const dutiesInOwnHalf = new Array<number>(n).fill(0);
  const coveredTo = channels.map(channel => channel.openAt);

  /** Does a duty over `[start, end)` count towards this person's half? */
  const countsForHalf = (index: number, start: number, end: number) =>
    (half[index] === 1 && start < SECOND_HALF[0] && end > FIRST_HALF[0]) ||
    (half[index] === 2 && end > SECOND_HALF[0]);

  /**
   * Each person's DB slots and duties put on by hand, which the search keeps
   * the break they need away from.
   */
  const fixedSpans = people.map(() => [] as Array<[number, number, string]>);
  for (const duty of fixed) {
    const index = people.findIndex(person => person.key === duty.personKey);
    if (index < 0) continue;
    fixedSpans[index].push([duty.startMin, duty.endMin, duty.channelCode]);
    if (countsTowardsHours(duty.channelCode)) worked[index] += duty.endMin - duty.startMin;
    if (countsForHalf(index, duty.startMin, duty.endMin)) dutiesInOwnHalf[index]++;
  }
  /** Each person's time away. */
  const awaySpans = people.map(person => unavailableSpans(person));
  /** Each person's evening rest, when the generator placed one. */
  const restSpans = people.map(person => rests?.[person.key] ?? null);

  /**
   * Everyone's fair share of the duty hours, how much of it is due by each
   * quarter-hour, and how much of the night they could still work. With
   * `balance` set, nobody goes more than that over their share, and a branch
   * is dropped as soon as someone can no longer reach their share less it —
   * or, without it, a first duty that counts.
   */
  const shares = fairShares(state, rests);
  const shareOf = people.map(person => shares.get(person.key));
  const share = shareOf.map(entry => entry?.share ?? 0);
  const hoursCeiling = share.map(value => (balance === null ? Number.POSITIVE_INFINITY : value + balance));
  const hoursFloor = share.map(value => {
    if (value < MIN_DUTY_MIN) return 0;
    if (balance !== null) return Math.max(MIN_DUTY_MIN, value - balance);
    return everyoneOnControl ? MIN_DUTY_MIN : 0;
  });
  const slotAt = (at: number) => Math.max(0, Math.min(Math.floor(at / SLOT_MIN), NIGHT_SPAN_MIN / SLOT_MIN));
  const dueBy = (index: number, at: number) => shareOf[index]?.due[slotAt(at)] ?? 0;
  const leftFrom = (index: number, at: number) => shareOf[index]?.left[slotAt(at)] ?? 0;
  /** Room under their ceiling for a duty of `length` on channel `channelIndex`. */
  const withinCeiling = (index: number, channelIndex: number, length: number) =>
    !counts[channelIndex] || worked[index] + length <= hoursCeiling[index];
  const constrained = people.map(
    (_, index) => fixedSpans[index].length > 0 || awaySpans[index].length > 0 || !!restSpans[index],
  );

  /**
   * Could this person hold a duty on `code` over `[start, end)`: around for all
   * of it, and rested either side of their own DB slots — as long as the break
   * between the two positions asks for?
   */
  const rangeFree = (index: number, start: number, end: number, code: string) => {
    if (!constrained[index]) return true;
    for (const [from, to] of awaySpans[index]) if (start < to && end > from) return false;
    const rest = restSpans[index];
    if (rest && !isEveningRestExempt(code) && start < rest[1] && end > rest[0]) return false;
    for (const [from, to, slotCode] of fixedSpans[index]) {
      const gap = breakFor(slotCode, code);
      if (start < to + gap && end > from - gap) return false;
    }
    return true;
  };
  /** Could they take over `code` at `at`, for at least the shortest duty there is? */
  const freeToStart = (index: number, at: number, code: string) => rangeFree(index, at, at + MIN_DUTY_MIN, code);
  /**
   * Rested enough to relieve channel `channelIndex` at `at`: off every
   * position by then, and off control for 30 minutes unless the relief is
   * onto TSO, which needs no break.
   */
  const restedFor = (index: number, at: number, channelIndex: number) =>
    lastEnd[index] <= at &&
    (exemptHere(codes[channelIndex]) || lastControlEnd[index] <= at - MIN_BREAK_MIN);
  /**
   * The same person carrying on the same position with no gap. With no break
   * needed around TSO that would otherwise pass for a handover, but it is one
   * longer duty, which the search plans as such.
   */
  const carriesOn = (index: number, at: number, channelIndex: number) =>
    lastEnd[index] === at && lastChannel[index] >= 0 && codes[lastChannel[index]] === codes[channelIndex];
  /** When they last came off a position before `at`, DB slots included. */
  const restedSince = (index: number, at: number) => {
    let last = lastEnd[index];
    for (const [, to] of fixedSpans[index]) if (to <= at && to > last) last = to;
    return last;
  };

  /** Latest minute any channel is still open inside a half. */
  const latestOpenInHalf = (which: 1 | 2) => {
    const [start, end] = which === 1 ? FIRST_HALF : SECOND_HALF;
    let latest = -1;
    for (const channel of channels) {
      if (channel.openAt < end && channel.closeAt > start) latest = Math.max(latest, Math.min(end, channel.closeAt));
    }
    return latest;
  };
  const halfEnd = [0, latestOpenInHalf(1), latestOpenInHalf(2)];

  const needsHalfDuty = (index: number) => half[index] !== 0 && dutiesInOwnHalf[index] === 0;

  /** The crossover licence applies to this channel, and only when enabled. */
  const crossoverChannel = (channelIndex: number) =>
    allowCrossHalfTso && codes[channelIndex] === CROSS_HALF_CHANNEL;

  /**
   * A half person may not hold anything overlapping the other half — except a
   * 1st Half person on the crossover position, when that is enabled.
   */
  const rangeAllowed = (index: number, channelIndex: number, start: number, end: number) => {
    if (half[index] === 1 && end > SECOND_HALF[0] && !crossoverChannel(channelIndex)) return false;
    if (half[index] === 2 && start < SECOND_HALF[0] && end > FIRST_HALF[0]) return false;
    return true;
  };

  /** Could this person start a duty at `at` without breaking their half? */
  const couldStartAt = (index: number, at: number) => {
    if (half[index] === 1) {
      // With the crossover enabled a 1st Half person can still be called on
      // later in the night, so they never stop being available.
      if (allowCrossHalfTso && channels.some((c, i) => codes[i] === CROSS_HALF_CHANNEL && c.closeAt > at)) return true;
      return at <= SECOND_HALF[0] - MIN_BREAK_MIN;
    }
    if (half[index] === 2) return at <= FIRST_HALF[0] - MIN_BREAK_MIN || at >= SECOND_HALF[0];
    return true;
  };

  const channelsOpenAt = (at: number, controlOnly = false) =>
    channels.reduce(
      (count, channel, i) =>
        count +
        (channel.openAt <= at && channel.closeAt > at && !(controlOnly && exemptHere(codes[i])) ? 1 : 0),
      0,
    );

  /** In their half at `at`, and around then rather than away or on a DB slot. */
  const inPoolAt = (index: number, at: number, code: string) =>
    (at < FIRST_HALF[0] ? true : at < SECOND_HALF[0] ? half[index] !== 2 : half[index] !== 1) &&
    freeToStart(index, at, code);

  const poolAt = (at: number, code: string) =>
    half.reduce((count, _, index) => count + (inPoolAt(index, at, code) ? 1 : 0), 0);

  const qualifiedPoolAt = (at: number, code: string) =>
    half.reduce((count, _, index) => count + (qualified[index] && inPoolAt(index, at, code) ? 1 : 0), 0);

  /**
   * The handover rhythm at a point in the night: the duty length to aim for and
   * the interval between handovers that produces it.
   */
  const rhythmAt = (at: number, code: string) => {
    const cap = maxDutyFor(code);
    const restricted = isRestrictedChannel(code);
    let openCount = restricted ? 1 : Math.max(1, channelsOpenAt(at));
    const pool = restricted ? qualifiedPoolAt(at, code) : poolAt(at, code);
    // With everyone busy, the only rest between control duties is a turn on
    // TSO, which needs no break either side — so the rhythm is set by the
    // control positions alone, and TSO takes the part of the rest.
    const control = channelsOpenAt(at, true);
    if (!restricted && pool <= openCount && control > 0 && pool > control) openCount = control;
    if (pool <= openCount) return { duty: cap, interval: MIN_BREAK_MIN };

    const minInterval = Math.max(
      SLOT_MIN,
      Math.ceil(MIN_BREAK_MIN / (pool - openCount) / SLOT_MIN) * SLOT_MIN,
      Math.ceil(MIN_DUTY_MIN / openCount / SLOT_MIN) * SLOT_MIN,
    );
    const maxInterval = Math.floor(cap / openCount / SLOT_MIN) * SLOT_MIN;
    if (minInterval > maxInterval) return { duty: cap, interval: MIN_BREAK_MIN };

    const target = preferred || DEFAULT_TARGET_DUTY_MIN;
    const interval = Math.min(
      maxInterval,
      Math.max(minInterval, Math.ceil(target / openCount / SLOT_MIN - 0.5) * SLOT_MIN),
    );
    return { duty: interval * openCount, interval };
  };

  /**
   * Prune: at every pending handover, enough rested and eligible people must
   * exist to relieve the channels falling due within the next 30 minutes, and
   * TSO must have a qualified one.
   */
  const handoversCoverable = () => {
    const pending: Array<{ at: number; channel: number }> = [];
    for (let i = 0; i < k; i++) if (coveredTo[i] < channels[i].closeAt) pending.push({ at: coveredTo[i], channel: i });
    pending.sort((x, y) => x.at - y.at);

    const couldRelieve = (index: number, at: number, channelIndex: number) =>
      restedFor(index, at, channelIndex) &&
      freeToStart(index, at, codes[channelIndex]) &&
      withinCeiling(index, channelIndex, MIN_DUTY_MIN);

    // Each person takes at most one handover of a group, so three counts must
    // each hold: enough people rested from control for the control handovers,
    // enough able to take the TSO handovers — which needs no rest, but does
    // need the qualification — and enough for the group as a whole. Someone
    // counts towards a set if they could take any one handover in it, since
    // each falls at its own minute. Counting too many only prunes less;
    // counting too few would throw away plans that exist.
    for (let a = 0; a < pending.length; a++) {
      if (a && pending[a].at === pending[a - 1].at) continue;
      const at = pending[a].at;
      let b = a;
      while (b + 1 < pending.length && pending[b + 1].at < at + MIN_BREAK_MIN) b++;
      const group = pending.slice(a, b + 1);
      const control = group.filter(entry => !exemptHere(codes[entry.channel]));
      const exempt = group.filter(entry => exemptHere(codes[entry.channel]));
      let forControl = 0;
      let forExempt = 0;
      let forAny = 0;
      for (let index = 0; index < n; index++) {
        if (!couldStartAt(index, at)) continue;
        const takesControl = control.some(entry => couldRelieve(index, entry.at, entry.channel));
        const takesExempt = exempt.some(
          entry => canTakeChannel(people[index], codes[entry.channel]) && couldRelieve(index, entry.at, entry.channel),
        );
        if (takesControl) forControl++;
        if (takesExempt) forExempt++;
        if (takesControl || takesExempt) forAny++;
      }
      if (forControl < control.length || forExempt < exempt.length || forAny < group.length) return false;
    }

    for (let i = 0; i < k; i++) {
      if (!isRestrictedChannel(codes[i]) || coveredTo[i] >= channels[i].closeAt) continue;
      const at = coveredTo[i];
      const ok = people.some(
        (_, index) => qualified[index] && couldStartAt(index, at) && couldRelieve(index, at, i),
      );
      if (!ok) return false;
    }
    return true;
  };

  const placed: Array<{ personIndex: number; channelIndex: number; start: number; end: number }> = [];
  let nodes = 0;

  function search(): boolean {
    if (++nodes > nodeLimit) return false;
    if (stopAt !== undefined && (nodes & 1023) === 0 && Date.now() > stopAt) {
      nodes = nodeLimit + 1;
      return false;
    }

    // Always extend the channel that is covered least far — it is the one that
    // would otherwise open a gap.
    let channelIndex = -1;
    for (let i = 0; i < k; i++) {
      if (coveredTo[i] < channels[i].closeAt && (channelIndex < 0 || coveredTo[i] < coveredTo[channelIndex])) {
        channelIndex = i;
      }
    }
    if (channelIndex < 0) {
      // Fully covered. Reject a plan that left a half person with no duty, or
      // someone short of what they are owed of the duty hours.
      for (let index = 0; index < n; index++) {
        if (needsHalfDuty(index) && halfEnd[half[index]] > 0) return false;
        if (worked[index] < hoursFloor[index]) return false;
      }
      return true;
    }
    if (!handoversCoverable()) return false;

    const channel = channels[channelIndex];
    const code = codes[channelIndex];
    const at = coveredTo[channelIndex];

    // Someone who can no longer reach what they are owed, whatever the rest
    // of the night holds, makes this branch hopeless.
    for (let index = 0; index < n; index++) {
      if (worked[index] < hoursFloor[index] && worked[index] + leftFrom(index, at) < hoursFloor[index]) return false;
    }
    const { duty: targetDuty, interval } = rhythmAt(at, code);

    let candidates: number[] = [];
    for (let index = 0; index < n; index++) {
      if (!restedFor(index, at, channelIndex) || carriesOn(index, at, channelIndex)) continue;
      if (half[index] === 1 && at >= SECOND_HALF[0] && !crossoverChannel(channelIndex)) continue;
      if (half[index] === 2 && at >= FIRST_HALF[0] && at < SECOND_HALF[0]) continue;
      if (!canTakeChannel(people[index], code)) continue;
      if (!freeToStart(index, at, code)) continue;
      if (!withinCeiling(index, channelIndex, MIN_DUTY_MIN)) continue;
      candidates.push(index);
    }

    const isOpening = at === channel.openAt;
    if (forceStarters && isOpening && starterIndex[channelIndex] >= 0) {
      candidates = candidates.filter(index => index === starterIndex[channelIndex]);
    }
    if (!candidates.length) return false;

    /**
     * Somebody due to open another channel shortly must stay free for it —
     * rested too, unless one of the two positions is TSO.
     */
    const reservedUntil = (index: number) => {
      let limit = Number.POSITIVE_INFINITY;
      for (let j = 0; j < k; j++) {
        if (j === channelIndex) continue;
        if (starterIndex[j] === index && coveredTo[j] === channels[j].openAt && channels[j].openAt >= at) {
          limit = Math.min(limit, channels[j].openAt - breakFor(code, codes[j]));
        }
      }
      return limit;
    };

    /** 0 sorts first: the 2nd Half preference for CLD. */
    const secondHalfPreference = (index: number) => {
      if (half[index] !== 2) return 1;
      // Compare on the base code: after a merge, CLD's later stretch carries a
      // suffix, and it is exactly the stretch this preference is about.
      if (code === SECOND_HALF_PREFERRED_CHANNEL && at === SECOND_HALF[0]) return 0;
      if (at < FIRST_HALF[0] && code === SECOND_HALF_PREFERRED_CHANNEL) return 0;
      return 1;
    };

    const restrictedStillOpen = channels.some((c, i) => isRestrictedChannel(codes[i]) && c.closeAt > at);
    const qualifiedScarce = restrictedStillOpen && qualifiedPoolAt(at, code) <= 3;
    const keepForRestricted = (index: number) =>
      !isRestrictedChannel(code) && qualifiedScarce && qualified[index] ? 1 : 0;

    /**
     * How far behind their share of the duty hours someone is by now, in
     * half-hours: most behind first onto a position that counts, and most
     * ahead first onto TSO, which doesn't. Within a half-hour of each other,
     * the usual rotation decides.
     */
    const behind = (index: number) => {
      const lag = Math.floor((worked[index] - dueBy(index, at)) / MIN_BREAK_MIN);
      return counts[channelIndex] ? lag : -lag;
    };

    const insideOwnHalf = (index: number) =>
      (half[index] === 1 && at >= FIRST_HALF[0] && at < SECOND_HALF[0]) || (half[index] === 2 && at >= SECOND_HALF[0]);
    const urgency = (index: number) => (insideOwnHalf(index) && needsHalfDuty(index) ? 0 : 1);
    // Reaching into the other half is a last resort even when it is permitted,
    // so those candidates sort behind everyone who is properly on shift.
    const isCrossover = (index: number) => (half[index] === 1 && at >= SECOND_HALF[0] ? 1 : 0);

    // Prune: more half people still waiting than there are slots left in their half.
    for (const which of [1, 2] as const) {
      const [halfStart] = which === 1 ? FIRST_HALF : SECOND_HALF;
      if (at < halfStart) continue;
      const waiting = half.reduce(
        (count, value, index) => count + (value === which && needsHalfDuty(index) ? 1 : 0),
        0,
      );
      const slots = Math.floor(Math.max(0, halfEnd[which] - at) / MIN_BREAK_MIN) * k + k;
      if (waiting > slots) return false;
    }

    candidates.sort(
      (a, b) =>
        Number(isOpening && b === starterIndex[channelIndex]) - Number(isOpening && a === starterIndex[channelIndex]) ||
        isCrossover(a) - isCrossover(b) ||
        urgency(a) - urgency(b) ||
        Number(reservedUntil(a) < Number.POSITIVE_INFINITY) - Number(reservedUntil(b) < Number.POSITIVE_INFINITY) ||
        behind(a) - behind(b) ||
        keepForRestricted(a) - keepForRestricted(b) ||
        secondHalfPreference(a) - secondHalfPreference(b) ||
        restedSince(a, at) - restedSince(b, at) ||
        worked[a] - worked[b] ||
        Number(lastChannel[a] === channelIndex) - Number(lastChannel[b] === channelIndex) ||
        a - b,
    );

    if (seed) {
      // Jitter the order, but never displace a starter somebody actually
      // chose. A channel with no chosen starter has nothing to protect, so its
      // opening candidate is shuffled like any other — that is what makes a
      // second run with blank starters offer a different night.
      const lockedOpener = isOpening && forceStarters && starterIndex[channelIndex] >= 0;
      for (let i = candidates.length - 1; i > 0; i--) {
        if (random() >= 0.25) continue;
        const j = i - 1;
        if (lockedOpener && (i === 0 || j === 0)) continue;
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
    }

    // End times, longest first, but preferring ends that do not collide with
    // another channel's pending handover — that is what staggers them.
    const tail = channel.closeAt - at;
    if (tail < MIN_DUTY_MIN) return false;
    // With short duties held back, nothing under an hour is offered unless the
    // position has less than an hour left — and no end may leave such a stub.
    const floor = shortDuties || tail < PREFERRED_MIN_DUTY_MIN ? MIN_DUTY_MIN : PREFERRED_MIN_DUTY_MIN;
    // An uncapped position can run to the end of its window, so the candidate
    // list is bounded by the window rather than by the two-hour rule.
    const longest = Math.min(maxDutyFor(code), channel.closeAt - at);
    const ends: number[] = [];
    for (let length = longest; length >= floor; length -= SLOT_MIN) {
      const end = at + length;
      if (end > channel.closeAt) continue;
      // Never leave a stub too short to be a duty at the end of the channel.
      if (channel.closeAt - end > 0 && channel.closeAt - end < floor) continue;
      ends.push(end);
    }
    if (!ends.length) return false;

    // Staggering exists so whoever is relieved can rest before their next
    // control duty. A handover onto or off TSO needs no rest, so TSO neither
    // needs staggering itself nor counts against a control handover — the
    // person relieved at that minute can go straight to it, or from it.
    const collides = (end: number) => {
      if (end === channel.closeAt || exemptHere(code)) return 0;
      for (let j = 0; j < k; j++) {
        if (j === channelIndex || exemptHere(codes[j])) continue;
        if (coveredTo[j] < channels[j].closeAt && Math.abs(coveredTo[j] - end) < interval) return 1;
      }
      return 0;
    };
    // Lengths the office prefers: anything under an hour last of all, then
    // staggered handovers, then 1h / 1h 30m / 2h ahead of 1h 15m / 1h 45m.
    // A usual length someone chose outranks that last preference.
    const rank = (end: number) => dutyLengthRank(end - at, code);
    const isShort = (end: number) => (holdBackShort && rank(end) === 2 ? 1 : 0);
    const fromTarget = (end: number) => Math.abs(end - at - targetDuty);
    ends.sort(
      (a, b) =>
        isShort(a) - isShort(b) ||
        collides(a) - collides(b) ||
        (preferred
          ? fromTarget(a) - fromTarget(b) || rank(a) - rank(b)
          : rank(a) - rank(b) || fromTarget(a) - fromTarget(b)) ||
        b - a,
    );

    for (const personIndex of candidates.slice(0, width)) {
      const limit = reservedUntil(personIndex);
      for (const end of ends) {
        if (end > limit || !rangeAllowed(personIndex, channelIndex, at, end)) continue;
        if (!rangeFree(personIndex, at, end, code)) continue;
        if (!withinCeiling(personIndex, channelIndex, end - at)) continue;

        const saved = [
          lastEnd[personIndex],
          lastControlEnd[personIndex],
          lastChannel[personIndex],
          worked[personIndex],
          coveredTo[channelIndex],
          dutiesInOwnHalf[personIndex],
        ];

        lastEnd[personIndex] = end;
        if (!exemptHere(code)) lastControlEnd[personIndex] = end;
        lastChannel[personIndex] = channelIndex;
        if (counts[channelIndex]) worked[personIndex] += end - at;
        coveredTo[channelIndex] = end;
        if (countsForHalf(personIndex, at, end)) dutiesInOwnHalf[personIndex]++;
        placed.push({ personIndex, channelIndex, start: at, end });

        if (search()) return true;

        placed.pop();
        [
          lastEnd[personIndex],
          lastControlEnd[personIndex],
          lastChannel[personIndex],
          worked[personIndex],
          coveredTo[channelIndex],
          dutiesInOwnHalf[personIndex],
        ] = saved;
        if (nodes > nodeLimit) return false;
      }
    }
    return false;
  }

  if (!search()) return null;
  return [
    ...fixed.map(duty => ({ ...duty })),
    ...placed.map(entry => ({
      id: makeDutyId(),
      personKey: people[entry.personIndex].key,
      channelCode: codes[entry.channelIndex],
      startMin: entry.start,
      endMin: entry.end,
    })),
  ];
}

/** The SMC this night's CLD could fold into, if it needs to. */
function mergeCandidate(state: NightAllocationState): string | null {
  const source = state.channels.find(channel => channel.code === MERGE_SOURCE_CHANNEL);
  if (!source?.inUse) return null;
  // Nothing to gain if CLD is already shut for the whole window.
  if (source.openAt >= MERGE_WINDOW[1] || source.closeAt <= MERGE_WINDOW[0]) return null;
  const target = mergeTargetFor(state);
  // A DB slot on either position during the window rules the merge out: one
  // on CLD can't be folded away, and one on the SMC would hand the trainee a
  // second position as a last resort nobody chose. A duty put on by hand is
  // somebody's decision about the night as it is, so it rules it out too.
  const dbInWindow = state.duties.some(
    duty =>
      isKeptDuty(duty) &&
      (duty.channelCode === MERGE_SOURCE_CHANNEL || duty.channelCode === target) &&
      duty.startMin < MERGE_WINDOW[1] &&
      duty.endMin > MERGE_WINDOW[0],
  );
  return dbInWindow ? null : target;
}

function withMerge(state: NightAllocationState, targetCode: string): NightAllocationState {
  return {
    ...state,
    channels: state.channels.map(channel =>
      channel.code === MERGE_SOURCE_CHANNEL ? { ...channel, mergedInto: targetCode } : channel,
    ),
  };
}

/**
 * Settings that make a plan impossible before any search is worth starting,
 * as the refusal the page shows: what to fix, and the specifics when there is
 * more than one line of them.
 */
function preflight(state: NightAllocationState): { error: string; reasons: string[] } | null {
  const refuse = (error: string, reasons: string[] = []) => ({ error, reasons });
  const channels = openChannels(state);
  if (!activeCount(state)) return refuse("Turn on at least one channel.");
  const tooShort = activeChannelsShorterThanMinimum(state);
  if (tooShort.length) return refuse(`${tooShort.join(", ")} must be open for at least 30 min.`);
  if (!channels.length) return refuse("Every channel in use closes before it opens. Check the open and close times.");

  const available = availablePeople(state);
  if (!available.length) return refuse("Nobody is marked available tonight.");

  // DB slots and duties put on by hand go into every plan exactly as they
  // stand, so one that breaks a rule on its own makes every plan impossible.
  // Said before searching.
  const keptProblems = fixedDutyErrors(state, isKeptDuty);
  if (keptProblems.length) {
    const pinnedIds = new Set(state.duties.filter(isPinnedDuty).map(duty => duty.id));
    const byHand = keptProblems.some(issue => issue.dutyIds.some(id => pinnedIds.has(id)));
    return refuse(
      byHand
        ? "A duty put on by hand breaks a rule, so no plan can keep it. Change it or take it off, then generate again."
        : "A DB slot breaks a rule, so no plan can include it. Change the slot or who instructs it.",
      [...new Set(keptProblems.map(issue => issue.message))],
    );
  }

  // Starters are optional. A channel left blank is filled by the solver, which
  // picks from whoever is eligible and rested at its opening minute. A DB slot
  // at the opening opens the position itself, and the setting gives way to it.
  const startable = channels.filter(channel => !fixedOpeningDuty(state, channel));
  for (const channel of startable) {
    if (!channel.starterKey) continue;
    const starter = findPerson(state, channel.starterKey);
    if (!starter || !starter.available) {
      return refuse(`Everyone you selected must be marked available. Check who starts ${channel.code}.`);
    }
    if (!canTakeChannel(starter, channel.code)) {
      return refuse(
        `${starter.name} isn't marked as able to take TSO, so can't start it. Pick someone with "TSO" turned on.`,
      );
    }
    if (starter.half === "1st" && channel.openAt >= SECOND_HALF[0]) {
      return refuse(`${starter.name} is 1st Half, so can't start ${channel.code} at ${formatMinutes(channel.openAt)}.`);
    }
    if (starter.half === "2nd" && channel.openAt >= FIRST_HALF[0] && channel.openAt < SECOND_HALF[0]) {
      return refuse(`${starter.name} is 2nd Half, so can't start ${channel.code} at ${formatMinutes(channel.openAt)}.`);
    }
    if (!isAvailableAt(starter, channel.openAt)) {
      return refuse(
        `${starter.name} isn't available at ${formatMinutes(channel.openAt)}, so can't start ${channel.code}. ` +
          `Pick someone else, or change their times.`,
      );
    }
  }

  // One person cannot open two channels whose openings are less than a full
  // duty apart — they would still be on the first one.
  for (let i = 0; i < startable.length; i++) {
    for (let j = i + 1; j < startable.length; j++) {
      const a = startable[i];
      const b = startable[j];
      if (!a.starterKey || a.starterKey !== b.starterKey) continue;
      if (Math.abs(a.openAt - b.openAt) >= MAX_DUTY_MIN) continue;
      return refuse(
        `${findPerson(state, a.starterKey as string)?.name ?? "That person"} can't start both ${a.code} and ${b.code}. Pick a different person for one of them.`,
      );
    }
  }

  const halfPeopleUnavailable = state.people.filter(person => person.half && !person.available);
  if (halfPeopleUnavailable.length) {
    return refuse(
      `Everyone you selected must be marked available. Check ${halfPeopleUnavailable.map(p => p.name).join(", ")}.`,
    );
  }

  // Everyone in a half needs a duty inside it, so they have to be around for
  // at least one duty's worth of it.
  const awayForHalf = state.people.filter(person => {
    if (!person.half || !person.available) return false;
    const [from, to] = halfWindow(person.half);
    return minutesAvailable(person, from, to) < MIN_DUTY_MIN;
  });
  if (awayForHalf.length) {
    return refuse(
      `${awayForHalf.map(person => person.name).join(", ")} ${awayForHalf.length === 1 ? "is" : "are"} in a half ` +
        `but away for nearly all of it. Take them out of the half, or change their times.`,
    );
  }

  const short = shortStretchNotices(state);
  if (short.length) return refuse("Part of a position is too short for any duty, so no plan can cover it.", short);
  return null;
}

function activeCount(state: NightAllocationState): number {
  return state.channels.filter(channel => channel.inUse).length;
}

/**
 * Is a search that keeps to the evening rest worth running tonight? Only when
 * someone owed one can be given it — a half hands its people the rest anyway,
 * and on a night too thin to spare anybody the plain night is the one to plan.
 */
export function eveningRestWorthTrying(state: NightAllocationState): boolean {
  return Object.keys(planEveningRests(state).rests).length > 0;
}

/** A small seeded PRNG, as the search uses, so a seeded placement is reproducible. */
function seededRandom(seed: number): () => number {
  let randomState = seed >>> 0;
  return () => {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let x = randomState;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Where the evening rests go, and who could not be given one. */
export interface EveningRestPlan {
  /** Each placed rest, by person key: 4 hours off every position but TSO. */
  rests: Record<string, [number, number]>;
  /** People owed a rest the crew can't spare them for anywhere. */
  unplaced: string[];
}

/**
 * Where everyone still owed an evening rest takes it, placed before the search
 * so the search can keep them off control for it just as it does for time away.
 *
 * A rest is 4 hours off every position but TSO, starting between 16:30 and
 * 23:30 — in practice by 21:30, so it is over by the end of the night. People
 * in a half have one whatever the plan, and so does anyone away for 4 hours of
 * the evening; someone whose DB slots leave no room for one is left alone.
 * Everyone else is placed one at a time, the most constrained first, where
 * the crew can best spare them: the stretch whose thinnest moment still has
 * the most people over what the open positions need. So the rests stagger
 * rather than all starting at 16:30. Someone resting may still take TSO, so a
 * rest held by someone cleared for it doesn't cost TSO its cover.
 *
 * A rest is only placed where it leaves enough people to keep every open
 * position turning at the usual duty length. On a thin night that means some
 * people get one and the rest don't — which is still more than none.
 *
 * A non-zero `seed` breaks ties at random, which is what the restarts vary.
 */
export function planEveningRests(state: NightAllocationState, seed = 0): EveningRestPlan {
  const [windowStart, windowEnd] = EVENING_REST_WINDOW;
  const latestStart = Math.min(windowEnd, NIGHT_SPAN_MIN - EVENING_REST_MIN);
  const people = availablePeople(state);
  const open = openChannels(state);
  const control = open.filter(channel => !isEveningRestExempt(channel.code));
  const exempt = open.filter(channel => isEveningRestExempt(channel.code));
  const random = seededRandom(seed);

  const minutes: number[] = [];
  for (let minute = windowStart; minute < NIGHT_SPAN_MIN; minute += SLOT_MIN) minutes.push(minute);
  const halfAllows = (person: NightPerson, minute: number) =>
    minute < FIRST_HALF[0] || (minute < SECOND_HALF[0] ? person.half !== "2nd" : person.half !== "1st");
  const onHand = (person: NightPerson, minute: number) => isAvailableAt(person, minute) && halfAllows(person, minute);
  const openAt = (list: NightChannel[], minute: number) =>
    list.filter(channel => {
      if (channel.openAt > minute || channel.closeAt <= minute) return false;
      const merged = mergedAwayWindow(state, channel.code);
      return !(merged && minute >= merged[0] && minute < merged[1]);
    });
  // With duties of length L and a 30-minute break after each, one person holds
  // a position for L of every L + 30 minutes, so k open positions take
  // k(L + 30)/L people to keep turning. L is the usual length someone chose —
  // rests don't get to stretch it — or on Auto the longest duty, 2 hours.
  const length = state.dutyLengthPref || MAX_DUTY_MIN;
  const controlNeed = minutes.map(
    minute => (openAt(control, minute).length * (length + MIN_BREAK_MIN)) / length,
  );
  const exemptOpen = minutes.map(minute => openAt(exempt, minute).map(channel => channel.code));
  const working = minutes.map(minute => people.filter(person => onHand(person, minute)).length);
  const resting: NightPerson[][] = minutes.map(() => []);

  /** People to spare at one moment: those not resting, less what control needs and what resting people can't hold. */
  const spareAt = (index: number, extra?: NightPerson) => {
    const off = extra && onHand(extra, minutes[index]) ? [...resting[index], extra] : resting[index];
    const uncovered = exemptOpen[index].filter(code => !off.some(person => canTakeChannel(person, code))).length;
    return working[index] - off.length - controlNeed[index] - uncovered;
  };

  const owed: Array<{ person: NightPerson; starts: number[]; jitter: number }> = [];
  for (const person of people) {
    if (halfGivesEveningRest(person.half)) continue;
    const away = longestEveningBreak(availableSpans(person));
    if (away.to - away.from >= EVENING_REST_MIN) continue;
    const slots = state.duties.filter(
      duty => isKeptDuty(duty) && duty.personKey === person.key && !isEveningRestExempt(duty.channelCode),
    );
    const starts: number[] = [];
    for (let start = windowStart; start <= latestStart; start += SLOT_MIN) {
      if (slots.some(slot => slot.startMin < start + EVENING_REST_MIN && slot.endMin > start)) continue;
      starts.push(start);
    }
    if (starts.length) owed.push({ person, starts, jitter: seed ? random() : 0 });
  }
  owed.sort((a, b) => a.starts.length - b.starts.length || a.jitter - b.jitter);

  const rests: Record<string, [number, number]> = {};
  const unplaced: string[] = [];
  const span = EVENING_REST_MIN / SLOT_MIN;
  for (const { person, starts } of owed) {
    let best: { start: number; thinnest: number; total: number; tie: number } | null = null;
    for (const start of starts) {
      const from = (start - windowStart) / SLOT_MIN;
      // Only the moments they would otherwise be on hand for cost anything.
      let thinnest = Number.POSITIVE_INFINITY;
      let total = 0;
      for (let index = from; index < from + span; index++) {
        const left = spareAt(index, person);
        if (onHand(person, minutes[index])) thinnest = Math.min(thinnest, left);
        total += left;
      }
      const tie = seed ? random() : 0;
      if (
        !best ||
        thinnest > best.thinnest ||
        (thinnest === best.thinnest && (total > best.total || (total === best.total && tie > best.tie)))
      ) {
        best = { start, thinnest, total, tie };
      }
    }
    if (!best || best.thinnest < 0) {
      unplaced.push(person.key);
      continue;
    }
    const from = (best.start - windowStart) / SLOT_MIN;
    for (let index = from; index < from + span; index++) {
      if (onHand(person, minutes[index])) resting[index].push(person);
    }
    rests[person.key] = [best.start, best.start + EVENING_REST_MIN];
  }
  return { rests, unplaced };
}

function activeChannelsShorterThanMinimum(state: NightAllocationState): string[] {
  return state.channels
    .filter(channel => channel.inUse && channel.closeAt - channel.openAt < MIN_DUTY_MIN)
    .map(channel => channel.code);
}

/**
 * How the randomised-restart budget is shared between the attempts, in
 * proportion to their weights.
 *
 * The plain night is weighted highest: it is the plan the office would rather
 * have. Every attempt still gets restarts of its own. Spent in one pool, the
 * first attempt used the lot, and a night that could only be covered by a
 * relaxation got two fixed passes at it and no more.
 */
export function restartBudgets(totalMs: number, weights: number[]): number[] {
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (!sum) return weights.map(() => 0);
  return weights.map(weight => (totalMs * weight) / sum);
}

export interface GenerateOptions {
  /** Wall-clock budget in milliseconds for the randomised restarts. */
  budgetMs?: number;
  /**
   * Wall-clock time in milliseconds to spend, once a plan is found, looking
   * for one that stands better — more even duty hours above all. Half the
   * budget unless given, and on top of it. None of it is spent when the first
   * plan already can't be bettered where it matters: everyone within
   * `HOURS_TOLERANCE_MIN` of their share and on a position other than TSO,
   * every evening rest kept, and a real break after every duty.
   */
  polishMs?: number;
  /** Injectable clock, so tests do not depend on how fast the machine is. */
  now?: () => number;
  /**
   * Seed for the pass that fills in unchosen starters. Left out, a fresh one is
   * drawn each run, so generating twice with blank starters offers two
   * different nights rather than the same one. Pass it to make a run
   * reproducible — the tests do.
   */
  seed?: number;
}

/**
 * The longest a generate may run, on the real clock, whatever its budget. The
 * budget shares out the randomised restarts; the fixed searches each attempt
 * starts with are not timed, and on a night with no plan the attempts
 * together could run past the API's 30-second limit — which the page could
 * only report as a failure, where a refusal says why.
 */
export const GENERATE_HARD_STOP_MS = 20_000;

/** Short searches for an even night made before each attempt's usual ones. */
const EVEN_TRIES = 3;

/** Node budget of one search for an even night — see `sweep`. */
const EVEN_NODE_LIMIT = 5_000;

/**
 * How evenly a plan shares out the duty hours, TSO not counted: how many
 * people are on TSO and nothing else though they could hold another position,
 * how far the furthest over their fair share is from the furthest under it,
 * and the sum of everyone's squared distance from theirs.
 */
export function hoursSpread(state: NightAllocationState): { tsoOnly: number; spread: number; squares: number } {
  const shares = fairShares(state);
  let tsoOnly = 0;
  let most = Number.NEGATIVE_INFINITY;
  let least = Number.POSITIVE_INFINITY;
  let squares = 0;
  for (const person of availablePeople(state)) {
    const counted = countedMinutesOnDuty(state, person.key);
    const share = shares.get(person.key)?.share ?? 0;
    const off = counted - share;
    most = Math.max(most, off);
    least = Math.min(least, off);
    squares += off * off;
    if (
      counted === 0 &&
      share >= MIN_DUTY_MIN &&
      state.duties.some(duty => duty.personKey === person.key && !countsTowardsHours(duty.channelCode))
    ) {
      tsoOnly++;
    }
  }
  return { tsoOnly, spread: Number.isFinite(most) ? most - least : 0, squares };
}

/**
 * A plan's standing, compared in order, lower first: nobody on TSO alone, the
 * evening rests kept, duty hours within the tolerance of everyone's share, as
 * few moves straight onto or off TSO as possible — a real break is still
 * better where the night allows one — as few duties under an hour, and then
 * as even as possible. The evening rest comes before even duty hours: nobody
 * loses their 4 hours off for a more even night.
 */
function planStanding(state: NightAllocationState): number[] {
  const { tsoOnly, spread, squares } = hoursSpread(state);
  const short = state.duties.filter(
    duty => !isKeptDuty(duty) && duty.endMin - duty.startMin < PREFERRED_MIN_DUTY_MIN,
  ).length;
  let straight = 0;
  const byPerson = new Map<string, NightDuty[]>();
  for (const duty of state.duties) {
    if (!duty.personKey) continue;
    byPerson.set(duty.personKey, [...(byPerson.get(duty.personKey) ?? []), duty]);
  }
  for (const mine of byPerson.values()) {
    mine.sort((a, b) => a.startMin - b.startMin);
    for (let index = 1; index < mine.length; index++) if (mine[index - 1].endMin === mine[index].startMin) straight++;
  }
  return [
    tsoOnly,
    eveningRestShortfalls(state).length,
    Math.ceil(Math.max(0, spread - 2 * HOURS_TOLERANCE_MIN) / MIN_BREAK_MIN),
    straight,
    short,
    Math.round(squares / 100),
  ];
}

const standsBetter = (a: number[], b: number[]) => {
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] < b[index];
  return false;
};

/**
 * Evens out a finished plan's duty hours by handing duties from whoever is
 * furthest over their fair share to whoever is furthest under it: a duty
 * given outright, or two exchanged — often one of them TSO, so the person
 * under takes the position and the person over takes TSO instead.
 *
 * Only a change that breaks no hard rule and leaves the plan standing better
 * (`planStanding`) and leaves everyone who had their evening rest still with
 * it — not merely as many people — and it gives up a real break or a duty's
 * length only for more even hours. DB
 * slots, duties put on by hand and `locked` duties never move.
 */
export function evenOutHours(
  state: NightAllocationState,
  { until = () => false, locked = new Set<string>() }: { until?: () => boolean; locked?: ReadonlySet<string> } = {},
): NightAllocationState {
  const movable = (duty: NightDuty) => !isKeptDuty(duty) && !isBlank(duty) && !locked.has(duty.id);
  /** Who has no evening rest. Nobody who has one is ever left without it here. */
  const restless = (entry: NightAllocationState) =>
    new Set(eveningRestShortfalls(entry).map(shortfall => shortfall.person.key));
  let current = state;
  let standing = planStanding(current);
  let without = restless(current);

  for (let step = 0; step < 100 && !until(); step++) {
    const shares = fairShares(current);
    const people = availablePeople(current);
    const off = new Map(
      people.map(person => [
        person.key,
        countedMinutesOnDuty(current, person.key) - (shares.get(person.key)?.share ?? 0),
      ]),
    );
    const byOff = [...people].sort((a, b) => (off.get(b.key) ?? 0) - (off.get(a.key) ?? 0));
    const over = byOff.slice(0, 3);
    const under = byOff.slice(-3).reverse();

    let improved = false;
    for (const heavy of over) {
      for (const light of under) {
        if ((off.get(heavy.key) ?? 0) <= (off.get(light.key) ?? 0)) continue;
        let best: NightAllocationState | null = null;
        let bestStanding = standing;
        let bestWithout = without;
        for (const candidate of exchanges(current, heavy, light, movable)) {
          if (until()) break;
          if (hardRuleErrors(candidate).length) continue;
          const next = planStanding(candidate);
          if (!standsBetter(next, bestStanding)) continue;
          const nextWithout = restless(candidate);
          if ([...nextWithout].some(key => !without.has(key))) continue;
          best = candidate;
          bestStanding = next;
          bestWithout = nextWithout;
        }
        if (!best) continue;
        current = best;
        standing = bestStanding;
        without = bestWithout;
        improved = true;
        break;
      }
      if (improved) break;
    }
    if (!improved) break;
  }
  return current;
}

/**
 * The boards `evenOutHours` weighs up for one pair: each of `heavy`'s duties
 * that count given to `light`, and each exchanged for one of `light`'s that
 * counts for less. Only what could pass the rules at a glance — someone
 * cleared for the position, around, and not on anything else then — is
 * offered; the rules have the last word.
 */
function exchanges(
  state: NightAllocationState,
  heavy: NightPerson,
  light: NightPerson,
  movable: (duty: NightDuty) => boolean,
): NightAllocationState[] {
  const theirs = (key: string) => state.duties.filter(duty => duty.personKey === key && !isBlank(duty));
  const counted = (duty: NightDuty) => (countsTowardsHours(duty.channelCode) ? duty.endMin - duty.startMin : 0);
  const clear = (key: string, start: number, end: number, except: string) =>
    theirs(key).every(duty => duty.id === except || duty.endMin <= start || duty.startMin >= end);
  const canHold = (person: NightPerson, duty: NightDuty, except: string) =>
    canTakeChannel(person, duty.channelCode) &&
    isFreeDuring(person, duty.startMin, duty.endMin) &&
    clear(person.key, duty.startMin, duty.endMin, except);
  const reassigned = (changes: Array<[string, string]>) => {
    const holders = new Map(changes);
    return {
      ...state,
      duties: state.duties.map(duty =>
        holders.has(duty.id) ? { ...duty, personKey: holders.get(duty.id) as string } : duty,
      ),
    };
  };

  const out: NightAllocationState[] = [];
  const lighter = theirs(light.key).filter(movable);
  for (const given of theirs(heavy.key)) {
    if (!movable(given) || !counted(given)) continue;
    if (canHold(light, given, "")) out.push(reassigned([[given.id, light.key]]));
    for (const taken of lighter) {
      if (counted(taken) >= counted(given)) continue;
      if (!canHold(light, given, taken.id) || !canHold(heavy, taken, given.id)) continue;
      out.push(
        reassigned([
          [given.id, light.key],
          [taken.id, heavy.key],
        ]),
      );
    }
  }
  return out;
}

/**
 * Run the solver on a night's settings.
 *
 * Returns a complete, gap-free set of duties, or `ok: false` with the staffing
 * notices that explain why one does not exist. It never returns a partial plan,
 * and it never touches the state it was given.
 *
 * DB slots and duties put on the board by hand are kept exactly where they are
 * and the rest of the night is planned around them. Everything else on the
 * board — the last plan's duties, and blanks — is replaced.
 *
 * Duty hours — every position but TSO — are shared out as evenly as the night
 * allows, and everyone who can gets a position other than TSO: each attempt
 * below is made first keeping everyone within `HOURS_TOLERANCE_MIN` of their
 * fair share, then as before. Once a plan is found, what is left of the time
 * goes on looking for a more even one (`polishMs`).
 */
export function generateAllocation(
  state: NightAllocationState,
  { budgetMs, polishMs, now = () => Date.now(), seed: fixedSeed }: GenerateOptions = {},
): GenerateResult {
  const blocked = preflight(state);
  if (blocked) return { ok: false, error: blocked.error, reasons: blocked.reasons };

  const staffing = staffingNotices(state);
  const rhythmNote = dutyLengthNote(state);
  // A night the staffing check already calls impossible gets a shorter budget:
  // the search will almost certainly fail, and the notices are the real answer.
  const budget = budgetMs ?? (staffing.length ? 500 : 1500);
  const polishBudget = polishMs ?? budget / 2;
  const startedAt = now();
  const stopAt = Date.now() + GENERATE_HARD_STOP_MS;
  const stopped = () => Date.now() > stopAt;

  // Channels nobody has chosen a starter for are filled by the search. Varying
  // the seed each run means a second press offers a different night rather than
  // repeating the first one.
  const anyStarterChosen = openChannels(state).some(
    channel => channel.starterKey && !fixedOpeningDuty(state, channel),
  );
  const baseSeed = fixedSeed ?? (1 + Math.floor(Math.random() * 100_000));

  const starterNote =
    "Continuous plan made, but not every chosen starter could start their channel. See suggestions.";
  const shortNote =
    "Continuous plan made, but not every duty could be 1h or more. The shorter ones are listed in suggestions.";
  const crossoverNote =
    `Continuous plan made, but only by letting a 1st Half person cover ${CROSS_HALF_CHANNEL} in the 2nd Half. ` +
    "See suggestions.";

  type Attempt = {
    state: NightAllocationState;
    crossover: boolean;
    shortDuties: boolean;
    tsoWithoutBreak: boolean;
    eveningRest?: boolean;
    mergedInto: string | null;
    weight: number;
  };
  /** A plan one attempt found, and whether it kept every chosen starter. */
  type Found = { duties: NightDuty[]; forced: boolean };

  /** The search, with one attempt's relaxations, and whatever else varies. */
  const solveAttempt = (attempt: Attempt, options: SolveOptions) =>
    solveContinuous(attempt.state, {
      allowCrossHalfTso: attempt.crossover,
      shortDuties: attempt.shortDuties,
      tsoWithoutBreak: attempt.tsoWithoutBreak,
      stopAt,
      ...options,
    });
  // A search keeping to the evening rest is a preference being tried. Each
  // restart places the rests afresh.
  const restsFor = (attempt: Attempt, seed: number) =>
    attempt.eveningRest ? planEveningRests(attempt.state, seed).rests : undefined;

  /**
   * One sweep of the search, against one relaxation of the rules. Its
   * randomised restarts run until `deadline` on the injected clock.
   *
   * Even duty hours come first, then the night as it was planned before they
   * were asked for — so every night that planned then still plans, and the
   * polish below evens it out — and the restarts go on taking turns.
   */
  const sweep = (attempt: Attempt, deadline: number): Found | null => {
    // Even duty hours are found fastest by short randomised searches — a long
    // one spends its nodes backtracking over the first few hours of the night
    // — so a few of those first, as long as the attempt's time lasts, each
    // cheap enough that a night they can't plan loses little.
    // The last of them may take TSO straight on and off, which is the rule —
    // an even night is much easier to find with it — though a real break is
    // tried first.
    let even: Found | null = null;
    for (let round = 0; round < EVEN_TRIES && (round === 0 || now() < deadline); round++) {
      const seed = baseSeed + 1_000 + round;
      const duties = solveAttempt(attempt, {
        forceStarters: true,
        nodeLimit: EVEN_NODE_LIMIT,
        width: 8,
        seed,
        rests: restsFor(attempt, seed),
        balance: HOURS_TOLERANCE_MIN,
        tsoWithoutBreak: attempt.tsoWithoutBreak || round === EVEN_TRIES - 1,
      });
      if (duties) {
        even = { duties, forced: true };
        break;
      }
    }

    // On a night it can't hold, a search keeping to the evening rest would
    // only spend what the plain night needs.
    const nodeLimit = attempt.eveningRest ? 20_000 : 60_000;
    const openingSeed = anyStarterChosen ? 0 : baseSeed;
    const rests = restsFor(attempt, 0);
    for (const forceStarters of [true, false]) {
      // With an even plan in hand, the night as it was planned before is only
      // wanted beside it, so that whichever keeps more evening rests is kept:
      // the rest comes before even hours.
      if (even && !forceStarters) break;
      const duties = solveAttempt(attempt, {
        forceStarters,
        nodeLimit,
        seed: openingSeed,
        rests,
        everyoneOnControl: false,
      });
      if (!duties) continue;
      const found = { duties, forced: forceStarters };
      if (!even) return found;
      const standing = (entry: Found) => planStanding({ ...attempt.state, duties: entry.duties });
      return standsBetter(standing(found), standing(even)) ? found : even;
    }
    if (even) return even;

    // The restarts take turns: even hours, then everyone on a position other
    // than TSO, then — on a night too thin for that — the night as it was
    // planned before either was asked for. What that leaves uneven the polish
    // below tries to put right, and the suggestions name.
    for (let round = 1; now() < deadline && !stopped(); round++) {
      const forceStarters = round % 2 === 1;
      const turn = Math.floor((round - 1) / 2) % 3;
      const balance = turn === 0 ? HOURS_TOLERANCE_MIN : null;
      const duties = solveAttempt(attempt, {
        forceStarters,
        nodeLimit: balance === null ? 25_000 : EVEN_NODE_LIMIT,
        width: 8,
        seed: baseSeed + round,
        rests: restsFor(attempt, baseSeed + round),
        balance,
        everyoneOnControl: turn !== 2,
      });
      if (duties) return { duties, forced: forceStarters };
    }
    return null;
  };

  /**
   * The chosen starters' opening duties, which evening out never moves: a
   * starter somebody chose is a decision about the night.
   */
  const startersHeld = (duties: NightDuty[]) =>
    new Set(
      duties
        .filter(duty =>
          openChannels(state).some(
            channel =>
              channel.code === duty.channelCode &&
              channel.starterKey === duty.personKey &&
              channel.openAt === duty.startMin,
          ),
        )
        .map(duty => duty.id),
    );

  /**
   * A plan that stands better — more even duty hours, above all — until
   * `polishBudget` runs out. The plan found is evened out duty by duty first;
   * if that is not enough, more searches of the same attempt are made and
   * each evened out in turn. A plan within the tolerance for everyone, with
   * nobody on TSO alone, every rest kept and a real break after every duty,
   * can't be bettered where it matters, and is kept as it is.
   */
  const restsWorthTrying = eveningRestWorthTrying(state);
  const polish = (attempt: Attempt, found: Found): NightDuty[] => {
    const settled = (entry: number[]) => entry.slice(0, 4).every(value => value === 0);
    const first = planStanding({ ...attempt.state, duties: found.duties });
    if (settled(first) || polishBudget <= 0) return found.duties;
    const until = now() + polishBudget;
    const outOfTime = () => now() >= until || stopped();
    const evened = (duties: NightDuty[]) =>
      evenOutHours({ ...attempt.state, duties }, { until: outOfTime, locked: startersHeld(duties) }).duties;

    let best = evened(found.duties);
    let standing = planStanding({ ...attempt.state, duties: best });
    const consider = (duties: NightDuty[] | null) => {
      if (!duties) return;
      const candidate = evened(duties);
      const next = planStanding({ ...attempt.state, duties: candidate });
      if (!standsBetter(next, standing)) return;
      best = candidate;
      standing = next;
    };

    // A plan from an attempt that went without the evening rests — they ran
    // out of time, or couldn't all be kept — is weighed first against plans
    // that keep them, searched the way most likely to find one: the rest
    // comes before even hours, which the evening out then sees to.
    if (restsWorthTrying && !attempt.eveningRest && standing[1] > 0) {
      const rested = { ...attempt, eveningRest: true };
      for (let round = 1; round <= EVEN_TRIES * 2 && standing[1] > 0 && !outOfTime(); round++) {
        const seed = baseSeed + 4099 * round;
        consider(
          solveAttempt(rested, {
            forceStarters: found.forced,
            nodeLimit: 25_000,
            width: 8,
            seed,
            rests: restsFor(rested, seed),
            tsoWithoutBreak: attempt.tsoWithoutBreak || round % 2 === 1,
          }),
        );
      }
    }

    for (let round = 1; !settled(standing) && !outOfTime(); round++) {
      const seed = baseSeed + 7919 * round;
      // Even hours, then nearly even, then only everyone on a position other
      // than TSO — each a little easier to find than the one before — and
      // every other search goes straight onto and off TSO, as the rule allows.
      const balance = [HOURS_TOLERANCE_MIN, 2 * HOURS_TOLERANCE_MIN, null][round % 3];
      consider(
        solveAttempt(attempt, {
          forceStarters: found.forced,
          nodeLimit: balance === null ? 25_000 : EVEN_NODE_LIMIT,
          width: 8,
          seed,
          rests: restsFor(attempt, seed),
          balance,
          tsoWithoutBreak: attempt.tsoWithoutBreak || round % 2 === 0,
        }),
      );
    }
    return best;
  };

  // Relaxations are tried in order of how much they change the night, and only
  // when the plainer version found nothing. Duties under an hour come first:
  // the office accepts them when there is no other way, while the TSO crossover
  // and the merge are last resorts. A merge the user has already ticked is not
  // a relaxation — it is the night as configured — so it is not retried.
  //
  // Going straight onto or off TSO is not a relaxation either: it is the rule.
  // But each length is tried with a real break after every duty first. The
  // narrower search finds those nights fastest — every night that planned
  // before TSO needed no break still plans exactly as it did — and only then
  // is the same length tried with TSO taken straight onto and off.
  const alreadyMerged = !!activeMerge(state);
  const mergeTarget = alreadyMerged ? null : mergeCandidate(state);
  const merged = mergeTarget ? withMerge(state, mergeTarget) : null;
  // A usual length under an hour was chosen, so there is no all-long night to try first.
  const shortChosen = !!state.dutyLengthPref && state.dutyLengthPref < PREFERRED_MIN_DUTY_MIN;

  // Without an open TSO the two searches are the same one, so it runs once.
  const tsoOpen = openChannels(state).some(channel => isBreakExempt(channel.code));

  const attempts: Attempt[] = [];
  const plain = { state, crossover: false, mergedInto: null };
  // The evening rest comes first: the night as it would otherwise be planned,
  // with everyone also getting 4 hours off from 16:30. It is a preference, so
  // it is the first thing given up — before short duties, the TSO crossover
  // or the merge — and it is only tried where it could possibly hold.
  if (restsWorthTrying) {
    const evening = { ...plain, shortDuties: shortChosen, eveningRest: true };
    attempts.push({ ...evening, tsoWithoutBreak: false, weight: 1 });
    if (tsoOpen) attempts.push({ ...evening, tsoWithoutBreak: true, weight: 1 });
  }
  if (!shortChosen) {
    attempts.push({ ...plain, shortDuties: false, tsoWithoutBreak: false, weight: 2 });
    if (tsoOpen) attempts.push({ ...plain, shortDuties: false, tsoWithoutBreak: true, weight: 1 });
  }
  attempts.push({ ...plain, shortDuties: true, tsoWithoutBreak: false, weight: 2 });
  if (tsoOpen) attempts.push({ ...plain, shortDuties: true, tsoWithoutBreak: true, weight: 1 });
  attempts.push({ state, crossover: true, shortDuties: true, tsoWithoutBreak: tsoOpen, mergedInto: null, weight: 1 });
  if (merged && mergeTarget) {
    const mergedAttempt = { state: merged, shortDuties: true, tsoWithoutBreak: tsoOpen, mergedInto: mergeTarget };
    attempts.push({ ...mergedAttempt, crossover: false, weight: 1 });
    attempts.push({ ...mergedAttempt, crossover: true, weight: 1 });
  }

  // Deadlines are cumulative, so the whole run still ends inside the budget.
  const shares = restartBudgets(
    budget,
    attempts.map(attempt => attempt.weight),
  );

  // Whatever else the note says, a plan that leaves someone without their
  // evening rest says that too — the suggestions name who — and so does one
  // that couldn't share the duty hours out evenly. Duties put on by hand are
  // said to have been kept.
  const kept = state.duties.filter(isPinnedDuty).length;
  const finish = (result: Extract<GenerateResult, { ok: true }>): GenerateResult => {
    const sentences: string[] = [];
    const missed = eveningRestShortfalls(result.state).length;
    if (missed) {
      sentences.push(
        `${missed === 1 ? "One person" : `${missed} people`} couldn't be given ` +
          `${formatDuration(EVENING_REST_MIN)} off in a row from ${formatMinutes(EVENING_REST_WINDOW[0])}. See suggestions.`,
      );
    }
    const { heaviest, exemptOnly } = hoursImbalance(result.state);
    if (heaviest || exemptOnly.length) {
      sentences.push("Duty hours couldn't be shared out quite evenly tonight. See suggestions.");
    }
    if (kept) {
      sentences.push(
        kept === 1
          ? "The duty put on by hand was kept and the rest planned around it."
          : `The ${kept} duties put on by hand were kept and the rest planned around them.`,
      );
    }
    if (!sentences.length) return result;
    return { ...result, note: `${result.note ?? "Continuous plan made."} ${sentences.join(" ")}` };
  };

  let deadline = startedAt;
  for (const [index, attempt] of attempts.entries()) {
    if (stopped()) break;
    deadline += shares[index];
    const found = sweep(attempt, deadline);
    if (!found) continue;
    const duties = polish(attempt, found);
    const planned: NightAllocationState = { ...attempt.state, duties };

    if (attempt.mergedInto) {
      return finish({
        ok: true,
        state: planned,
        mergedInto: attempt.mergedInto,
        note:
          `Continuous plan made, but only by merging ${MERGE_SOURCE_CHANNEL} into ${attempt.mergedInto} ` +
          `${formatRange(MERGE_WINDOW[0], MERGE_WINDOW[1])}. See suggestions.`,
      });
    }
    if (attempt.crossover) return finish({ ok: true, state: planned, note: crossoverNote });
    // Say so when the all-long attempt failed and the plan needed short duties.
    const neededShort =
      !shortChosen &&
      attempt.shortDuties &&
      duties.some(duty => !isKeptDuty(duty) && duty.endMin - duty.startMin < PREFERRED_MIN_DUTY_MIN);
    const note = neededShort ? shortNote : found.forced || !anyStarterChosen ? rhythmNote : starterNote;
    return finish({ ok: true, state: planned, note });
  }

  return {
    ok: false,
    error: "No allocation made. There is no way to keep every channel continuous with these settings.",
    reasons: staffing.length
      ? staffing
      : ["Try a different starting person for a channel, change a channel's open time, or move someone out of a half."],
  };
}
