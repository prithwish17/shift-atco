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
  requiredFor,
  type CellKey,
  type GroupKey,
} from "@/lib/compliance/coverage";
import {
  EMPTY_FAIRNESS,
  buildOptions,
  rankOptions,
  type CoverOption,
  type FairnessHistory,
} from "@/lib/compliance/ladder";
import { buildTimelines, classifyDuty, originLabel, type ShiftCode } from "@/lib/compliance/rosterState";

export type { ShiftCode } from "@/lib/compliance/rosterState";
export type { CoverOption } from "@/lib/compliance/ladder";
export type RatingFilter = GroupNum | "ALL";

const GROUP_NUMS = Object.keys(RATING_GROUPS).map(Number) as GroupNum[];

const iso = (date: string, offset: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

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

/** Per rating-group availability for one date + shift — a column of the chart. */
export function computeRatingAvailability(
  members: SummaryScheduleMember[],
  date: string,
  shift: ShiftCode,
): RatingCellAvailability[] {
  const base = buildCoverageBase(members, [date]);
  return deficitsFor(base, new Map(), date, shift).map((row) => ({
    key: row.group,
    label: row.label,
    available: row.available,
    required: row.required,
    deficit: row.deficit,
  }));
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
  ratingAvailability: RatingCellAvailability[];
  meta: { poolSize: number; generated: number };
}

export interface FindAvailabilityArgs {
  members: SummaryScheduleMember[];
  date: string;
  shift: ShiftCode;
  rating: RatingFilter;
  history?: Map<string, FairnessHistory>;
  /**
   * Deltas from plans already accepted in this sitting, so a second suggestion is
   * ranked against the roster as it will actually be — not as it was before the first.
   */
  pendingDelta?: Map<CellKey, number>;
}

export function findAvailability({
  members,
  date,
  shift,
  rating,
  history,
  pendingDelta,
}: FindAvailabilityArgs): AvailabilityResult {
  const timelines = buildTimelines(members);
  const nextDay = iso(date, 1);

  // A night-break writes to the following day too, so both must be in the snapshot.
  const base = buildCoverageBase(members, [date, nextDay]);
  if (pendingDelta) {
    for (const [key, value] of pendingDelta) base.set(key, (base.get(key) ?? 0) + value);
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

  return {
    date,
    shift,
    ratingLabel: ratingFilterLabel(rating),
    options: ranked,
    rungs: groupByRung(ranked),
    blocked: rankOptions(blocked),
    alreadyCovering,
    ratingAvailability: computeRatingAvailability(members, date, shift),
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

/** Human summary of a plan's manpower effect, for the UI. */
export function describeCoverage(option: CoverOption): string[] {
  return [...option.coverageDelta.entries()]
    .filter(([, change]) => change !== 0)
    .map(([key, change]) => {
      const [cellDate, cellShift, group] = key.split("::");
      const sign = change > 0 ? "+" : "";
      return `${groupLabel(group as GroupKey)} ${shiftLabel(cellShift as ShiftCode)} ${cellDate}: ${sign}${change}`;
    });
}

export { GROUP_NUMS };
