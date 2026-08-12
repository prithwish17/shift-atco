/**
 * compliance/manpower.ts
 * ---------------------------------------------------------------------------
 * Two things the Availability Finder needs and `coverage.ts` deliberately does not
 * provide, because they are about EXPLAINING the chart rather than computing it:
 *
 * 1. `buildDayManpower` — the whole Daily Availability Chart column for one date:
 *    all three shifts, every rating group, the head-count behind each number, and
 *    the day's extra-duty / General / leave / rest populations. The engine only ever
 *    needed the counts; a supervisor deciding whether to move a body needs to see
 *    the day they are moving it within.
 *
 * 2. `planImpact` — a symmetric, per-cell statement of what a plan does to that
 *    chart: which cells it takes a body FROM, which it adds one TO, the before →
 *    after against the minimum, and how much slack is left in the tightest donor.
 *
 * The source-shift gate itself lives in `coverageShortfalls`. `planImpact` is a
 * superset of it — the same arithmetic, but it also reports the cells that survive
 * the change. That matters: a gate that only ever speaks up to say "no" trains
 * supervisors to read silence as "unchecked". `breaches` here and
 * `coverageShortfalls` there are derived from the same base + delta and are asserted
 * equivalent in the tests, so the two can never disagree about what is legal.
 */
import { format, parseISO } from "date-fns";

import { isOpeCode } from "@/lib/dutyConfig";
import {
  TOTAL_SHIFT_REQUIREMENTS,
  type SummaryScheduleMember,
} from "@/lib/supervisorAvailability";
import {
  GROUP_KEYS,
  SHIFTS,
  dedupeRoster,
  groupLabel,
  groupsOf,
  parseCellKey,
  requiredFor,
  shiftsOf,
  type CellKey,
  type GroupKey,
} from "./coverage";
import type { DutyMutation } from "./planValidator";
import { classifyDuty, originLabel, type ShiftCode } from "./rosterState";

export const SHIFT_LABEL: Record<ShiftCode, string> = {
  M: "Morning",
  A: "Afternoon",
  N: "Night",
};

/* ── The day's chart ──────────────────────────────────────────────────────── */

export interface ManpowerCell {
  group: GroupKey;
  label: string;
  available: number;
  required: number;
  /** `available − required`. Negative means the cell is short. */
  net: number;
  /** How many below the minimum; 0 when the cell is met. */
  deficit: number;
  /** Bodies that could be released before the minimum breaks; 0 when at or below it. */
  headroom: number;
}

export interface RosterEntry {
  employeeId: string;
  name: string;
  team: string | null;
  rating: string | null;
  dutyCode: string | null;
  /** "Morning", "Night-off", "Leave" … — the same wording the option rows use. */
  originLabel: string;
  /** Chart groups this controller counts toward. Usually one; ratings can overlap. */
  groups: GroupKey[];
  /** M/A/N slots the duty occupies. Empty for General, leave and rest. */
  shifts: ShiftCode[];
  /** Compound duty worked beyond a single rostered shift — M+A, NO+N, CO+M … */
  ope: boolean;
}

export interface ShiftManpower {
  shift: ShiftCode;
  label: string;
  cells: ManpowerCell[];
  /** Unique bodies on the shift, however many groups each counts toward. */
  headcount: number;
  /** Sum of the group minimums for this shift (the chart's own total row). */
  required: number;
  /** Total bodies below minimum, summed across groups — the shift's shortfall. */
  deficit: number;
  /** Groups currently below their minimum. */
  shortGroups: ManpowerCell[];
  onDuty: RosterEntry[];
  /** The subset of `onDuty` already working an extra duty. */
  extraDuty: RosterEntry[];
}

export interface DayManpower {
  date: string;
  /** False when nothing is rostered that day — an unpublished future date. */
  rostered: boolean;
  shifts: ShiftManpower[];
  byShift: Record<ShiftCode, ShiftManpower>;
  /** Everyone on an extra duty that day, deduped across the shifts it spans. */
  extraDuty: RosterEntry[];
  general: RosterEntry[];
  onLeave: RosterEntry[];
  resting: RosterEntry[];
  totals: {
    /** Unique bodies holding at least one M/A/N slot. */
    onDuty: number;
    extraDuty: number;
    general: number;
    onLeave: number;
    resting: number;
    /** Everyone with a roster row for the day. */
    rostered: number;
  };
}

const displayName = (m: Pick<SummaryScheduleMember, "employee_id" | "employee_name">) =>
  String(m.employee_name || m.employee_id || "").trim();

function toRosterEntry(member: SummaryScheduleMember): RosterEntry {
  const dutyCode = member.duty_code ?? null;
  return {
    employeeId: member.employee_id,
    name: displayName(member),
    team: member.current_shift || null,
    rating: member.highest_rating || null,
    dutyCode,
    originLabel: originLabel(dutyCode),
    groups: groupsOf(member),
    shifts: shiftsOf(dutyCode),
    ope: isOpeCode(dutyCode),
  };
}

const byName = (a: RosterEntry, b: RosterEntry) => a.name.localeCompare(b.name);

const rosterKey = (id: string) => id.trim().toUpperCase();

/**
 * The day's roster rows with a set of not-yet-written duty changes folded in.
 *
 * Rewriting the ROWS rather than adjusting the counts afterwards is deliberate: the
 * head-counts and the name lists then come from one array, so a projected chart can
 * never show 13 on the Morning next to twelve names. A change for someone with no
 * row that day (a rest-day call-in) borrows their identity from any other row they
 * have, so they appear as the body they are about to become.
 */
function applyPendingToRoster(
  members: SummaryScheduleMember[],
  date: string,
  pending: DutyMutation[],
): SummaryScheduleMember[] {
  const rows = new Map(dedupeRoster(members, [date]).map((m) => [rosterKey(m.employee_id), m]));
  const onDate = pending.filter((m) => m.date === date);
  if (onDate.length === 0) return [...rows.values()];

  const identities = new Map<string, SummaryScheduleMember>();
  for (const member of members) identities.set(rosterKey(member.employee_id), member);

  for (const mutation of onDate) {
    const key = rosterKey(mutation.employeeId);
    const identity = rows.get(key) ?? identities.get(key);
    if (!identity) continue;
    rows.set(key, { ...identity, duty_date: date, duty_code: mutation.to, duty_description: mutation.to });
  }
  return [...rows.values()];
}

/**
 * The full chart column for one date, optionally with staged duty changes folded in
 * so the UI can show the day as it WOULD be.
 *
 * Head-counts come from the same `groupsOf` / `shiftsOf` pair the delta arithmetic
 * uses, so the numbers shown to a supervisor and the numbers the gate enforces are
 * computed one way, not two.
 */
export function buildDayManpower(
  members: SummaryScheduleMember[],
  date: string,
  pending: DutyMutation[] = [],
): DayManpower {
  // The same dedupe the coverage base uses, so the head-counts shown here and the
  // ones the gate enforces are the same numbers rather than two near-agreeing ones.
  const roster = applyPendingToRoster(members, date, pending).map(toRosterEntry);

  const byShift = {} as Record<ShiftCode, ShiftManpower>;
  for (const shift of SHIFTS) {
    const onDuty = roster.filter((r) => r.shifts.includes(shift)).sort(byName);

    const cells: ManpowerCell[] = GROUP_KEYS.map((group) => {
      const available = onDuty.filter((r) => r.groups.includes(group)).length;
      const required = requiredFor(group, shift);
      return {
        group,
        label: groupLabel(group),
        available,
        required,
        net: available - required,
        deficit: Math.max(0, required - available),
        headroom: Math.max(0, available - required),
      };
    });

    byShift[shift] = {
      shift,
      label: SHIFT_LABEL[shift],
      cells,
      headcount: onDuty.length,
      required: TOTAL_SHIFT_REQUIREMENTS[shift],
      deficit: cells.reduce((sum, c) => sum + c.deficit, 0),
      shortGroups: cells.filter((c) => c.deficit > 0),
      onDuty,
      extraDuty: onDuty.filter((r) => r.ope),
    };
  }

  const shifts = SHIFTS.map((s) => byShift[s]);
  const classOf = (r: RosterEntry) => classifyDuty(r.dutyCode);

  const onDutyCount = roster.filter((r) => r.shifts.length > 0).length;
  const extraDuty = roster.filter((r) => r.ope).sort(byName);
  const general = roster.filter((r) => classOf(r).general).sort(byName);
  const onLeave = roster.filter((r) => classOf(r).kind === "leave").sort(byName);
  const resting = roster.filter((r) => classOf(r).kind === "off").sort(byName);

  return {
    date,
    rostered: roster.length > 0,
    shifts,
    byShift,
    extraDuty,
    general,
    onLeave,
    resting,
    totals: {
      onDuty: onDutyCount,
      extraDuty: extraDuty.length,
      general: general.length,
      onLeave: onLeave.length,
      resting: resting.length,
      rostered: roster.length,
    },
  };
}

/* ── What a plan does to the chart ────────────────────────────────────────── */

/** Where a cell sits against its minimum after a change. */
export type ImpactStatus = "surplus" | "at-minimum" | "breach";

export interface CellImpact {
  cell: CellKey;
  date: string;
  shift: ShiftCode;
  shiftLabel: string;
  group: GroupKey;
  label: string;
  /** Signed bodies moved into (+) or out of (−) this cell. */
  change: number;
  before: number;
  after: number;
  required: number;
  /** Spare bodies once the change lands; negative when the cell ends up short. */
  headroomAfter: number;
  status: ImpactStatus;
}

export interface PlanImpact {
  /** Cells the plan takes a body FROM. Only these can breach a minimum. */
  releases: CellImpact[];
  /** Cells the plan adds a body TO. */
  reinforcements: CellImpact[];
  /** Releases that end below the minimum. Non-empty ⇒ the plan is not operationally safe. */
  breaches: CellImpact[];
  /** Releases that land exactly ON the minimum — legal, but with nothing left over. */
  atMinimum: CellImpact[];
  /** The donor cell closest to its minimum after the change. */
  tightest: CellImpact | null;
  /**
   * Spare bodies left in the tightest donor cell, or `null` when the plan takes
   * nobody from anywhere (a call-in, a night-off recall, an extra duty). `null`
   * rather than `Infinity` so the value survives the JSON audit snapshot.
   */
  safetyMargin: number | null;
}

function statusOf(after: number, required: number): ImpactStatus {
  if (after < required) return "breach";
  if (after === required) return "at-minimum";
  return "surplus";
}

function toCellImpact(base: Map<CellKey, number>, cell: CellKey, change: number): CellImpact {
  const { date, shift, group } = parseCellKey(cell);
  const before = base.get(cell) ?? 0;
  const after = before + change;
  const required = requiredFor(group, shift);
  return {
    cell,
    date,
    shift,
    shiftLabel: SHIFT_LABEL[shift],
    group,
    label: groupLabel(group),
    change,
    before,
    after,
    required,
    headroomAfter: after - required,
    status: statusOf(after, required),
  };
}

/**
 * Order impacts the way a supervisor reads them: the most dangerous first, then a
 * stable date → shift → group ordering so two renders never disagree.
 */
const SHIFT_RANK: Record<ShiftCode, number> = { M: 0, A: 1, N: 2 };
function compareImpacts(a: CellImpact, b: CellImpact): number {
  return (
    a.headroomAfter - b.headroomAfter ||
    a.date.localeCompare(b.date) ||
    SHIFT_RANK[a.shift] - SHIFT_RANK[b.shift] ||
    a.label.localeCompare(b.label)
  );
}

/**
 * Every cell a plan moves, split by direction.
 *
 * Adding a body can never break a minimum, so only `releases` are gate-relevant —
 * but reinforcements are what the supervisor actually asked for, and showing both
 * halves is the difference between "this is allowed" and "this is what happens".
 */
export function planImpact(base: Map<CellKey, number>, delta: Map<CellKey, number>): PlanImpact {
  const releases: CellImpact[] = [];
  const reinforcements: CellImpact[] = [];

  for (const [cell, change] of delta) {
    if (change === 0) continue;
    const impact = toCellImpact(base, cell, change);
    (change < 0 ? releases : reinforcements).push(impact);
  }

  releases.sort(compareImpacts);
  reinforcements.sort(compareImpacts);

  const breaches = releases.filter((r) => r.status === "breach");
  const atMinimum = releases.filter((r) => r.status === "at-minimum");
  const tightest = releases[0] ?? null;

  return {
    releases,
    reinforcements,
    breaches,
    atMinimum,
    tightest,
    safetyMargin: tightest ? tightest.headroomAfter : null,
  };
}

/**
 * Sortable form of `safetyMargin`: a plan that depletes nothing is more resilient
 * than any plan that does, so `null` ranks above every finite margin.
 */
export function safetyRank(margin: number | null): number {
  return margin === null ? Number.POSITIVE_INFINITY : margin;
}

/** One-line summary of a plan's manpower effect, for compact rows and audit text. */
export function describeImpact(impact: PlanImpact): string {
  const move = (c: CellImpact) =>
    `${c.label} ${c.shiftLabel} ${format(parseISO(c.date), "d MMM")} ${c.before}→${c.after}/${c.required}`;

  const parts = [
    ...impact.reinforcements.map((c) => `+${move(c)}`),
    ...impact.releases.map((c) => `−${move(c)}`),
  ];
  return parts.length > 0 ? parts.join(" · ") : "No change to any rating group";
}
