/**
 * compliance/coverage.ts
 * ---------------------------------------------------------------------------
 * Daily Availability Chart arithmetic as a base snapshot plus immutable deltas.
 *
 * A plan's effect on manpower is a small map of `(date, shift, group) → ±n`. Nothing
 * mutates the base, so there is no apply/revert pair to forget, options can be
 * evaluated in any order, and stacking two accepted suggestions is just merging their
 * deltas — which closes the gap where two individually-safe picks jointly drop a
 * group below its minimum.
 *
 * The whole source-depletion gate reduces to: for every negative entry in the delta,
 * assert `base + delta >= required`.
 */
import {
  GROUP_SHIFT_MINIMUMS,
  OCC_RATING_CATEGORIES,
  OCC_SHIFT_MINIMUMS,
  RATING_GROUPS,
  buildMembersByCell,
  countUniqueMembers,
  matchesSummaryCategory,
  type GroupNum,
  type SummaryScheduleMember,
} from "@/lib/supervisorAvailability";
import { getDutyShiftMatches } from "@/lib/teamDutyRotation";
import type { ShiftCode } from "./rosterState";
import type { DutyMutation } from "./planValidator";

/** `date::shift::group`, e.g. `2026-03-11::N::G3`. */
export type CellKey = string;

/** The five rating groups plus the OCC sub-constraint inside group 3. */
export type GroupKey = `G${GroupNum}` | "OCC";

export const SHIFTS: ShiftCode[] = ["M", "A", "N"];
export const GROUP_KEYS: GroupKey[] = [
  ...(Object.keys(RATING_GROUPS).map(Number) as GroupNum[]).map((g) => `G${g}` as GroupKey),
  "OCC",
];

export const cellKey = (date: string, shift: string, group: string): CellKey =>
  `${date}::${shift}::${group}`;

export function parseCellKey(key: CellKey) {
  const [date, shift, group] = key.split("::");
  return { date, shift: shift as ShiftCode, group: group as GroupKey };
}

function categoriesFor(group: GroupKey): string[] {
  return group === "OCC" ? OCC_RATING_CATEGORIES : RATING_GROUPS[Number(group.slice(1)) as GroupNum].categories;
}

export function groupLabel(group: GroupKey): string {
  return group === "OCC" ? "OCC" : RATING_GROUPS[Number(group.slice(1)) as GroupNum].shortLabel;
}

/** Minimum head-count for a group on a shift (D1 of the compiled rules). */
export function requiredFor(group: GroupKey, shift: ShiftCode): number {
  const index = shift === "N" ? 1 : 0;
  return group === "OCC"
    ? OCC_SHIFT_MINIMUMS[index]
    : GROUP_SHIFT_MINIMUMS[Number(group.slice(1)) as GroupNum][index];
}

/** Groups a controller counts toward. Usually one, but ratings can overlap. */
export function groupsOf(member: SummaryScheduleMember): GroupKey[] {
  return GROUP_KEYS.filter((g) => categoriesFor(g).some((c) => matchesSummaryCategory(c, member)));
}

/** M/A/N slots a duty code occupies. Rest and General occupy none. */
export function shiftsOf(dutyCode: string | null | undefined): ShiftCode[] {
  return getDutyShiftMatches(dutyCode).filter((s): s is ShiftCode => s === "M" || s === "A" || s === "N");
}

/** Current head-count per (date, shift, group) for the given dates. */
export function buildCoverageBase(
  members: SummaryScheduleMember[],
  dates: string[],
): Map<CellKey, number> {
  const byCell = buildMembersByCell(members, dates);
  const base = new Map<CellKey, number>();

  for (const date of dates) {
    for (const shift of SHIFTS) {
      const cellMembers = byCell.get(`${date}::${shift}`) ?? [];
      for (const group of GROUP_KEYS) {
        const categories = categoriesFor(group);
        const count = countUniqueMembers(
          cellMembers.filter((m) => categories.some((c) => matchesSummaryCategory(c, m))),
        );
        base.set(cellKey(date, shift, group), count);
      }
    }
  }
  return base;
}

function bump(delta: Map<CellKey, number>, key: CellKey, by: number) {
  const next = (delta.get(key) ?? 0) + by;
  if (next === 0) delta.delete(key);
  else delta.set(key, next);
}

/**
 * Manpower change a plan causes. `A → M+A` yields `M +1` and leaves A untouched,
 * which is why extra duty costs no coverage; `N → M` yields `N −1, M +1`.
 */
export function mutationDelta(
  member: SummaryScheduleMember,
  mutations: DutyMutation[],
): Map<CellKey, number> {
  const delta = new Map<CellKey, number>();
  const groups = groupsOf(member);

  for (const m of mutations) {
    for (const group of groups) {
      for (const shift of shiftsOf(m.from)) bump(delta, cellKey(m.date, shift, group), -1);
      for (const shift of shiftsOf(m.to)) bump(delta, cellKey(m.date, shift, group), +1);
    }
  }
  return delta;
}

/** Combine deltas so already-accepted plans are accounted for when ranking the next. */
export function mergeDeltas(deltas: Map<CellKey, number>[]): Map<CellKey, number> {
  const merged = new Map<CellKey, number>();
  for (const delta of deltas) for (const [key, value] of delta) bump(merged, key, value);
  return merged;
}

export interface CoverageShortfall {
  cell: CellKey;
  date: string;
  shift: ShiftCode;
  group: GroupKey;
  label: string;
  before: number;
  after: number;
  required: number;
}

/**
 * Cells a plan would push below their minimum. Only negative deltas can offend —
 * adding people never breaks coverage.
 */
export function coverageShortfalls(
  base: Map<CellKey, number>,
  delta: Map<CellKey, number>,
): CoverageShortfall[] {
  const shortfalls: CoverageShortfall[] = [];

  for (const [cell, change] of delta) {
    if (change >= 0) continue;
    const { date, shift, group } = parseCellKey(cell);
    const before = base.get(cell) ?? 0;
    const after = before + change;
    const required = requiredFor(group, shift);
    if (after < required) {
      shortfalls.push({ cell, date, shift, group, label: groupLabel(group), before, after, required });
    }
  }
  return shortfalls;
}

/** Deficit against the minimum for one date + shift — a column of the chart. */
export function deficitsFor(
  base: Map<CellKey, number>,
  delta: Map<CellKey, number>,
  date: string,
  shift: ShiftCode,
): Array<{ group: GroupKey; label: string; available: number; required: number; deficit: number }> {
  return GROUP_KEYS.map((group) => {
    const key = cellKey(date, shift, group);
    const available = (base.get(key) ?? 0) + (delta.get(key) ?? 0);
    const required = requiredFor(group, shift);
    return { group, label: groupLabel(group), available, required, deficit: Math.max(0, required - available) };
  });
}
