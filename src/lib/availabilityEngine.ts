/**
 * availabilityEngine.ts
 * ---------------------------------------------------------------------------
 * Availability/exchange layer over the compliance engine.
 *
 * Rules enforced when suggesting a replacement:
 *  - candidates are sourced from OTHER shifts/rest (never someone already on
 *    the target shift); each candidate shows the shift they come from.
 *  - WORKING HOURS must not be violated (7-day, 30-day, consecutive days) — hard gate.
 *  - DAILY AVAILABILITY CHART must not be violated — pulling a swap candidate may
 *    not drop their source shift's group below its minimum (hard gate).
 *  - Clear-off (CO) is the lowest priority source of all.
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
import { evaluateCandidate, type EmployeeHistory } from "@/lib/compliance/engine";
import { buildTimelines, classifyDuty, originLabel, type ShiftCode } from "@/lib/compliance/rosterState";
import { isRuleEnabled } from "@/lib/compliance/registry";
import type { LedgerEntry } from "@/lib/compliance/types";

export type { ShiftCode } from "@/lib/compliance/rosterState";
export type RatingFilter = GroupNum | "ALL";

/** 0 = call-in from rest (best) · 1 = swap from another shift · 2 = clear-off (lowest). */
export type PriorityClass = 0 | 1 | 2;

/**
 * Manpower at the destination shift the candidate would move INTO, and — for swaps —
 * the donor shift they would leave, for each rating group the candidate belongs to.
 * Counts are the current totals (before this move is applied).
 */
export interface CandidateCoverage {
  groupKey: string;
  label: string;
  targetShift: ShiftCode;
  targetAvailable: number;
  targetRequired: number;
  donorShift: ShiftCode | null;
  donorAvailable: number | null;
  donorRequired: number | null;
}

export interface AvailabilityCandidate {
  employeeId: string;
  name: string;
  team: string | null;
  rating: string | null;
  currentDutyCode: string | null;
  /** Where they're coming from, e.g. "Afternoon", "Night-off", "Clear-off". */
  originLabel: string;
  originShift: ShiftCode | null;
  mode: "call-in" | "swap";
  priorityClass: PriorityClass;
  score: number;
  fit: number;
  reasons: string[];
  warnings: string[];
  coverage: CandidateCoverage[];
  ledger: LedgerEntry[];
  history: EmployeeHistory | null;
}

export interface BlockedCandidate {
  employeeId: string;
  name: string;
  team: string | null;
  rating: string | null;
  originLabel: string;
  blockReasons: string[];
}

export interface AlreadyCovering {
  employeeId: string;
  name: string;
  team: string | null;
  rating: string | null;
}

export interface AvailabilityResult {
  date: string;
  shift: ShiftCode;
  ratingLabel: string;
  candidates: AvailabilityCandidate[];
  blocked: BlockedCandidate[];
  alreadyCovering: AlreadyCovering[];
  /** Per rating-group availability vs minimum for the searched date + shift. */
  ratingAvailability: RatingCellAvailability[];
  meta: { poolSize: number };
}

const GROUP_NUMS = Object.keys(RATING_GROUPS).map(Number) as GroupNum[];

function normalizeUpper(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function matchesRatingFilter(member: SummaryScheduleMember, filter: RatingFilter): boolean {
  if (filter === "ALL") return Boolean(normalizeUpper(member.highest_rating));
  return RATING_GROUPS[filter].categories.some((category) => matchesSummaryCategory(category, member));
}

export function ratingFilterLabel(filter: RatingFilter): string {
  return filter === "ALL" ? "All ratings" : RATING_GROUPS[filter].label;
}

export function shiftLabel(shift: ShiftCode): string {
  return shift === "M" ? "Morning" : shift === "A" ? "Afternoon" : "Night";
}

function requiredForGroup(group: GroupNum, shift: ShiftCode) {
  return GROUP_SHIFT_MINIMUMS[group][shift === "N" ? 1 : 0];
}

/** Availability vs minimum for one rating cell (group or the OCC sub-constraint). */
export interface RatingCellAvailability {
  key: string;
  label: string;
  available: number;
  required: number;
  deficit: number;
}

function countMatching(cellMembers: SummaryScheduleMember[], categories: string[]): number {
  return countUniqueMembers(cellMembers.filter((m) => categories.some((c) => matchesSummaryCategory(c, m))));
}

function occRequiredFor(shift: ShiftCode): number {
  return shift === "N" ? OCC_SHIFT_MINIMUMS[1] : OCC_SHIFT_MINIMUMS[0];
}

/**
 * Per rating-group availability (plus the OCC sub-constraint) for one date + shift —
 * mirrors a single column of the Daily Availability Chart.
 */
export function computeRatingAvailability(
  members: SummaryScheduleMember[],
  date: string,
  shift: ShiftCode,
): RatingCellAvailability[] {
  const cellMembers = buildMembersByCell(members, [date]).get(`${date}::${shift}`) || [];

  const rows: RatingCellAvailability[] = GROUP_NUMS.map((g) => {
    const available = countMatching(cellMembers, RATING_GROUPS[g].categories);
    const required = requiredForGroup(g, shift);
    return { key: `G${g}`, label: RATING_GROUPS[g].shortLabel, available, required, deficit: Math.max(0, required - available) };
  });

  const occAvailable = countMatching(cellMembers, OCC_RATING_CATEGORIES);
  const occRequired = occRequiredFor(shift);
  rows.push({ key: "OCC", label: "OCC", available: occAvailable, required: occRequired, deficit: Math.max(0, occRequired - occAvailable) });

  return rows;
}

export interface ShiftBreach extends RatingCellAvailability {
  date: string;
  shift: ShiftCode;
}

/**
 * Scan a window of dates for every rating cell below its minimum across all three
 * shifts. Dates with no published roster are skipped so an empty future day is not
 * reported as a wall of breaches.
 */
export function scanBreaches(members: SummaryScheduleMember[], dates: string[]): ShiftBreach[] {
  const byCell = buildMembersByCell(members, dates);
  const breaches: ShiftBreach[] = [];

  for (const date of dates) {
    const hasData = (["M", "A", "N"] as ShiftCode[]).some((s) => (byCell.get(`${date}::${s}`) || []).length > 0);
    if (!hasData) continue;

    for (const shift of ["M", "A", "N"] as ShiftCode[]) {
      const cellMembers = byCell.get(`${date}::${shift}`) || [];

      GROUP_NUMS.forEach((g) => {
        const available = countMatching(cellMembers, RATING_GROUPS[g].categories);
        const required = requiredForGroup(g, shift);
        if (available < required) {
          breaches.push({ date, shift, key: `G${g}`, label: RATING_GROUPS[g].shortLabel, available, required, deficit: required - available });
        }
      });

      const occAvailable = countMatching(cellMembers, OCC_RATING_CATEGORIES);
      const occRequired = occRequiredFor(shift);
      if (occAvailable < occRequired) {
        breaches.push({ date, shift, key: "OCC", label: "OCC", available: occAvailable, required: occRequired, deficit: occRequired - occAvailable });
      }
    }
  }

  return breaches;
}

/**
 * Would pulling `member` off `sourceShift` drop any of their groups below the
 * shift minimum on the daily availability chart? Returns the offending cells.
 */
function sourceDepletionFailures(
  member: SummaryScheduleMember,
  sourceShifts: ShiftCode[],
  countFor: (shift: ShiftCode, group: GroupNum) => number,
): string[] {
  const fails: string[] = [];
  sourceShifts.forEach((sShift) => {
    GROUP_NUMS.forEach((g) => {
      const inGroup = RATING_GROUPS[g].categories.some((c) => matchesSummaryCategory(c, member));
      if (!inGroup) return;
      const current = countFor(sShift, g);
      const required = requiredForGroup(g, sShift);
      if (current - 1 < required) {
        fails.push(
          `Removing from ${shiftLabel(sShift)} drops ${RATING_GROUPS[g].shortLabel} below minimum (${current}→${current - 1}, need ${required})`,
        );
      }
    });
  });
  return fails;
}

export interface FindAvailabilityArgs {
  members: SummaryScheduleMember[];
  date: string;
  shift: ShiftCode;
  rating: RatingFilter;
  history?: Map<string, EmployeeHistory>;
}

function historyKey(code: string | null | undefined) {
  return String(code || "").trim().toUpperCase();
}

export function findAvailability({ members, date, shift, rating, history }: FindAvailabilityArgs): AvailabilityResult {
  const timelines = buildTimelines(members);

  // Coverage snapshot for the target date (for source-shift depletion checks).
  const cell = buildMembersByCell(members, [date]);
  const countFor = (s: ShiftCode, g: GroupNum) =>
    countUniqueMembers((cell.get(`${date}::${s}`) || []).filter((m) => RATING_GROUPS[g].categories.some((c) => matchesSummaryCategory(c, m))));

  const candidates: AvailabilityCandidate[] = [];
  const blocked: BlockedCandidate[] = [];
  const alreadyCovering: AlreadyCovering[] = [];
  let poolSize = 0;

  timelines.forEach((tl) => {
    if (!matchesRatingFilter(tl.member, rating)) return;
    poolSize += 1;

    const base = { employeeId: tl.employeeId, name: tl.name, team: tl.team, rating: tl.rating };
    const origin = originLabel(tl.dutyByDate.get(date));
    const hist = history?.get(historyKey(tl.employeeId)) ?? null;
    const ev = evaluateCandidate(tl, date, shift, { history: hist ?? undefined });

    if (ev.covering) {
      alreadyCovering.push(base);
      return;
    }
    if (ev.onLeave) {
      blocked.push({ ...base, originLabel: origin, blockReasons: ["On leave / unavailable that day"] });
      return;
    }
    if (ev.blocked) {
      blocked.push({ ...base, originLabel: origin, blockReasons: ev.blockingFailures.map((f) => f.reason) });
      return;
    }

    // Daily availability chart gate — only swaps deplete a source shift.
    const sourceShifts = classifyDuty(tl.dutyByDate.get(date)).shifts;
    if (ev.mode === "swap" && sourceShifts.length > 0 && isRuleEnabled("COVER.SOURCE", date)) {
      const fails = sourceDepletionFailures(tl.member, sourceShifts, countFor);
      if (fails.length > 0) {
        blocked.push({ ...base, originLabel: origin, blockReasons: fails });
        return;
      }
    }

    const reasons = ev.ledger.filter((e) => e.verdict === "satisfied" && e.points > 0).map((e) => e.reason);
    const warnings = ev.ledger.filter((e) => e.verdict === "violated" && !e.blocking).map((e) => e.reason);
    const priorityClass: PriorityClass = ev.clearOff ? 2 : ev.mode === "swap" ? 1 : 0;

    // Destination (and donor) manpower per rating group this controller belongs to.
    const donorShift = ev.mode === "swap" ? (sourceShifts[0] ?? null) : null;
    const memberGroups = GROUP_NUMS.filter((g) =>
      RATING_GROUPS[g].categories.some((c) => matchesSummaryCategory(c, tl.member)),
    );
    const coverage: CandidateCoverage[] = memberGroups.map((g) => ({
      groupKey: `G${g}`,
      label: RATING_GROUPS[g].shortLabel,
      targetShift: shift,
      targetAvailable: countFor(shift, g),
      targetRequired: requiredForGroup(g, shift),
      donorShift,
      donorAvailable: donorShift ? countFor(donorShift, g) : null,
      donorRequired: donorShift ? requiredForGroup(g, donorShift) : null,
    }));

    candidates.push({
      ...base,
      currentDutyCode: ev.currentDutyCode,
      originLabel: origin,
      originShift: sourceShifts[0] ?? null,
      mode: ev.mode,
      priorityClass,
      score: ev.score,
      fit: ev.fit,
      reasons,
      warnings,
      coverage,
      ledger: ev.ledger,
      history: hist,
    });
  });

  // Rank: priority class first (rest call-in → swap → clear-off), then score, then name.
  candidates.sort((a, b) => {
    if (a.priorityClass !== b.priorityClass) return a.priorityClass - b.priorityClass;
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });
  blocked.sort((a, b) => a.name.localeCompare(b.name));
  alreadyCovering.sort((a, b) => a.name.localeCompare(b.name));

  return {
    date,
    shift,
    ratingLabel: ratingFilterLabel(rating),
    candidates,
    blocked,
    alreadyCovering,
    ratingAvailability: computeRatingAvailability(members, date, shift),
    meta: { poolSize },
  };
}
