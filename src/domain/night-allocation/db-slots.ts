/**
 * Night Channel Allocation — DB slots.
 *
 * A DB slot reserves a position for training at a fixed time — TWR 17:30–19:30,
 * say. It is stored as a duty held by the instructor and marked `kind: "db"`,
 * because the instructor is the one actually marked on the position then: every
 * rule applies to it as to any duty, the exports show it with DB beside the
 * name, and the generator plans everyone else around it without moving it.
 *
 * Putting a slot down is a setting, like a position's hours, so it always
 * applies once the slot itself is sound. The plan is what gives way: ordinary
 * duties on the same position are cut back to make room, with no gap, and any
 * clash left for the instructor is reported for the next generate to resolve.
 */
import { DB_LABEL, DB_NOTE_MAX } from "./constants.js";
import { makeDutyId } from "./ids.js";
import {
  fixedDutyErrors,
  inBoardOrder,
  isFixedDuty,
  isPlanned,
  personName,
  shortStretchNotices,
  validateAllocation,
} from "./rules.js";
import { formatRange } from "./time.js";
import type { NightAllocationState, NightDuty } from "./types.js";

/** What the DB dialog edits. `id` is set when an existing slot is being changed. */
export interface DbSlotDraft {
  id?: string;
  channelCode: string;
  /** The instructor. */
  personKey: string;
  startMin: number;
  endMin: number;
  /** Who is being trained, free text. */
  note: string;
}

export interface DbSlotReview {
  /** What is wrong with the slot itself. Any one of these stops it going down. */
  problems: string[];
  /**
   * Where it collides with the current plan — the instructor already on
   * another position then, say. Not a reason to refuse: the next generate
   * plans around the slot.
   */
  clashes: string[];
  /** Advice that doesn't block, such as a stretch beside it too short to cover. */
  notices: string[];
}

export type DbSlotResult =
  | { ok: true; state: NightAllocationState; note: string }
  | { ok: false; problems: string[] };

/** Narrow a refusal; see `isRefusedEdit` for why this exists. */
export function isRefusedSlot(result: DbSlotResult): result is Extract<DbSlotResult, { ok: false }> {
  return !result.ok;
}

/**
 * A trainee note as it is kept: trimmed, bounded, null when empty. Cut by
 * character rather than by UTF-16 unit, so an emoji at the limit is dropped
 * whole instead of leaving half a surrogate pair the database would refuse.
 */
export function cleanDbNote(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = Array.from(value.replace(/\s+/g, " ").trim()).slice(0, DB_NOTE_MAX).join("").trim();
  return trimmed || null;
}

/** "DB" or "DB · Sulagna", for the board and every export. */
export function dbTag(duty: Pick<NightDuty, "kind" | "note">): string | null {
  if (!isFixedDuty(duty)) return null;
  return duty.note ? `${DB_LABEL} · ${duty.note}` : DB_LABEL;
}

/** The night's DB slots, in board order and then by time. */
export function dbSlots(state: NightAllocationState): NightDuty[] {
  const order = inBoardOrder(state.channels).map(channel => channel.code);
  const rank = (code: string) => (order.includes(code) ? order.indexOf(code) : order.length);
  return state.duties
    .filter(isFixedDuty)
    .sort((a, b) => rank(a.channelCode) - rank(b.channelCode) || a.startMin - b.startMin);
}

function slotFromDraft(draft: DbSlotDraft): NightDuty {
  return {
    id: draft.id ?? makeDutyId("db"),
    channelCode: draft.channelCode,
    personKey: draft.personKey,
    startMin: draft.startMin,
    endMin: draft.endMin,
    kind: "db",
    note: cleanDbNote(draft.note),
  };
}

/**
 * The duty list with the slot in it: the slot's old self gone, and ordinary
 * duties on its position cut back so the two never overlap. A duty that spans
 * the whole slot is kept either side of it, by the same person.
 */
function withSlot(
  duties: NightDuty[],
  slot: NightDuty,
): { duties: NightDuty[]; cutIds: string[]; removed: number } {
  const out: NightDuty[] = [];
  const cutIds: string[] = [];
  let removed = 0;
  for (const duty of duties) {
    if (duty.id === slot.id) continue;
    const overlapping =
      duty.channelCode === slot.channelCode &&
      !isFixedDuty(duty) &&
      duty.startMin < slot.endMin &&
      duty.endMin > slot.startMin;
    if (!overlapping) {
      out.push(duty);
      continue;
    }
    const before = duty.startMin < slot.startMin ? { ...duty, endMin: slot.startMin } : null;
    const after =
      duty.endMin > slot.endMin ? { ...duty, id: before ? makeDutyId() : duty.id, startMin: slot.endMin } : null;
    if (!before && !after) removed++;
    for (const piece of [before, after]) {
      if (!piece) continue;
      out.push(piece);
      cutIds.push(piece.id);
    }
  }
  out.push(slot);
  return { duties: out, cutIds, removed };
}

/**
 * What putting this slot down would do, before it is done — what the DB
 * dialog shows as it is filled in.
 */
export function reviewDbSlot(state: NightAllocationState, draft: DbSlotDraft): DbSlotReview {
  if (!draft.personKey) return { problems: ["Select the instructor."], clashes: [], notices: [] };
  if (!(draft.endMin > draft.startMin)) {
    return { problems: ["The slot must end after it starts."], clashes: [], notices: [] };
  }

  const slot = slotFromDraft(draft);
  const { duties, cutIds } = withSlot(state.duties, slot);
  const candidate = { ...state, duties };

  // Judged as if nothing but DB slots were on the board: what is wrong with
  // this slot on its own terms, or against another slot.
  const problems = fixedDutyErrors(candidate)
    .filter(issue => issue.dutyIds.includes(slot.id))
    .map(issue => issue.message);

  // Everything else the slot collides with belongs to the plan, which gives way.
  const known = new Set([...problems, ...validateAllocation(state).errors.map(issue => issue.message)]);
  const clashes = validateAllocation(candidate)
    .errors.filter(issue => issue.dutyIds.some(id => id === slot.id || cutIds.includes(id)))
    .map(issue => issue.message)
    .filter(message => !known.has(message));

  const notices = shortStretchNotices(candidate).filter(message => message.startsWith(`${slot.channelCode} `));
  return {
    problems: [...new Set(problems)],
    clashes: [...new Set(clashes)],
    notices,
  };
}

/** Put a slot down, or move an existing one. Refused only when the slot itself is unsound. */
export function placeDbSlot(state: NightAllocationState, draft: DbSlotDraft): DbSlotResult {
  const review = reviewDbSlot(state, draft);
  if (review.problems.length) return { ok: false, problems: review.problems };

  const slot = slotFromDraft(draft);
  const previous = draft.id ? state.duties.find(duty => duty.id === draft.id) : undefined;
  const { duties, cutIds, removed } = withSlot(state.duties, slot);
  const next = { ...state, duties };

  const range = formatRange(slot.startMin, slot.endMin);
  const who = personName(state, slot.personKey);
  const made = previous ? `DB slot moved to ${slot.channelCode} ${range}` : `DB slot on ${slot.channelCode} ${range}`;
  const cut = cutIds.length + removed;
  const note =
    `${made}, with ${who} instructing.` +
    (cut ? ` Made room on ${slot.channelCode} by cutting back ${cut} ${cut === 1 ? "duty" : "duties"}.` : "") +
    (isPlanned(next) && (review.clashes.length || previous) ? " Generate again to plan around it." : "");
  return { ok: true, state: next, note };
}

/**
 * Take a slot off the board. Always applies. On a planned night the stretch it
 * held is left uncovered rather than silently handed to a neighbour — the
 * checks panel shows it, and the next generate fills it.
 */
export function removeDbSlot(state: NightAllocationState, slotId: string): { state: NightAllocationState; note: string } {
  const slot = state.duties.find(duty => duty.id === slotId && isFixedDuty(duty));
  if (!slot) return { state, note: "" };
  const next = { ...state, duties: state.duties.filter(duty => duty.id !== slotId) };
  const range = formatRange(slot.startMin, slot.endMin);
  return {
    state: next,
    note:
      `DB slot on ${slot.channelCode} ${range} removed.` +
      (isPlanned(next) ? ` ${slot.channelCode} needs cover ${range} now — generate again or add a duty there.` : ""),
  };
}
