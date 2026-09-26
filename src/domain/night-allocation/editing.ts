/**
 * Night Channel Allocation — editing, where gaps would otherwise creep in.
 *
 * Handover times are linked. Moving a duty's start moves the previous duty's
 * end on that channel to the same minute; moving its end moves the next duty's
 * start. The whole chain is rewritten as one operation, and the operation is
 * checked **before** it is applied: a change that would open a gap, break the
 * 30 min–2 h bounds, eat into someone's break or break a half, TSO or
 * availability rule is refused and the caller's state is left exactly as it was.
 * A problem a touched duty already had before the change does not refuse it —
 * it is reported as unresolved instead.
 *
 * Manual edits go further than the handover chain allows. A duty, or part of
 * one, can be **left blank**: the person comes off it and the stretch stays on
 * the position with nobody on it, rather than being handed to a neighbour. A
 * blank can be **filled** again, whole or in part. A duty can be **moved to
 * another position** — the stretch it leaves is left blank, and whatever was
 * on the new position then is cut back to make room — and two people can
 * **swap** duties. None of these ever opens a gap: a blank is not one.
 *
 * DB slots are fixed. A handover that would drag one along is refused rather
 * than applied, a delete beside one hands the time to the other neighbour, and
 * a slot is never split, blanked, moved over or swapped. Slots themselves are
 * placed and moved in db-slots.ts.
 *
 * Every function here is pure. The dialog uses them to preview an edit, and the
 * API uses the same rules module to re-check whatever the client finally sends.
 */
import { BLANK_PERSON_KEY, EVENING_REST_MIN, EVENING_REST_WINDOW, MIN_DUTY_MIN, NIGHT_SPAN_MIN } from "./constants.js";
import { makeDutyId } from "./ids.js";
import {
  describeEveningBreak,
  eveningRestShortfalls,
  findChannel,
  gapsForChannel,
  inBoardOrder,
  isBlank,
  isFixedDuty,
  isPlanned,
  mergedAwayWindow,
  openChannels,
  overlaps,
  personName,
  uncoveredMinutes,
  validateAllocation,
} from "./rules.js";
import { formatDuration, formatMinutes, formatRange } from "./time.js";
import type { NightAllocationState, NightChannel, NightDuty } from "./types.js";

/** A change that was applied, or the reasons it was refused. */
export type EditResult =
  | { ok: true; state: NightAllocationState; note?: string }
  | { ok: false; problems: string[] };

/**
 * Narrow a refusal.
 *
 * The app compiles with `strictNullChecks` off, which stops TypeScript
 * narrowing a `{ ok: true } | { ok: false }` union by its discriminant. Callers
 * use this instead of `if (!result.ok)` so the refusal reasons stay typed.
 */
export function isRefusedEdit(result: EditResult): result is Extract<EditResult, { ok: false }> {
  return !result.ok;
}

/** The duties immediately before and after one duty on its own channel. */
export function neighboursOf(duties: NightDuty[], duty: NightDuty) {
  return {
    previous: duties.find(
      other => other.channelCode === duty.channelCode && other.id !== duty.id && other.endMin === duty.startMin,
    ),
    next: duties.find(
      other => other.channelCode === duty.channelCode && other.id !== duty.id && other.startMin === duty.endMin,
    ),
  };
}

function withDuties(state: NightAllocationState, duties: NightDuty[]): NightAllocationState {
  return { ...state, duties };
}

/** A blank on `channelCode` over `[startMin, endMin)`: the stretch stays, nobody is on it. */
export function makeBlank(channelCode: string, startMin: number, endMin: number, id = makeDutyId("b")): NightDuty {
  return { id, channelCode, personKey: BLANK_PERSON_KEY, startMin, endMin, kind: "blank" };
}

/**
 * Blanks side by side on one position become one, and a blank squeezed down
 * to nothing goes — so leaving two neighbouring duties blank reads as one
 * stretch, and filling the whole of a blank leaves no trace of it. Everything
 * else keeps its place in the list.
 */
function tidyBlanks(duties: NightDuty[]): NightDuty[] {
  const blanks = duties
    .filter(entry => isBlank(entry) && entry.endMin > entry.startMin)
    .sort((a, b) => a.channelCode.localeCompare(b.channelCode) || a.startMin - b.startMin);
  const survivors = new Map<string, NightDuty>();
  let current: NightDuty | null = null;
  for (const blank of blanks) {
    if (current && current.channelCode === blank.channelCode && blank.startMin <= current.endMin) {
      current.endMin = Math.max(current.endMin, blank.endMin);
      continue;
    }
    current = { ...blank };
    survivors.set(blank.id, current);
  }
  const out: NightDuty[] = [];
  for (const entry of duties) {
    if (!isBlank(entry)) out.push(entry);
    else if (survivors.has(entry.id)) out.push(survivors.get(entry.id) as NightDuty);
  }
  return out;
}

/**
 * Make room for `span` on its position: whatever `gives` accepts there is cut
 * back to either side of it, and whoever held it keeps what is left. Returns
 * the new list — without `span` — and the ids of the pieces left over.
 */
function cutBack(
  duties: NightDuty[],
  span: NightDuty,
  gives: (entry: NightDuty) => boolean,
): { duties: NightDuty[]; pieceIds: string[] } {
  const out: NightDuty[] = [];
  const pieceIds: string[] = [];
  for (const entry of duties) {
    if (entry.id === span.id) continue;
    const inTheWay =
      entry.channelCode === span.channelCode &&
      gives(entry) &&
      entry.startMin < span.endMin &&
      entry.endMin > span.startMin;
    if (!inTheWay) {
      out.push({ ...entry });
      continue;
    }
    const before = entry.startMin < span.startMin ? { ...entry, endMin: span.startMin } : null;
    const after =
      entry.endMin > span.endMin
        ? { ...entry, id: before ? makeDutyId(isBlank(entry) ? "b" : "d") : entry.id, startMin: span.endMin }
        : null;
    for (const piece of [before, after]) {
      if (!piece) continue;
      out.push(piece);
      pieceIds.push(piece.id);
    }
  }
  return { duties: out, pieceIds };
}

/** True when a draft takes an existing duty to another position. */
export function isMove(original: NightDuty | null, draft: NightDuty): boolean {
  return !!original && original.channelCode !== draft.channelCode;
}

/**
 * Apply a draft to the duty list, dragging the linked handovers with it.
 * Returns the candidate list and the ids the dialog should report problems for.
 *
 * A new duty fills whatever blank it lands on. A duty moved to another
 * position leaves its old stretch blank and takes its new one outright:
 * duties and blanks there are cut back to make room. Handovers are only
 * linked within one position — on a move there is nothing to link.
 */
export function buildEditedDuties(
  state: NightAllocationState,
  original: NightDuty | null,
  draft: NightDuty,
): { duties: NightDuty[]; focusIds: string[] } {
  if (!original) {
    const { duties } = cutBack(state.duties, draft, isBlank);
    duties.push({ ...draft });
    return { duties: tidyBlanks(duties), focusIds: [draft.id] };
  }

  if (isMove(original, draft)) {
    const { duties, pieceIds } = cutBack(
      state.duties.filter(duty => duty.id !== original.id),
      draft,
      entry => !isFixedDuty(entry),
    );
    duties.push(makeBlank(original.channelCode, original.startMin, original.endMin));
    duties.push({ ...draft });
    return { duties: tidyBlanks(duties), focusIds: [draft.id, ...pieceIds] };
  }

  const duties = state.duties.map(duty => ({ ...duty }));
  const focusIds = [draft.id];
  const index = duties.findIndex(duty => duty.id === original.id);
  const { previous, next } = neighboursOf(duties, original);
  if (index >= 0) duties[index] = { ...draft };

  // A neighbour is only part of the change when its handover actually moves.
  // Otherwise a problem it already had would block every edit beside it. A
  // blank neighbour simply grows or shrinks, and goes when nothing is left.
  if (previous && draft.startMin !== original.startMin) {
    previous.endMin = draft.startMin;
    focusIds.push(previous.id);
  }
  if (next && draft.endMin !== original.endMin) {
    next.startMin = draft.endMin;
    focusIds.push(next.id);
  }
  return { duties: tidyBlanks(duties), focusIds };
}

/** Everyone who gains, loses or has a duty changed between two duty lists. */
function touchedPeople(before: NightDuty[], after: NightDuty[]): Set<string> {
  const previous = new Map(before.map(duty => [duty.id, duty]));
  const people = new Set<string>();
  const kept = new Set<string>();
  const add = (duty: NightDuty) => {
    if (!isBlank(duty)) people.add(duty.personKey);
  };
  for (const duty of after) {
    kept.add(duty.id);
    const old = previous.get(duty.id);
    if (
      old &&
      old.personKey === duty.personKey &&
      old.channelCode === duty.channelCode &&
      old.startMin === duty.startMin &&
      old.endMin === duty.endMin &&
      isBlank(old) === isBlank(duty)
    ) {
      continue;
    }
    add(duty);
    if (old) add(old);
  }
  for (const duty of before) if (!kept.has(duty.id)) add(duty);
  return people;
}

/** What a candidate change would do to the rules, for the duties it touches. */
export interface ChangeReview {
  /** What the change would break. Any one of these refuses it. */
  problems: string[];
  /**
   * Problems the touched duties already had, which the change leaves exactly as
   * they were. Shown, but not a reason to refuse: otherwise two broken duties
   * side by side could each only be fixed after the other.
   */
  unresolved: string[];
  /**
   * Preferences the change would stop being met for the people it touches —
   * the evening rest, so far. Shown beside the change, never a reason to
   * refuse it.
   */
  preferences: string[];
}

/**
 * Review a candidate duty list, phrased for the person making the change:
 * problems it would introduce on the duties they touched, plus any new
 * uncovered stretch.
 */
export function reviewChange(
  state: NightAllocationState,
  candidateDuties: NightDuty[],
  focusIds: string[],
): ChangeReview {
  const candidate = withDuties(state, candidateDuties);
  const before = validateAllocation(state);
  const after = validateAllocation(candidate);
  const alreadyKnown = new Set(before.errors.map(issue => issue.message));

  const people = touchedPeople(state.duties, candidateDuties);
  const touched = after.errors.filter(
    issue =>
      issue.dutyIds.some(id => focusIds.includes(id)) ||
      // Problems about a person, such as a half left with no duty in it, count
      // once the night has a plan at all. On an empty board — or one holding
      // only DB slots — the first duty added is not what left everyone else's
      // half bare.
      (isPlanned(state) && !!issue.personKeys?.some(key => people.has(key))),
  );
  const problems = touched.filter(issue => !alreadyKnown.has(issue.message)).map(issue => issue.message);
  const unresolved = touched.filter(issue => alreadyKnown.has(issue.message)).map(issue => issue.message);

  if (uncoveredMinutes(candidate) > uncoveredMinutes(state)) {
    const newGaps = after.errors
      .filter(issue => issue.isGap && !alreadyKnown.has(issue.message))
      .map(issue => issue.message);
    if (newGaps.length) problems.push(...newGaps);
    else problems.push(...newlyUncovered(state, candidate));
  }

  return {
    problems: [...new Set<string>(problems)],
    unresolved: [...new Set<string>(unresolved)],
    preferences: eveningRestLost(state, candidate, people),
  };
}

/** The touched people a change would leave without their evening rest. */
function eveningRestLost(
  before: NightAllocationState,
  after: NightAllocationState,
  people: Set<string>,
): string[] {
  const had = new Set(eveningRestShortfalls(before).map(shortfall => shortfall.person.key));
  return eveningRestShortfalls(after)
    .filter(shortfall => people.has(shortfall.person.key) && !had.has(shortfall.person.key))
    .map(
      ({ person, longest }) =>
        `${person.name} would have no ${formatDuration(EVENING_REST_MIN)} break starting between ` +
        `${formatMinutes(EVENING_REST_WINDOW[0])} and ${formatMinutes(EVENING_REST_WINDOW[1])} ` +
        `(${describeEveningBreak(longest)}). Preferred, not required.`,
    );
}

/**
 * The stretches a change would leave uncovered, named, for when the checks
 * can't name them themselves — a board left holding only DB slots counts as
 * unplanned, and an unplanned board reports no gaps.
 */
function newlyUncovered(before: NightAllocationState, after: NightAllocationState): string[] {
  const out: string[] = [];
  for (const channel of openChannels(after)) {
    const was = gapsForChannel(before.duties, channel, mergedAwayWindow(before, channel.code));
    const fresh = gapsForChannel(after.duties, channel, mergedAwayWindow(after, channel.code)).filter(
      ([start, end]) => !was.some(([from, to]) => from <= start && to >= end),
    );
    if (!fresh.length) continue;
    out.push(
      `${channel.code} would have no one on duty ${fresh.map(([start, end]) => formatRange(start, end)).join(", ")}. ` +
        `Someone must take over at the handover time.`,
    );
  }
  return out.length ? out : ["This would leave a channel without cover. Someone must take over at the handover time."];
}

/** Just the reasons a change would be refused. */
export function problemsForChange(
  state: NightAllocationState,
  candidateDuties: NightDuty[],
  focusIds: string[],
): string[] {
  return reviewChange(state, candidateDuties, focusIds).problems;
}

/**
 * DB slots a candidate would move as a side effect — a linked handover
 * dragging the slot next to the edited duty. The duty being edited is not a
 * side effect of itself, so it is left out.
 */
function draggedSlots(before: NightDuty[], after: NightDuty[], editedId: string): string[] {
  const moved = new Map(after.map(duty => [duty.id, duty]));
  const problems: string[] = [];
  for (const slot of before) {
    if (!isFixedDuty(slot) || slot.id === editedId) continue;
    const now = moved.get(slot.id);
    if (!now || (now.startMin === slot.startMin && now.endMin === slot.endMin)) continue;
    const boundary = now.startMin !== slot.startMin ? slot.startMin : slot.endMin;
    problems.push(
      `${slot.channelCode} has a DB slot ${formatRange(slot.startMin, slot.endMin)}, and DB slots don't move. ` +
        `Keep the handover at ${formatMinutes(boundary)}, or change the DB slot itself.`,
    );
  }
  return problems;
}

/** DB slots a new or moved duty would land on. Nothing makes room by cutting one. */
function slotsInTheWay(duties: NightDuty[], draft: NightDuty): string[] {
  return duties
    .filter(
      entry =>
        isFixedDuty(entry) &&
        entry.id !== draft.id &&
        entry.channelCode === draft.channelCode &&
        overlaps(entry, draft.startMin, draft.endMin),
    )
    .map(
      slot =>
        `${slot.channelCode} has a DB slot ${formatRange(slot.startMin, slot.endMin)}, and DB slots don't move. ` +
        `Pick a time outside it, or change the DB slot itself.`,
    );
}

/** Preview a change without committing it — what the edit dialog renders. */
export function previewDutyChange(
  state: NightAllocationState,
  original: NightDuty | null,
  draft: NightDuty,
): { duties: NightDuty[] } & ChangeReview {
  const { duties, focusIds } = buildEditedDuties(state, original, draft);
  const review = reviewChange(state, duties, focusIds);
  const blocked =
    !original || isMove(original, draft)
      ? slotsInTheWay(state.duties, draft)
      : draggedSlots(state.duties, duties, original.id);
  return { duties, ...review, problems: [...new Set([...blocked, ...review.problems])] };
}

/**
 * What moving a duty to another position does to the rest of the board, in
 * words, for the dialog: the stretch left blank behind it, and who on the new
 * position is cut back or taken off.
 */
export function describeMove(state: NightAllocationState, original: NightDuty, draft: NightDuty): string[] {
  if (!isMove(original, draft)) return [];
  const lines = [
    `${original.channelCode} ${formatRange(original.startMin, original.endMin)} is left blank — tap it afterwards ` +
      `to put someone on.`,
  ];
  for (const entry of state.duties) {
    if (entry.id === original.id || entry.channelCode !== draft.channelCode || isFixedDuty(entry)) continue;
    if (!overlaps(entry, draft.startMin, draft.endMin)) continue;
    const lost = formatRange(Math.max(entry.startMin, draft.startMin), Math.min(entry.endMin, draft.endMin));
    if (isBlank(entry)) {
      lines.push(`It fills the blank on ${draft.channelCode} ${lost}.`);
      continue;
    }
    const name = personName(state, entry.personKey);
    lines.push(
      entry.startMin >= draft.startMin && entry.endMin <= draft.endMin
        ? `${name} comes off ${draft.channelCode} ${lost}.`
        : `${name} comes off ${draft.channelCode} ${lost} and keeps the rest of that duty.`,
    );
  }
  return lines;
}

/** Add a duty, or change an existing one, handovers and all. */
export function applyDutyChange(
  state: NightAllocationState,
  draft: NightDuty,
  originalId: string | null,
): EditResult {
  const original = originalId ? state.duties.find(duty => duty.id === originalId) ?? null : null;
  if (original && isBlank(original)) {
    return { ok: false, problems: ["That stretch is blank. Fill the blank to put someone on it."] };
  }
  const { duties, problems } = previewDutyChange(state, original, draft);
  if (problems.length) return { ok: false, problems };
  const note = original && isMove(original, draft)
    ? `${personName(state, draft.personKey)} moved to ${draft.channelCode} ${formatRange(draft.startMin, draft.endMin)}. ` +
      `${original.channelCode} ${formatRange(original.startMin, original.endMin)} is blank now — tap it to put someone on.`
    : undefined;
  return { ok: true, state: withDuties(state, duties), note };
}

/**
 * The duty that takes over a deleted duty's time: the one before it on the
 * position, or the one after when there is none. A DB slot never grows, and a
 * blank taking the time over would only be leaving it blank, so neither does.
 */
export function absorbingNeighbour(duties: NightDuty[], duty: NightDuty): NightDuty | undefined {
  const { previous, next } = neighboursOf(duties, duty);
  const takes = (entry?: NightDuty) => (entry && !isFixedDuty(entry) && !isBlank(entry) ? entry : undefined);
  return takes(previous) ?? takes(next);
}

/**
 * Delete a duty — or a blank — handing the freed time to the duty before it on
 * that channel, or to the next one when there is nobody before it. Refused
 * when that would break a rule, so a channel cannot be emptied by accident;
 * leaving the time blank is `leaveBlank`'s job.
 */
export function deleteDuty(state: NightAllocationState, dutyId: string): EditResult {
  const original = state.duties.find(duty => duty.id === dutyId);
  if (!original) return { ok: false, problems: ["That duty is no longer on the board."] };
  if (isFixedDuty(original)) {
    return { ok: false, problems: ["A DB slot is removed in its own dialog, not deleted here."] };
  }

  const duties = state.duties.filter(duty => duty.id !== dutyId).map(duty => ({ ...duty }));
  const takenOverBy = absorbingNeighbour(duties, original);
  const focusIds: string[] = [];
  if (takenOverBy) {
    if (takenOverBy.endMin === original.startMin) takenOverBy.endMin = original.endMin;
    else takenOverBy.startMin = original.startMin;
    focusIds.push(takenOverBy.id);
  }

  const problems = problemsForChange(state, duties, focusIds);
  if (problems.length) {
    const range = formatRange(original.startMin, original.endMin);
    return {
      ok: false,
      problems: takenOverBy
        ? problems.map(problem => `Can't delete: ${problem}`)
        : isBlank(original)
          ? [`Can't remove the blank: nobody next to it on ${original.channelCode} can take ${range} over.`]
          : [
              `Can't delete: nobody next to it on ${original.channelCode} can take ${range} over. ` +
                `Leave it blank instead.`,
            ],
    };
  }

  const what = isBlank(original) ? "Blank removed." : "Duty deleted.";
  const note = takenOverBy
    ? `${what} ${personName(state, takenOverBy.personKey)} now covers that time on ${original.channelCode}.`
    : what;
  return { ok: true, state: withDuties(state, duties), note };
}

/**
 * Take the person off a duty, or off part of it, and leave that stretch blank:
 * it stays on the position with nobody on it, until someone fills it. Nothing
 * is handed to a neighbour. Whatever is left of the duty either side stays
 * with them, and has to be a duty in its own right — 30 minutes at least.
 */
export function leaveBlank(
  state: NightAllocationState,
  dutyId: string,
  fromMin?: number,
  toMin?: number,
): EditResult {
  const original = state.duties.find(duty => duty.id === dutyId);
  if (!original) return { ok: false, problems: ["That duty is no longer on the board."] };
  if (isBlank(original)) return { ok: false, problems: ["That stretch is already blank."] };
  if (isFixedDuty(original)) {
    return { ok: false, problems: ["A DB slot can't be left blank. Remove the slot in its own dialog instead."] };
  }
  const from = fromMin ?? original.startMin;
  const to = toMin ?? original.endMin;
  if (!(from >= original.startMin && to <= original.endMin && from < to)) {
    return {
      ok: false,
      problems: [`The blank has to fall inside the duty, ${formatRange(original.startMin, original.endMin)}.`],
    };
  }

  const duties: NightDuty[] = [];
  const kept: string[] = [];
  for (const entry of state.duties) {
    if (entry.id !== dutyId) {
      duties.push({ ...entry });
      continue;
    }
    if (from > entry.startMin) {
      duties.push({ ...entry, endMin: from });
      kept.push(entry.id);
    }
    duties.push(makeBlank(entry.channelCode, from, to));
    if (to < entry.endMin) {
      const id = from > entry.startMin ? makeDutyId() : entry.id;
      duties.push({ ...entry, id, startMin: to });
      kept.push(id);
    }
  }
  const tidied = tidyBlanks(duties);

  const problems = problemsForChange(state, tidied, kept);
  if (problems.length) return { ok: false, problems: problems.map(problem => `Can't leave it blank: ${problem}`) };

  const name = personName(state, original.personKey);
  const whole = from === original.startMin && to === original.endMin;
  return {
    ok: true,
    state: withDuties(state, tidied),
    note:
      `${original.channelCode} ${formatRange(from, to)} left blank — ${name} is off it` +
      `${whole ? "" : " and keeps the rest of that duty"}. Tap the blank to put someone on.`,
  };
}

/** The duty list with part or all of a blank handed to someone. */
function buildFilledDuties(
  state: NightAllocationState,
  blank: NightDuty,
  personKey: string,
  from: number,
  to: number,
): { duties: NightDuty[]; dutyId: string } {
  const duty: NightDuty = {
    id: makeDutyId(),
    channelCode: blank.channelCode,
    personKey,
    startMin: from,
    endMin: to,
  };
  const { duties } = cutBack(state.duties, duty, entry => entry.id === blank.id);
  duties.push(duty);
  return { duties: tidyBlanks(duties), dutyId: duty.id };
}

/** Why a fill can't even be tried, or null. */
function fillRefusal(
  blank: NightDuty | undefined,
  personKey: string,
  from: number,
  to: number,
): string | null {
  if (!blank) return "That blank is no longer on the board.";
  if (!personKey) return "Select a person.";
  if (!(from >= blank.startMin && to <= blank.endMin && from < to)) {
    return `Pick a time inside the blank, ${formatRange(blank.startMin, blank.endMin)}.`;
  }
  return null;
}

/**
 * What putting someone on a blank would do, before it is done — what the
 * blank's dialog shows as it is filled in. Any part of the blank not covered
 * stays blank.
 */
export function previewFillBlank(
  state: NightAllocationState,
  blankId: string,
  personKey: string,
  fromMin: number,
  toMin: number,
): { duties: NightDuty[] } & ChangeReview {
  const blank = state.duties.find(duty => duty.id === blankId && isBlank(duty));
  const refusal = fillRefusal(blank, personKey, fromMin, toMin);
  if (refusal || !blank) return { duties: state.duties, problems: [refusal as string], unresolved: [], preferences: [] };
  const { duties, dutyId } = buildFilledDuties(state, blank, personKey, fromMin, toMin);
  return { duties, ...reviewChange(state, duties, [dutyId]) };
}

/** Put someone on a blank, or on part of it — the rest stays blank. */
export function fillBlank(
  state: NightAllocationState,
  blankId: string,
  personKey: string,
  fromMin?: number,
  toMin?: number,
): EditResult {
  const blank = state.duties.find(duty => duty.id === blankId && isBlank(duty));
  const from = fromMin ?? blank?.startMin ?? 0;
  const to = toMin ?? blank?.endMin ?? 0;
  const { duties, problems } = previewFillBlank(state, blankId, personKey, from, to);
  if (problems.length || !blank) return { ok: false, problems };
  const rest = from > blank.startMin || to < blank.endMin;
  return {
    ok: true,
    state: withDuties(state, duties),
    note:
      `${personName(state, personKey)} on ${blank.channelCode} ${formatRange(from, to)}.` +
      (rest ? " The rest stays blank." : ""),
  };
}

/**
 * Duties a duty could swap with: whatever is on the other positions while it
 * runs, blanks included — swapping with a blank moves this person there and
 * leaves their own stretch blank. In board order.
 */
export function swapCandidates(state: NightAllocationState, duty: NightDuty): NightDuty[] {
  const order = inBoardOrder(state.channels).map(channel => channel.code);
  const rank = (code: string) => (order.includes(code) ? order.indexOf(code) : order.length);
  return state.duties
    .filter(
      entry =>
        entry.id !== duty.id &&
        entry.channelCode !== duty.channelCode &&
        !isFixedDuty(entry) &&
        overlaps(entry, duty.startMin, duty.endMin),
    )
    .sort((a, b) => rank(a.channelCode) - rank(b.channelCode) || a.startMin - b.startMin);
}

/** The duty list with the people on two duties exchanged; a blank's nobody moves like anyone. */
function buildSwappedDuties(state: NightAllocationState, first: NightDuty, second: NightDuty): NightDuty[] {
  const holderFrom = (place: NightDuty, from: NightDuty): NightDuty =>
    isBlank(from)
      ? makeBlank(place.channelCode, place.startMin, place.endMin, place.id)
      : {
          id: place.id,
          channelCode: place.channelCode,
          personKey: from.personKey,
          startMin: place.startMin,
          endMin: place.endMin,
        };
  return tidyBlanks(
    state.duties.map(entry =>
      entry.id === first.id ? holderFrom(first, second) : entry.id === second.id ? holderFrom(second, first) : { ...entry },
    ),
  );
}

/**
 * Swap the people on two duties — TWR's holder onto SMC and SMC's onto TWR,
 * say. Each keeps the other's times and position. Swapping with a blank moves
 * the person onto the blank and leaves their own stretch blank.
 */
export function swapPeople(state: NightAllocationState, firstId: string, secondId: string): EditResult {
  const first = state.duties.find(duty => duty.id === firstId);
  const second = state.duties.find(duty => duty.id === secondId);
  if (!first || !second || first.id === second.id) {
    return { ok: false, problems: ["That duty is no longer on the board."] };
  }
  if (isFixedDuty(first) || isFixedDuty(second)) {
    return { ok: false, problems: ["DB slots don't swap. Change the DB slot itself."] };
  }
  if (isBlank(first) && isBlank(second)) {
    return { ok: false, problems: ["Both are blank, so there is nobody to swap."] };
  }

  const duties = buildSwappedDuties(state, first, second);
  const problems = problemsForChange(state, duties, [first.id, second.id]);
  if (problems.length) return { ok: false, problems: problems.map(problem => `Can't swap: ${problem}`) };

  const where = (duty: NightDuty) => `${duty.channelCode} ${formatRange(duty.startMin, duty.endMin)}`;
  const blank = isBlank(first) ? first : isBlank(second) ? second : null;
  const held = blank === first ? second : first;
  return {
    ok: true,
    state: withDuties(state, duties),
    note: blank
      ? `${personName(state, held.personKey)} moved to ${where(blank)}. ${where(held)} is blank now.`
      : `Swapped. ${personName(state, first.personKey)} is on ${where(second)}, and ` +
        `${personName(state, second.personKey)} on ${where(first)}.`,
  };
}

/**
 * Hand over part of a duty: it ends at `atMin` and someone else takes the
 * remainder, with no gap between the two.
 */
export function splitDuty(
  state: NightAllocationState,
  dutyId: string,
  atMin: number,
  personKey: string,
): EditResult {
  const original = state.duties.find(duty => duty.id === dutyId);
  if (!original) return { ok: false, problems: ["That duty is no longer on the board."] };
  if (isFixedDuty(original)) {
    return {
      ok: false,
      problems: ["A DB slot can't be split — its instructor holds all of it. Change the slot itself instead."],
    };
  }
  if (isBlank(original)) {
    return { ok: false, problems: ["Nobody is on a blank to hand it over. Fill the blank instead."] };
  }
  if (!personKey) return { ok: false, problems: ["Select who takes over."] };
  if (atMin <= original.startMin || atMin >= original.endMin) {
    return { ok: false, problems: ["The handover time must fall inside the duty."] };
  }

  const duties = state.duties.map(duty => ({ ...duty }));
  const first = duties.find(duty => duty.id === dutyId) as NightDuty;
  first.endMin = atMin;
  const remainder: NightDuty = {
    id: makeDutyId(),
    channelCode: original.channelCode,
    personKey,
    startMin: atMin,
    endMin: original.endMin,
  };
  duties.push(remainder);

  const problems = problemsForChange(state, duties, [first.id, remainder.id]);
  if (problems.length) return { ok: false, problems: problems.map(problem => `Can't split: ${problem}`) };

  return {
    ok: true,
    state: withDuties(state, duties),
    note: `Split. ${personName(state, personKey)} takes over at ${formatMinutes(atMin)}.`,
  };
}

/**
 * Re-fit a channel's duties to a new open window: the first duty starts when it
 * opens, the last ends when it closes, and duties entirely outside the window
 * are dropped.
 *
 * Unlike the duty edits this one always applies — the user changed the channel's
 * hours deliberately — but it reports what it had to do, and the checks panel
 * picks up anything the refit could not make legal (a duty left over two hours,
 * for instance).
 *
 * A DB slot is never stretched to meet the new hours; it is only cut where the
 * hours cut into it, or dropped when it falls outside them altogether. Neither
 * is a blank — nobody decided to leave the new hours empty. Any stretch that
 * leaves uncovered is for the next generate to fill.
 */
export function refitChannel(
  state: NightAllocationState,
  channelCode: string,
  openAt: number,
  closeAt: number,
): { state: NightAllocationState; note: string } {
  const channels = state.channels.map(channel =>
    channel.code === channelCode ? { ...channel, openAt, closeAt } : channel,
  );
  const channel = channels.find(entry => entry.code === channelCode) as NightChannel;

  const mine = state.duties.filter(duty => duty.channelCode === channelCode);
  const others = state.duties.filter(duty => duty.channelCode !== channelCode);
  const window = `${channel.code} open ${formatMinutes(openAt)}–${formatMinutes(closeAt)}.`;
  if (!mine.length) return { state: { ...state, channels }, note: window };

  const inside = (duty: NightDuty) => duty.endMin > openAt && duty.startMin < closeAt;
  const kept = mine
    .filter(inside)
    .sort((a, b) => a.startMin - b.startMin)
    .map(duty => ({
      ...duty,
      startMin: Math.max(duty.startMin, openAt),
      endMin: Math.min(duty.endMin, closeAt),
    }));
  const removed = mine.length - kept.length;
  const slotsRemoved = mine.filter(duty => isFixedDuty(duty) && !inside(duty)).length;
  const slotsCut = mine.filter(
    duty => isFixedDuty(duty) && inside(duty) && (duty.startMin < openAt || duty.endMin > closeAt),
  ).length;

  const stretches = (duty: NightDuty) => !isFixedDuty(duty) && !isBlank(duty);
  if (kept.length) {
    if (stretches(kept[0])) kept[0].startMin = openAt;
    if (stretches(kept[kept.length - 1])) kept[kept.length - 1].endMin = closeAt;
  }

  const note =
    `${window} First and last duties adjusted to match` +
    (removed ? `, ${removed} outside that time removed.` : ".") +
    (slotsRemoved ? ` ${slotsRemoved === 1 ? "A DB slot was" : `${slotsRemoved} DB slots were`} among them.` : "") +
    (slotsCut ? ` ${slotsCut === 1 ? "A DB slot was" : `${slotsCut} DB slots were`} cut to the new hours.` : "");
  return { state: { ...state, channels, duties: [...others, ...kept] }, note };
}

/**
 * Keep a channel's window legal while one end is being dragged: a window under
 * 30 minutes is widened rather than rejected, which is what the selects need.
 */
export function coerceChannelWindow(openAt: number, closeAt: number, moved: "open" | "close") {
  let open = Math.max(0, Math.min(NIGHT_SPAN_MIN - MIN_DUTY_MIN, openAt));
  let close = Math.max(MIN_DUTY_MIN, Math.min(NIGHT_SPAN_MIN, closeAt));
  if (close - open < MIN_DUTY_MIN) {
    if (moved === "open") close = Math.min(NIGHT_SPAN_MIN, open + 60);
    else open = Math.max(0, close - 60);
  }
  return { openAt: open, closeAt: close };
}

/** Does a channel currently have a duty starting exactly at its opening minute? */
export function hasOpeningDuty(state: NightAllocationState, channelCode: string): boolean {
  const channel = findChannel(state, channelCode);
  if (!channel) return false;
  return state.duties.some(duty => duty.channelCode === channelCode && duty.startMin === channel.openAt);
}
