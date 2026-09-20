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
  FIRST_HALF,
  MERGE_SOURCE_CHANNEL,
  MERGE_WINDOW,
  MAX_DUTY_MIN,
  MIN_BREAK_MIN,
  MIN_DUTY_MIN,
  SECOND_HALF,
  SECOND_HALF_PREFERRED_CHANNEL,
  SLOT_MIN,
} from "./constants.js";
import { makeDutyId } from "./ids.js";
import {
  activeMerge,
  availablePeople,
  canTakeChannel,
  findPerson,
  isRestrictedChannel,
  maxDutyFor,
  mergeTargetFor,
  openChannels,
  staffingNotices,
  dutyLengthNote,
} from "./rules.js";
import type { NightChannel } from "./types.js";
import { formatMinutes } from "./time.js";
import type { GenerateResult, NightAllocationState, NightDuty } from "./types.js";

/**
 * A merged position is planned as two separate stretches — before the merge
 * and after it — because the search models a channel as one continuous window.
 * The second stretch carries this suffix so the two never collide, and it is
 * stripped again on the way out.
 */
const MERGE_SEGMENT_SUFFIX = "\u0000after-merge";

const baseCode = (code: string) => code.split("\u0000")[0];

/**
 * The channels as the search should see them. With CLD merged into SMC, CLD
 * disappears for the merge window and reappears afterwards as its own stretch.
 */
function solverChannels(state: NightAllocationState): NightChannel[] {
  const merge = activeMerge(state);
  const open = openChannels(state);
  if (!merge) return open;

  const out: NightChannel[] = [];
  for (const channel of open) {
    if (channel.code !== merge.source.code) {
      out.push(channel);
      continue;
    }
    const before: NightChannel = { ...channel, closeAt: Math.min(channel.closeAt, MERGE_WINDOW[0]) };
    const after: NightChannel = {
      ...channel,
      code: channel.code + MERGE_SEGMENT_SUFFIX,
      openAt: Math.max(channel.openAt, MERGE_WINDOW[1]),
      // Whoever was chosen to open CLD opens the first stretch, not the second.
      starterKey: null,
    };
    if (before.closeAt - before.openAt >= MIN_DUTY_MIN) out.push(before);
    if (after.closeAt - after.openAt >= MIN_DUTY_MIN) out.push(after);
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
  }: SolveOptions = {},
): NightDuty[] | null {
  const preferred = state.dutyLengthPref || 0;

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
  const k = channels.length;
  if (!n || !k) return null;

  /** 0 = no half, 1 = 1st Half, 2 = 2nd Half. */
  const half = people.map(person => (person.half === "1st" ? 1 : person.half === "2nd" ? 2 : 0));
  const qualified = people.map(person => person.canTakeTso);
  const starterIndex = channels.map(channel =>
    channel.starterKey ? people.findIndex(person => person.key === channel.starterKey) : -1,
  );

  const lastEnd = new Array<number>(n).fill(Number.NEGATIVE_INFINITY);
  const lastChannel = new Array<number>(n).fill(-1);
  const worked = new Array<number>(n).fill(0);
  const dutiesInOwnHalf = new Array<number>(n).fill(0);
  const coveredTo = channels.map(channel => channel.openAt);

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
    allowCrossHalfTso && channels[channelIndex].code === CROSS_HALF_CHANNEL;

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
      if (allowCrossHalfTso && channels.some(c => c.code === CROSS_HALF_CHANNEL && c.closeAt > at)) return true;
      return at <= SECOND_HALF[0] - MIN_BREAK_MIN;
    }
    if (half[index] === 2) return at <= FIRST_HALF[0] - MIN_BREAK_MIN || at >= SECOND_HALF[0];
    return true;
  };

  const channelsOpenAt = (at: number) =>
    channels.reduce((count, channel) => count + (channel.openAt <= at && channel.closeAt > at ? 1 : 0), 0);

  const poolAt = (at: number) =>
    half.reduce(
      (count, which) =>
        count + (at < FIRST_HALF[0] ? 1 : at < SECOND_HALF[0] ? (which !== 2 ? 1 : 0) : which !== 1 ? 1 : 0),
      0,
    );

  const qualifiedPoolAt = (at: number) =>
    half.reduce((count, which, index) => {
      if (!qualified[index]) return count;
      const free = at < FIRST_HALF[0] ? true : at < SECOND_HALF[0] ? which !== 2 : which !== 1;
      return count + (free ? 1 : 0);
    }, 0);

  /**
   * The handover rhythm at a point in the night: the duty length to aim for and
   * the interval between handovers that produces it.
   */
  const rhythmAt = (at: number, code: string) => {
    const cap = maxDutyFor(code);
    const restricted = isRestrictedChannel(code);
    const openCount = restricted ? 1 : Math.max(1, channelsOpenAt(at));
    const pool = restricted ? qualifiedPoolAt(at) : poolAt(at);
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
    const pending: number[] = [];
    for (let i = 0; i < k; i++) if (coveredTo[i] < channels[i].closeAt) pending.push(coveredTo[i]);
    pending.sort((a, b) => a - b);

    for (let a = 0; a < pending.length; a++) {
      if (a && pending[a] === pending[a - 1]) continue;
      const at = pending[a];
      let b = a;
      while (b + 1 < pending.length && pending[b + 1] < at + MIN_BREAK_MIN) b++;
      const demand = b - a + 1;
      const latest = pending[b];
      let supply = 0;
      for (let index = 0; index < n; index++) {
        if (lastEnd[index] <= latest - MIN_BREAK_MIN && couldStartAt(index, at)) supply++;
      }
      if (supply < demand) return false;
    }

    for (let i = 0; i < k; i++) {
      if (!isRestrictedChannel(channels[i].code) || coveredTo[i] >= channels[i].closeAt) continue;
      const at = coveredTo[i];
      const ok = people.some(
        (_, index) => qualified[index] && lastEnd[index] <= at - MIN_BREAK_MIN && couldStartAt(index, at),
      );
      if (!ok) return false;
    }
    return true;
  };

  const placed: Array<{ personIndex: number; channelIndex: number; start: number; end: number }> = [];
  let nodes = 0;

  function search(): boolean {
    if (++nodes > nodeLimit) return false;

    // Always extend the channel that is covered least far — it is the one that
    // would otherwise open a gap.
    let channelIndex = -1;
    for (let i = 0; i < k; i++) {
      if (coveredTo[i] < channels[i].closeAt && (channelIndex < 0 || coveredTo[i] < coveredTo[channelIndex])) {
        channelIndex = i;
      }
    }
    if (channelIndex < 0) {
      // Fully covered. Reject a plan that left a half person with no duty.
      for (let index = 0; index < n; index++) {
        if (needsHalfDuty(index) && halfEnd[half[index]] > 0) return false;
      }
      return true;
    }
    if (!handoversCoverable()) return false;

    const channel = channels[channelIndex];
    const at = coveredTo[channelIndex];
    const { duty: targetDuty, interval } = rhythmAt(at, channel.code);

    let candidates: number[] = [];
    for (let index = 0; index < n; index++) {
      if (lastEnd[index] > at - MIN_BREAK_MIN) continue;
      if (half[index] === 1 && at >= SECOND_HALF[0] && !crossoverChannel(channelIndex)) continue;
      if (half[index] === 2 && at >= FIRST_HALF[0] && at < SECOND_HALF[0]) continue;
      if (!canTakeChannel(people[index], channel.code)) continue;
      candidates.push(index);
    }

    const isOpening = at === channel.openAt;
    if (forceStarters && isOpening && starterIndex[channelIndex] >= 0) {
      candidates = candidates.filter(index => index === starterIndex[channelIndex]);
    }
    if (!candidates.length) return false;

    /** Somebody due to open another channel shortly must stay free for it. */
    const reservedUntil = (index: number) => {
      let limit = Number.POSITIVE_INFINITY;
      for (let j = 0; j < k; j++) {
        if (j === channelIndex) continue;
        if (starterIndex[j] === index && coveredTo[j] === channels[j].openAt && channels[j].openAt >= at) {
          limit = Math.min(limit, channels[j].openAt - MIN_BREAK_MIN);
        }
      }
      return limit;
    };

    /** 0 sorts first: the 2nd Half preference for CLD. */
    const secondHalfPreference = (index: number) => {
      if (half[index] !== 2) return 1;
      // Compare on the base code: after a merge, CLD's later stretch carries a
      // suffix, and it is exactly the stretch this preference is about.
      if (baseCode(channel.code) === SECOND_HALF_PREFERRED_CHANNEL && at === SECOND_HALF[0]) return 0;
      if (at < FIRST_HALF[0] && baseCode(channel.code) === SECOND_HALF_PREFERRED_CHANNEL) return 0;
      return 1;
    };

    const restrictedStillOpen = channels.some(c => isRestrictedChannel(c.code) && c.closeAt > at);
    const qualifiedScarce = restrictedStillOpen && qualifiedPoolAt(at) <= 3;
    const keepForRestricted = (index: number) =>
      !isRestrictedChannel(channel.code) && qualifiedScarce && qualified[index] ? 1 : 0;

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
        keepForRestricted(a) - keepForRestricted(b) ||
        Number(reservedUntil(a) < Number.POSITIVE_INFINITY) - Number(reservedUntil(b) < Number.POSITIVE_INFINITY) ||
        secondHalfPreference(a) - secondHalfPreference(b) ||
        lastEnd[a] - lastEnd[b] ||
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
    // An uncapped position can run to the end of its window, so the candidate
    // list is bounded by the window rather than by the two-hour rule.
    const longest = Math.min(maxDutyFor(channel.code), channel.closeAt - at);
    const ends: number[] = [];
    for (let length = longest; length >= MIN_DUTY_MIN; length -= SLOT_MIN) {
      const end = at + length;
      if (end > channel.closeAt) continue;
      // Never leave a stub too short to be a duty at the end of the channel.
      if (channel.closeAt - end > 0 && channel.closeAt - end < MIN_DUTY_MIN) continue;
      ends.push(end);
    }
    if (!ends.length) return false;

    const collides = (end: number) => {
      if (end === channel.closeAt) return 0;
      for (let j = 0; j < k; j++) {
        if (j === channelIndex) continue;
        if (coveredTo[j] < channels[j].closeAt && Math.abs(coveredTo[j] - end) < interval) return 1;
      }
      return 0;
    };
    ends.sort(
      (a, b) =>
        collides(a) - collides(b) ||
        Math.abs(a - at - targetDuty) - Math.abs(b - at - targetDuty) ||
        b - a,
    );

    for (const personIndex of candidates.slice(0, width)) {
      const limit = reservedUntil(personIndex);
      for (const end of ends) {
        if (end > limit || !rangeAllowed(personIndex, channelIndex, at, end)) continue;

        const saved = [
          lastEnd[personIndex],
          lastChannel[personIndex],
          worked[personIndex],
          coveredTo[channelIndex],
          dutiesInOwnHalf[personIndex],
        ];
        const countsForHalf =
          (half[personIndex] === 1 && at < SECOND_HALF[0] && end > FIRST_HALF[0]) ||
          (half[personIndex] === 2 && end > SECOND_HALF[0]);

        lastEnd[personIndex] = end;
        lastChannel[personIndex] = channelIndex;
        worked[personIndex] += end - at;
        coveredTo[channelIndex] = end;
        if (countsForHalf) dutiesInOwnHalf[personIndex]++;
        placed.push({ personIndex, channelIndex, start: at, end });

        if (search()) return true;

        placed.pop();
        [
          lastEnd[personIndex],
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
  return placed.map(entry => ({
    id: makeDutyId(),
    personKey: people[entry.personIndex].key,
    channelCode: baseCode(channels[entry.channelIndex].code),
    startMin: entry.start,
    endMin: entry.end,
  }));
}

/** The SMC this night's CLD could fold into, if it needs to. */
function mergeCandidate(state: NightAllocationState): string | null {
  const source = state.channels.find(channel => channel.code === MERGE_SOURCE_CHANNEL);
  if (!source?.inUse) return null;
  // Nothing to gain if CLD is already shut for the whole window.
  if (source.openAt >= MERGE_WINDOW[1] || source.closeAt <= MERGE_WINDOW[0]) return null;
  return mergeTargetFor(state);
}

function withMerge(state: NightAllocationState, targetCode: string): NightAllocationState {
  return {
    ...state,
    channels: state.channels.map(channel =>
      channel.code === MERGE_SOURCE_CHANNEL ? { ...channel, mergedInto: targetCode } : channel,
    ),
  };
}

/** Settings that make a plan impossible before any search is worth starting. */
function preflight(state: NightAllocationState): string | null {
  const channels = openChannels(state);
  if (!activeCount(state)) return "Turn on at least one channel.";
  const tooShort = activeChannelsShorterThanMinimum(state);
  if (tooShort.length) return `${tooShort.join(", ")} must be open for at least 30 min.`;
  if (!channels.length) return "Every channel in use closes before it opens. Check the open and close times.";

  const available = availablePeople(state);
  if (!available.length) return "Nobody is marked available tonight.";

  // Starters are optional. A channel left blank is filled by the solver, which
  // picks from whoever is eligible and rested at its opening minute.
  for (const channel of channels) {
    if (!channel.starterKey) continue;
    const starter = findPerson(state, channel.starterKey);
    if (!starter || !starter.available) {
      return `Everyone you selected must be marked available. Check who starts ${channel.code}.`;
    }
    if (!canTakeChannel(starter, channel.code)) {
      return `${starter.name} isn't marked as able to take TSO, so can't start it. Pick someone with "TSO" turned on.`;
    }
    if (starter.half === "1st" && channel.openAt >= SECOND_HALF[0]) {
      return `${starter.name} is 1st Half, so can't start ${channel.code} at ${formatMinutes(channel.openAt)}.`;
    }
    if (starter.half === "2nd" && channel.openAt >= FIRST_HALF[0] && channel.openAt < SECOND_HALF[0]) {
      return `${starter.name} is 2nd Half, so can't start ${channel.code} at ${formatMinutes(channel.openAt)}.`;
    }
  }

  // One person cannot open two channels whose openings are less than a full
  // duty apart — they would still be on the first one.
  for (let i = 0; i < channels.length; i++) {
    for (let j = i + 1; j < channels.length; j++) {
      const a = channels[i];
      const b = channels[j];
      if (!a.starterKey || a.starterKey !== b.starterKey) continue;
      if (Math.abs(a.openAt - b.openAt) >= MAX_DUTY_MIN) continue;
      return `${findPerson(state, a.starterKey as string)?.name ?? "That person"} can't start both ${a.code} and ${b.code}. Pick a different person for one of them.`;
    }
  }

  const halfPeopleUnavailable = state.people.filter(person => person.half && !person.available);
  if (halfPeopleUnavailable.length) {
    return `Everyone you selected must be marked available. Check ${halfPeopleUnavailable.map(p => p.name).join(", ")}.`;
  }
  return null;
}

function activeCount(state: NightAllocationState): number {
  return state.channels.filter(channel => channel.inUse).length;
}

function activeChannelsShorterThanMinimum(state: NightAllocationState): string[] {
  return state.channels
    .filter(channel => channel.inUse && channel.closeAt - channel.openAt < MIN_DUTY_MIN)
    .map(channel => channel.code);
}

export interface GenerateOptions {
  /** Wall-clock budget in milliseconds for the randomised restarts. */
  budgetMs?: number;
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
 * Run the solver on a night's settings.
 *
 * Returns a complete, gap-free set of duties, or `ok: false` with the staffing
 * notices that explain why one does not exist. It never returns a partial plan,
 * and it never touches the state it was given.
 */
export function generateAllocation(
  state: NightAllocationState,
  { budgetMs, now = () => Date.now(), seed: fixedSeed }: GenerateOptions = {},
): GenerateResult {
  const blocked = preflight(state);
  if (blocked) return { ok: false, error: blocked, reasons: [] };

  const staffing = staffingNotices(state);
  const rhythmNote = dutyLengthNote(state);
  // A night the staffing check already calls impossible gets a shorter budget:
  // the search will almost certainly fail, and the notices are the real answer.
  const budget = budgetMs ?? (staffing.length ? 500 : 1500);
  const startedAt = now();

  // Channels nobody has chosen a starter for are filled by the search. Varying
  // the seed each run means a second press offers a different night rather than
  // repeating the first one.
  const anyStarterChosen = openChannels(state).some(channel => channel.starterKey);
  const baseSeed = fixedSeed ?? (1 + Math.floor(Math.random() * 100_000));

  const starterNote =
    "Continuous plan made, but not every chosen starter could start their channel. See suggestions.";
  const crossoverNote =
    `Continuous plan made, but only by letting a 1st Half person cover ${CROSS_HALF_CHANNEL} in the 2nd Half. ` +
    "See suggestions.";

  /**
   * One sweep of the search, against one relaxation of the rules.
   *
   * `state` here is the variant being tried — the caller decides whether CLD is
   * merged — and `allowCrossHalfTso` is the other last-resort licence.
   */
  const sweep = (state: NightAllocationState, allowCrossHalfTso: boolean): GenerateResult | null => {
    const first = solveContinuous(state, {
      forceStarters: true,
      nodeLimit: 60_000,
      seed: anyStarterChosen ? 0 : baseSeed,
      allowCrossHalfTso,
    });
    if (first) {
      return { ok: true, state: { ...state, duties: first }, note: allowCrossHalfTso ? crossoverNote : rhythmNote };
    }

    const relaxed = solveContinuous(state, {
      forceStarters: false,
      nodeLimit: 60_000,
      seed: anyStarterChosen ? 0 : baseSeed,
      allowCrossHalfTso,
    });
    if (relaxed) {
      return {
        ok: true,
        state: { ...state, duties: relaxed },
        note: allowCrossHalfTso ? crossoverNote : anyStarterChosen ? starterNote : rhythmNote,
      };
    }

    for (let attempt = 1; now() - startedAt < budget; attempt++) {
      const forceStarters = attempt % 2 === 1;
      const restart = solveContinuous(state, {
        forceStarters,
        nodeLimit: 25_000,
        width: 8,
        seed: baseSeed + attempt,
        allowCrossHalfTso,
      });
      if (!restart) continue;
      return {
        ok: true,
        state: { ...state, duties: restart },
        note: allowCrossHalfTso ? crossoverNote : forceStarters || !anyStarterChosen ? rhythmNote : starterNote,
      };
    }
    return null;
  };

  // Relaxations are tried in order of how much they change the night, and only
  // when the plainer version found nothing. A merge the user has already ticked
  // is not a relaxation — it is the night as configured — so it is not retried.
  const alreadyMerged = !!activeMerge(state);
  const mergeTarget = alreadyMerged ? null : mergeCandidate(state);
  const merged = mergeTarget ? withMerge(state, mergeTarget) : null;

  const attempts: Array<{ state: NightAllocationState; crossover: boolean; mergedInto: string | null }> = [
    { state, crossover: false, mergedInto: null },
    { state, crossover: true, mergedInto: null },
  ];
  if (merged && mergeTarget) {
    attempts.push({ state: merged, crossover: false, mergedInto: mergeTarget });
    attempts.push({ state: merged, crossover: true, mergedInto: mergeTarget });
  }

  for (const attempt of attempts) {
    const planned = sweep(attempt.state, attempt.crossover);
    if (!planned || !planned.ok) continue;
    if (!attempt.mergedInto) return planned;
    return {
      ...planned,
      mergedInto: attempt.mergedInto,
      note:
        `Continuous plan made, but only by merging ${MERGE_SOURCE_CHANNEL} into ${attempt.mergedInto} ` +
        `19:00–21:30. See suggestions.`,
    };
  }

  return {
    ok: false,
    error: "No allocation made. There is no way to keep every channel continuous with these settings.",
    reasons: staffing.length
      ? staffing
      : ["Try a different starting person for a channel, change a channel's open time, or move someone out of a half."],
  };
}
