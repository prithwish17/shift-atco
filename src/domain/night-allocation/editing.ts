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
 * DB slots are fixed. A handover that would drag one along is refused rather
 * than applied, a delete beside one hands the time to the other neighbour, and
 * a slot is never split. Slots themselves are placed and moved in db-slots.ts.
 *
 * Every function here is pure. The dialog uses them to preview an edit, and the
 * API uses the same rules module to re-check whatever the client finally sends.
 */
import { MIN_DUTY_MIN, NIGHT_SPAN_MIN } from "./constants.js";
import { makeDutyId } from "./ids.js";
import {
  findChannel,
  gapsForChannel,
  isFixedDuty,
  isPlanned,
  mergedAwayWindow,
  openChannels,
  personName,
  uncoveredMinutes,
  validateAllocation,
} from "./rules.js";
import { formatMinutes, formatRange } from "./time.js";
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

/**
 * Apply a draft to the duty list, dragging the linked handovers with it.
 * Returns the candidate list and the ids the dialog should report problems for.
 */
export function buildEditedDuties(
  state: NightAllocationState,
  original: NightDuty | null,
  draft: NightDuty,
): { duties: NightDuty[]; focusIds: string[] } {
  const duties = state.duties.map(duty => ({ ...duty }));
  const focusIds = [draft.id];

  if (!original) {
    duties.push({ ...draft });
    return { duties, focusIds };
  }

  const index = duties.findIndex(duty => duty.id === original.id);
  const { previous, next } = neighboursOf(duties, original);
  if (index >= 0) duties[index] = { ...draft };

  // A neighbour is only part of the change when its handover actually moves.
  // Otherwise a problem it already had would block every edit beside it.
  if (previous && draft.startMin !== original.startMin) {
    previous.endMin = draft.startMin;
    focusIds.push(previous.id);
  }
  if (next && draft.endMin !== original.endMin) {
    next.startMin = draft.endMin;
    focusIds.push(next.id);
  }
  return { duties, focusIds };
}

/** Everyone who gains, loses or has a duty changed between two duty lists. */
function touchedPeople(before: NightDuty[], after: NightDuty[]): Set<string> {
  const previous = new Map(before.map(duty => [duty.id, duty]));
  const people = new Set<string>();
  const kept = new Set<string>();
  for (const duty of after) {
    kept.add(duty.id);
    const old = previous.get(duty.id);
    if (
      old &&
      old.personKey === duty.personKey &&
      old.channelCode === duty.channelCode &&
      old.startMin === duty.startMin &&
      old.endMin === duty.endMin
    ) {
      continue;
    }
    people.add(duty.personKey);
    if (old) people.add(old.personKey);
  }
  for (const duty of before) if (!kept.has(duty.id)) people.add(duty.personKey);
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

  return { problems: [...new Set<string>(problems)], unresolved: [...new Set<string>(unresolved)] };
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

/** Preview a change without committing it — what the edit dialog renders. */
export function previewDutyChange(
  state: NightAllocationState,
  original: NightDuty | null,
  draft: NightDuty,
): { duties: NightDuty[] } & ChangeReview {
  const { duties, focusIds } = buildEditedDuties(state, original, draft);
  const review = reviewChange(state, duties, focusIds);
  const dragged = draggedSlots(state.duties, duties, original?.id ?? draft.id);
  return { duties, ...review, problems: [...dragged, ...review.problems] };
}

/** Add a duty, or change an existing one, handovers and all. */
export function applyDutyChange(
  state: NightAllocationState,
  draft: NightDuty,
  originalId: string | null,
): EditResult {
  const original = originalId ? state.duties.find(duty => duty.id === originalId) ?? null : null;
  const { duties, problems } = previewDutyChange(state, original, draft);
  if (problems.length) return { ok: false, problems };
  return { ok: true, state: withDuties(state, duties) };
}

/**
 * Delete a duty, handing the freed time to the previous duty on that channel —
 * or to the next one when the deleted duty was the first, or when the previous
 * one is a DB slot, which never grows. Refused when that would break a rule,
 * so a channel cannot be emptied by accident.
 */
export function deleteDuty(state: NightAllocationState, dutyId: string): EditResult {
  const original = state.duties.find(duty => duty.id === dutyId);
  if (!original) return { ok: false, problems: ["That duty is no longer on the board."] };

  const duties = state.duties.filter(duty => duty.id !== dutyId).map(duty => ({ ...duty }));
  const neighbours = neighboursOf(duties, original);
  const previous = neighbours.previous && !isFixedDuty(neighbours.previous) ? neighbours.previous : undefined;
  const next = neighbours.next && !isFixedDuty(neighbours.next) ? neighbours.next : undefined;
  const focusIds: string[] = [];

  if (previous) {
    previous.endMin = original.endMin;
    focusIds.push(previous.id);
  } else if (next) {
    next.startMin = original.startMin;
    focusIds.push(next.id);
  }

  const problems = problemsForChange(state, duties, focusIds);
  if (problems.length) return { ok: false, problems: problems.map(problem => `Can't delete: ${problem}`) };

  const takenOverBy = previous ?? next;
  const note = takenOverBy
    ? `Duty deleted. ${personName(state, takenOverBy.personKey)} now covers that time on ${original.channelCode}.`
    : "Duty deleted.";
  return { ok: true, state: withDuties(state, duties), note };
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
 * hours cut into it, or dropped when it falls outside them altogether. Any
 * stretch that leaves uncovered is for the next generate to fill.
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

  if (kept.length) {
    if (!isFixedDuty(kept[0])) kept[0].startMin = openAt;
    if (!isFixedDuty(kept[kept.length - 1])) kept[kept.length - 1].endMin = closeAt;
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
