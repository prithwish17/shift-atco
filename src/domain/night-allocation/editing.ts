/**
 * Night Channel Allocation — editing, where gaps would otherwise creep in.
 *
 * Handover times are linked. Moving a duty's start moves the previous duty's
 * end on that channel to the same minute; moving its end moves the next duty's
 * start. The whole chain is rewritten as one operation, and the operation is
 * checked **before** it is applied: a change that would open a gap, break the
 * 30 min–2 h bounds, eat into someone's break or break a half, TSO or
 * availability rule is refused and the caller's state is left exactly as it was.
 *
 * Every function here is pure. The dialog uses them to preview an edit, and the
 * API uses the same rules module to re-check whatever the client finally sends.
 */
import { MIN_DUTY_MIN, NIGHT_SPAN_MIN } from "./constants.js";
import { makeDutyId } from "./ids.js";
import { findChannel, personName, uncoveredMinutes, validateAllocation } from "./rules.js";
import { formatMinutes } from "./time.js";
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

  if (previous) {
    if (draft.startMin !== original.startMin) previous.endMin = draft.startMin;
    focusIds.push(previous.id);
  }
  if (next) {
    if (draft.endMin !== original.endMin) next.startMin = draft.endMin;
    focusIds.push(next.id);
  }
  return { duties, focusIds };
}

/**
 * What is wrong with a candidate duty list, phrased for the person making the
 * change: problems on the duties they touched, plus any new uncovered stretch
 * the change would create.
 */
export function problemsForChange(
  state: NightAllocationState,
  candidateDuties: NightDuty[],
  focusIds: string[],
): string[] {
  const candidate = withDuties(state, candidateDuties);
  const before = validateAllocation(state);
  const after = validateAllocation(candidate);
  const alreadyKnown = new Set(before.errors.map(issue => issue.message));

  const problems = after.errors
    .filter(issue => issue.dutyIds.some(id => focusIds.includes(id)))
    .map(issue => issue.message);

  if (uncoveredMinutes(candidate) > uncoveredMinutes(state)) {
    const newGaps = after.errors
      .filter(issue => issue.isGap && !alreadyKnown.has(issue.message))
      .map(issue => issue.message);
    if (newGaps.length) problems.push(...newGaps);
    else problems.push("This would leave a channel without cover. Someone must take over at the handover time.");
  }

  return [...new Set<string>(problems)];
}

/** Preview a change without committing it — what the edit dialog renders. */
export function previewDutyChange(
  state: NightAllocationState,
  original: NightDuty | null,
  draft: NightDuty,
): { duties: NightDuty[]; problems: string[] } {
  const { duties, focusIds } = buildEditedDuties(state, original, draft);
  return { duties, problems: problemsForChange(state, duties, focusIds) };
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
 * or to the next one when the deleted duty was the first. Refused when that
 * would break a rule, so a channel cannot be emptied by accident.
 */
export function deleteDuty(state: NightAllocationState, dutyId: string): EditResult {
  const original = state.duties.find(duty => duty.id === dutyId);
  if (!original) return { ok: false, problems: ["That duty is no longer on the board."] };

  const duties = state.duties.filter(duty => duty.id !== dutyId).map(duty => ({ ...duty }));
  const { previous, next } = neighboursOf(duties, original);
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

  const kept = mine
    .filter(duty => duty.endMin > openAt && duty.startMin < closeAt)
    .sort((a, b) => a.startMin - b.startMin)
    .map(duty => ({
      ...duty,
      startMin: Math.max(duty.startMin, openAt),
      endMin: Math.min(duty.endMin, closeAt),
    }));
  const removed = mine.length - kept.length;

  if (kept.length) {
    kept[0].startMin = openAt;
    kept[kept.length - 1].endMin = closeAt;
  }

  const note =
    `${window} First and last duties adjusted to match` +
    (removed ? `, ${removed} outside that time removed.` : ".");
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
