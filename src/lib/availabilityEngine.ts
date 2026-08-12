/**
 * availabilityEngine.ts
 * ---------------------------------------------------------------------------
 * Turns "this shift is short" into an ordered list of duty plans.
 *
 * Ordering follows the operational ladder (compliance/ladder.ts):
 *   Night   — Night-off call-in → Afternoon swap → General → rest → clear-off
 *   Morning — Afternoon swap → night-break → extra duty → General → rest → clear-off
 *   Afternoon — the mirror of Morning
 *
 * Within a rung, controllers rotate by how often they have already been imposed on.
 * Hard gates (WDTL limits and the availability-chart minimums) are checked against
 * the whole affected window, not just the target day, so a plan that is legal today
 * but breaks a rest requirement two days out is caught.
 */
import { addDays, format, parseISO } from "date-fns";

import {
  RATING_GROUPS,
  matchesSummaryCategory,
  type GroupNum,
  type SummaryScheduleMember,
} from "@/lib/supervisorAvailability";
import {
  GROUP_KEYS,
  SHIFTS,
  buildCoverageBase,
  cellKey,
  deficitsFor,
  groupLabel,
  mutationDelta,
  requiredFor,
  type GroupKey,
} from "@/lib/compliance/coverage";
import { applyMutations, type DutyMutation } from "@/lib/compliance/planValidator";
import {
  EMPTY_FAIRNESS,
  buildOptions,
  rankOptions,
  type CoverOption,
  type FairnessHistory,
} from "@/lib/compliance/ladder";
import { buildDayManpower, type DayManpower } from "@/lib/compliance/manpower";
import { buildTimelines, classifyDuty, originLabel, type ShiftCode } from "@/lib/compliance/rosterState";

export type { ShiftCode } from "@/lib/compliance/rosterState";
export type { CoverOption } from "@/lib/compliance/ladder";
export type RatingFilter = GroupNum | "ALL";

const GROUP_NUMS = Object.keys(RATING_GROUPS).map(Number) as GroupNum[];

/**
 * ISO date `offset` days from `date`.
 *
 * date-fns rather than `new Date(…).toISOString()`: the latter parses "yyyy-MM-dd"
 * as LOCAL midnight and then formats in UTC, so anywhere east of Greenwich the round
 * trip lands back on the previous day and `iso(date, 1)` silently returned `date`
 * itself. In IST that collapsed the two-day window a night-break needs, which made
 * the second day's chart cells invisible to both the depletion gate and the
 * "does this day actually need the body?" test.
 */
const iso = (date: string, offset: number) => format(addDays(parseISO(date), offset), "yyyy-MM-dd");

export function shiftLabel(shift: ShiftCode): string {
  return shift === "M" ? "Morning" : shift === "A" ? "Afternoon" : "Night";
}

export function ratingFilterLabel(filter: RatingFilter): string {
  return filter === "ALL" ? "All ratings" : RATING_GROUPS[filter].label;
}

function matchesRatingFilter(member: SummaryScheduleMember, filter: RatingFilter): boolean {
  if (filter === "ALL") return Boolean(String(member.highest_rating || "").trim());
  return RATING_GROUPS[filter].categories.some((c) => matchesSummaryCategory(c, member));
}

/* ── Availability snapshot ────────────────────────────────────────────────── */

export interface RatingCellAvailability {
  key: string;
  label: string;
  available: number;
  required: number;
  deficit: number;
}

export interface ShiftBreach extends RatingCellAvailability {
  date: string;
  shift: ShiftCode;
}

/**
 * Rating cells below minimum across a window. Dates with no published roster are
 * skipped so an empty future day is not reported as a wall of breaches.
 */
export function scanBreaches(members: SummaryScheduleMember[], dates: string[]): ShiftBreach[] {
  const base = buildCoverageBase(members, dates);
  const breaches: ShiftBreach[] = [];

  for (const date of dates) {
    const rostered = SHIFTS.some((s) =>
      GROUP_KEYS.some((g) => (base.get(cellKey(date, s, g)) ?? 0) > 0),
    );
    if (!rostered) continue;

    for (const shift of SHIFTS) {
      for (const group of GROUP_KEYS) {
        const available = base.get(cellKey(date, shift, group)) ?? 0;
        const required = requiredFor(group as GroupKey, shift);
        if (available < required) {
          breaches.push({
            date,
            shift,
            key: group,
            label: groupLabel(group as GroupKey),
            available,
            required,
            deficit: required - available,
          });
        }
      }
    }
  }
  return breaches;
}

/* ── Cover search ─────────────────────────────────────────────────────────── */

export interface AlreadyCovering {
  employeeId: string;
  name: string;
  team: string | null;
  rating: string | null;
  /** True when they are only on this shift because of a staged, unwritten pick. */
  staged: boolean;
}

export interface RungGroup {
  rung: number;
  label: string;
  options: CoverOption[];
}

export interface AvailabilityResult {
  date: string;
  shift: ShiftCode;
  ratingLabel: string;
  /** Rule-safe plans, best rung first. */
  options: CoverOption[];
  /** The same options grouped for display, in rung order. */
  rungs: RungGroup[];
  /** Plans that break a hard gate, with the rule they fail. */
  blocked: CoverOption[];
  alreadyCovering: AlreadyCovering[];
  /**
   * The whole Daily Availability Chart column for the requested date — all three
   * shifts, every rating group, plus the day's extra-duty / General / leave / rest
   * populations. A supervisor cannot judge whether moving a body is wise from the
   * target shift alone; the donor shift is the other half of the decision.
   */
  dayManpower: DayManpower;
  /** The same day as it WOULD be with the staged picks applied, or null if none. */
  projectedManpower: DayManpower | null;
  meta: { poolSize: number; generated: number };
}

export interface FindAvailabilityArgs {
  members: SummaryScheduleMember[];
  date: string;
  shift: ShiftCode;
  rating: RatingFilter;
  history?: Map<string, FairnessHistory>;
  /**
   * Duty changes staged in this sitting but not yet written. Every suggestion is
   * generated, gated and ranked against the roster as it will actually be — not as
   * it was before the first pick. Without this, two individually safe picks can
   * jointly strip a shift below its minimum and nothing objects.
   */
  pending?: DutyMutation[];
}

/** Staged mutations grouped by the timeline key `buildTimelines` uses. */
function groupPending(pending: DutyMutation[]): Map<string, DutyMutation[]> {
  const grouped = new Map<string, DutyMutation[]>();
  for (const mutation of pending) {
    const key = mutation.employeeId.trim().toUpperCase();
    grouped.set(key, [...(grouped.get(key) ?? []), mutation]);
  }
  return grouped;
}

export function findAvailability({
  members,
  date,
  shift,
  rating,
  history,
  pending = [],
}: FindAvailabilityArgs): AvailabilityResult {
  const timelines = buildTimelines(members);
  const nextDay = iso(date, 1);

  // A night-break writes to the following day too, so both must be in the snapshot.
  const base = buildCoverageBase(members, [date, nextDay]);
  const stagedShifts = new Set<string>();

  // Staged picks move BOTH halves of the model: the timeline the duty rules are
  // evaluated against, and the head-counts the coverage gate reads. Adjusting only
  // the counts would leave someone offerable as a Morning donor after they had
  // already been staged off the Morning, and validate that plan against the duty
  // they no longer hold. The delta is derived from the same mutations rather than
  // passed in alongside them, so the two cannot describe different plans.
  for (const [key, mutations] of groupPending(pending)) {
    const timeline = timelines.get(key);
    if (!timeline) continue;

    timelines.set(key, applyMutations(timeline, mutations));
    for (const [cell, change] of mutationDelta(timeline.member, mutations)) {
      base.set(cell, (base.get(cell) ?? 0) + change);
    }
    for (const mutation of mutations) {
      if (mutation.date === date) stagedShifts.add(key);
    }
  }

  const options: CoverOption[] = [];
  const blocked: CoverOption[] = [];
  const alreadyCovering: AlreadyCovering[] = [];
  let poolSize = 0;

  for (const tl of timelines.values()) {
    if (!matchesRatingFilter(tl.member, rating)) continue;
    poolSize += 1;

    const today = classifyDuty(tl.dutyByDate.get(date));
    if (today.kind === "working" && today.shifts.includes(shift)) {
      alreadyCovering.push({
        employeeId: tl.employeeId,
        name: tl.name,
        team: tl.team,
        rating: tl.rating,
        staged: stagedShifts.has(tl.employeeId.trim().toUpperCase()),
      });
      continue;
    }

    const fairness = history?.get(tl.employeeId.trim().toUpperCase()) ?? EMPTY_FAIRNESS;
    for (const option of buildOptions({
      timeline: tl,
      member: tl.member,
      targetDate: date,
      targetShift: shift,
      base,
      fairness,
    })) {
      (option.blocked ? blocked : options).push(option);
    }
  }

  const ranked = rankOptions(options);
  alreadyCovering.sort((a, b) => a.name.localeCompare(b.name));

  // The chart the supervisor reads is derived from the same base the gate enforces,
  // so the "before" column of an option's impact and the day view cannot disagree.
  const dayManpower = buildDayManpower(members, date);

  return {
    date,
    shift,
    ratingLabel: ratingFilterLabel(rating),
    options: ranked,
    rungs: groupByRung(ranked),
    blocked: rankOptions(blocked),
    alreadyCovering,
    dayManpower,
    projectedManpower: pending.length > 0 ? buildDayManpower(members, date, pending) : null,
    meta: { poolSize, generated: ranked.length + blocked.length },
  };
}

/** Group ranked options into display sections, preserving rung order. */
function groupByRung(options: CoverOption[]): RungGroup[] {
  const groups: RungGroup[] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last && last.rung === option.rung) last.options.push(option);
    else groups.push({ rung: option.rung, label: option.strategyLabel, options: [option] });
  }
  return groups;
}

export { GROUP_NUMS };
