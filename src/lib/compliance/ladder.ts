/**
 * compliance/ladder.ts
 * ---------------------------------------------------------------------------
 * The preference ladder: which KIND of intervention to reach for, in what order.
 *
 * Ordering is lexicographic — rung, then fairness, then soft signals. Fairness can
 * never promote a candidate across a rung, and no accumulation of soft points can
 * outrank a better rung. That separation is deliberate: the previous engine summed
 * unbounded fairness penalties into the same band as ±10 preference nudges, so a
 * controller's exchange history silently decided which *strategy* won.
 *
 * Strategy preference within a rung is expressed as a fractional sub-rung (2.0 vs
 * 2.5) rather than an extra comparator step, keeping one ordering concept.
 */
import { addDays, format, parseISO } from "date-fns";

import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";
import {
  buildCoverageBase,
  cellKey,
  coverageShortfalls,
  groupsOf,
  mutationDelta,
  requiredFor,
  type CellKey,
  type CoverageShortfall,
} from "./coverage";
import { validatePlan, type DutyMutation } from "./planValidator";
import { classifyDuty, isClearOff, type EmployeeTimeline, type ShiftCode } from "./rosterState";
import { toLedgerEntry } from "./rules";
import type { LedgerEntry } from "./types";

/* ── Strategies ───────────────────────────────────────────────────────────── */

export type StrategyId =
  | "CALLIN_NIGHTOFF"
  | "SWAP_COUNTERPART"
  | "NIGHT_BREAK"
  | "EXTRA_DUTY"
  | "GENERAL"
  | "CALLIN_REST"
  | "CLEAR_OFF";

export const STRATEGY_LABEL: Record<StrategyId, string> = {
  CALLIN_NIGHTOFF: "Night-off call-in",
  SWAP_COUNTERPART: "Counterpart swap",
  NIGHT_BREAK: "Night-break",
  EXTRA_DUTY: "Extra duty (OPE)",
  GENERAL: "General reserve",
  CALLIN_REST: "Rest-day call-in",
  CLEAR_OFF: "Clear-off (last resort)",
};

/**
 * Rung per target shift. Lower is preferred.
 *
 * Night: Night-off → Afternoon → General, per the operational rule that General is a
 * day-working reserve and pulling one onto nights is the most disruptive of the three.
 * Morning/Afternoon: counterpart day shift → night-break → extra duty → General.
 * Clear-off sits below everything on every shift (compiled rules E2).
 */
export const LADDER: Record<ShiftCode, Partial<Record<StrategyId, number>>> = {
  N: { CALLIN_NIGHTOFF: 1, SWAP_COUNTERPART: 2, GENERAL: 3, CALLIN_REST: 4, CLEAR_OFF: 5 },
  M: { SWAP_COUNTERPART: 1, NIGHT_BREAK: 2, EXTRA_DUTY: 3, GENERAL: 4, CALLIN_REST: 5, CLEAR_OFF: 6 },
  A: { SWAP_COUNTERPART: 1, NIGHT_BREAK: 2, EXTRA_DUTY: 3, GENERAL: 4, CALLIN_REST: 5, CLEAR_OFF: 6 },
};

/** Penalty added to a night-break that only relieves the first of its two days. */
const SINGLE_DAY_BREAK_SUBRUNG = 0.5;

/** The day shift that conventionally donates to a target shift. */
const COUNTERPART: Record<ShiftCode, ShiftCode> = { M: "A", A: "M", N: "A" };

/** Duty code written when a rest day is called in to cover a shift. */
const CALLIN_CODE: Record<ShiftCode, string> = { M: "M", A: "A", N: "N" };
const CLEAROFF_CODE: Record<ShiftCode, string> = { M: "CO+M", A: "CO+A", N: "CO+N" };

/* ── Fairness ─────────────────────────────────────────────────────────────── */

export interface FairnessHistory {
  exchangesYear: number;
  exchangesMonth: number;
  opeYear: number;
  opeMonth: number;
  nightBreaksYear: number;
  nightBreaksMonth: number;
}

export const EMPTY_FAIRNESS: FairnessHistory = {
  exchangesYear: 0,
  exchangesMonth: 0,
  opeYear: 0,
  opeMonth: 0,
  nightBreaksYear: 0,
  nightBreaksMonth: 0,
};

/**
 * One imposition counter, weighted for recency. Exchanges, extra duties and
 * night-breaks all count the same by default: the ask is rotation, and per-kind
 * weights invented without data are how these systems rot. The seam exists — the
 * registry can override the multipliers — but the default stays 1.
 */
export function fairnessLoad(h: FairnessHistory, weights = { exchange: 1, ope: 1, nightBreak: 1 }): number {
  const year = h.exchangesYear * weights.exchange + h.opeYear * weights.ope + h.nightBreaksYear * weights.nightBreak;
  const month =
    h.exchangesMonth * weights.exchange + h.opeMonth * weights.ope + h.nightBreaksMonth * weights.nightBreak;
  return year + 2 * month;
}

function fairnessReason(h: FairnessHistory): string {
  const parts = [
    h.exchangesYear > 0 ? `${h.exchangesYear} exchange${h.exchangesYear === 1 ? "" : "s"}` : null,
    h.opeYear > 0 ? `${h.opeYear} OPE` : null,
    h.nightBreaksYear > 0 ? `${h.nightBreaksYear} night-break${h.nightBreaksYear === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return parts.length === 0 ? "No prior duty changes this year" : `${parts.join(", ")} this year`;
}

/* ── Option shape ─────────────────────────────────────────────────────────── */

export interface CoverOption {
  id: string;
  strategy: StrategyId;
  strategyLabel: string;
  /** Ladder position; lower is preferred. Fractional for within-strategy preference. */
  rung: number;
  rationale: string;
  employeeId: string;
  name: string;
  team: string | null;
  rating: string | null;
  currentDutyCode: string | null;
  mutations: DutyMutation[];
  ledger: LedgerEntry[];
  blocked: boolean;
  blockingFailures: LedgerEntry[];
  warnings: LedgerEntry[];
  coverageDelta: Map<CellKey, number>;
  shortfalls: CoverageShortfall[];
  fairnessLoad: number;
  softScore: number;
}

const iso = (date: string, offset: number) => format(addDays(parseISO(date), offset), "yyyy-MM-dd");

/* ── Mutation proposal ────────────────────────────────────────────────────── */

interface Proposal {
  strategy: StrategyId;
  mutations: DutyMutation[];
  /** Added to the base rung, e.g. a night-break relieving only one of its two days. */
  subRung?: number;
  note?: string;
}

export interface ProposalContext {
  /** Current head-count per (date, shift, group) — used to pick the night-break's second day. */
  base: Map<CellKey, number>;
  member: SummaryScheduleMember;
}

/**
 * Every way this controller could cover the target shift.
 *
 * One person can yield more than one option: someone on an Afternoon can either be
 * swapped onto the Morning (rung 1, costs the Afternoon a body) or given extra duty
 * as M+A (rung 3, costs no coverage at all). Those are genuinely different choices
 * and the supervisor should see both.
 */
export function proposeOptions(
  tl: EmployeeTimeline,
  targetDate: string,
  targetShift: ShiftCode,
  ctx: ProposalContext,
): Proposal[] {
  const employeeId = tl.employeeId;
  const current = tl.dutyByDate.get(targetDate) ?? null;
  const today = classifyDuty(current);
  const at = (date: string, to: string): DutyMutation => ({
    employeeId,
    date,
    from: tl.dutyByDate.get(date) ?? null,
    to,
  });

  // Already on the shift, on leave, or unrostered — nothing to propose.
  if (today.kind === "leave") return [];
  if (today.kind === "working" && today.shifts.includes(targetShift)) return [];

  const proposals: Proposal[] = [];

  if (today.general) {
    proposals.push({ strategy: "GENERAL", mutations: [at(targetDate, CALLIN_CODE[targetShift])] });
    return proposals;
  }

  if (today.kind === "working") {
    const counterpart = COUNTERPART[targetShift];

    if (today.shifts.includes(counterpart)) {
      // Straight swap onto the target shift.
      proposals.push({ strategy: "SWAP_COUNTERPART", mutations: [at(targetDate, CALLIN_CODE[targetShift])] });

      // …or keep them where they are and extend the duty across both day shifts.
      // Only M and A are contiguous; there is no legal Afternoon+Night compound.
      if (targetShift !== "N") {
        proposals.push({ strategy: "EXTRA_DUTY", mutations: [at(targetDate, "M+A")] });
      }
    }

    // Break a night to fill a day shift: work the night day and the night-off day,
    // leaving the clear-off intact. Requires a rest day on D+1 to consume.
    if (targetShift !== "N" && today.shifts.includes("N")) {
      const nextDay = iso(targetDate, 1);
      if (classifyDuty(tl.dutyByDate.get(nextDay)).kind === "off") {
        const secondShift = pickSecondDayShift(ctx, nextDay, targetShift);
        const relievesBothDays = secondShift.short;
        proposals.push({
          strategy: "NIGHT_BREAK",
          mutations: [at(targetDate, CALLIN_CODE[targetShift]), at(nextDay, secondShift.shift)],
          subRung: relievesBothDays ? 0 : SINGLE_DAY_BREAK_SUBRUNG,
          note: relievesBothDays
            ? `Relieves ${targetShift} on both days`
            : `Second duty on ${nextDay} is surplus to requirement`,
        });
      }
    }

    return proposals;
  }

  // Not working: a rest day. Clear-off is the last resort on every shift.
  if (isClearOff(current)) {
    proposals.push({ strategy: "CLEAR_OFF", mutations: [at(targetDate, CLEAROFF_CODE[targetShift])] });
    return proposals;
  }

  const onNightOff = (current ?? "").toUpperCase().includes("NO");
  if (targetShift === "N" && onNightOff) {
    proposals.push({ strategy: "CALLIN_NIGHTOFF", mutations: [at(targetDate, "NO+N")] });
    return proposals;
  }

  proposals.push({ strategy: "CALLIN_REST", mutations: [at(targetDate, CALLIN_CODE[targetShift])] });
  return proposals;
}

/**
 * Which day shift the second duty of a night-break should cover, and whether that
 * day actually needs the body. Prefers a shift where one of the controller's own
 * rating groups is short; otherwise mirrors the target shift and flags it surplus.
 */
function pickSecondDayShift(
  ctx: ProposalContext,
  date: string,
  targetShift: ShiftCode,
): { shift: ShiftCode; short: boolean } {
  const groups = groupsOf(ctx.member);
  const isShort = (shift: ShiftCode) =>
    groups.some((g) => (ctx.base.get(cellKey(date, shift, g)) ?? 0) < requiredFor(g, shift));

  if (isShort(targetShift)) return { shift: targetShift, short: true };
  const other: ShiftCode = targetShift === "M" ? "A" : "M";
  if (isShort(other)) return { shift: other, short: true };
  return { shift: targetShift, short: false };
}

/* ── Soft signals ─────────────────────────────────────────────────────────── */

/**
 * The only signals left in the score. Strategy preference now lives in the rung and
 * fairness in its own comparator step, so PREF.SHIFT_FIT / PREF.GENERAL / PREF.CALLIN
 * / PREF.CLEAROFF are gone — the rung says all of that, without the scrambling.
 */
function softSignals(
  tl: EmployeeTimeline,
  member: SummaryScheduleMember,
  targetDate: string,
  fairness: FairnessHistory,
  asOf: string,
): LedgerEntry[] {
  const ledger: LedgerEntry[] = [];

  // Office Order 251024/88 §2 — an exchange is only permissible with an ATCO
  // holding a similar rating. The rating groups are that equivalence class.
  const groups = groupsOf(member).filter((g) => g !== "OCC");
  ledger.push(
    toLedgerEntry("OPS.ELIG", {
      verdict: groups.length > 0 ? "satisfied" : "violated",
      reason:
        groups.length > 0
          ? `Rated ${tl.rating ?? "—"} (${groups.join(", ")})`
          : `Rating ${tl.rating ?? "—"} maps to no operational group`,
    }),
  );

  // Office Order 251024/88 §1 — an ATCO must be given the chance to decline a duty
  // change at least 7 days ahead; silence counts as acceptance. A change made
  // inside that window removes the objection right, so it is worth surfacing.
  const noticeDays = Math.round(
    (parseISO(targetDate).getTime() - parseISO(asOf).getTime()) / 86_400_000,
  );
  const requiredNotice = 7;
  if (noticeDays < requiredNotice) {
    ledger.push(
      toLedgerEntry("OPS.NOTICE7", {
        verdict: "violated",
        reason:
          noticeDays < 0
            ? "Duty date is in the past"
            : `Only ${noticeDays} day(s) notice — inside the 7-day window in which the ATCO may decline`,
        observed: `${noticeDays}d`,
        threshold: `${requiredNotice}d`,
      }),
    );
  }

  const previous = classifyDuty(tl.dutyByDate.get(iso(targetDate, -1)));
  ledger.push(
    toLedgerEntry("FATIGUE.PREVDAY", {
      verdict: previous.kind === "working" ? "violated" : "satisfied",
      reason: previous.kind === "working" ? "Worked the previous day" : "Rested the previous day",
    }),
  );

  const breadth = tl.ratingSummary ? Object.values(tl.ratingSummary).filter(Boolean).length : 0;
  if (breadth > 1) {
    ledger.push(
      toLedgerEntry("PREF.MULTIRATING", {
        verdict: "satisfied",
        reason: `Multi-rated (${breadth} qualifications)`,
      }),
    );
  }

  // Explainability only — fairness ranks through its own comparator step and must
  // not leak points into the score.
  ledger.push(toLedgerEntry("PREF.FAIRNESS", { verdict: "na", reason: fairnessReason(fairness) }, 0));

  return ledger;
}

/* ── Option construction & ranking ────────────────────────────────────────── */

export interface BuildOptionsArgs {
  timeline: EmployeeTimeline;
  member: SummaryScheduleMember;
  targetDate: string;
  targetShift: ShiftCode;
  base: Map<CellKey, number>;
  fairness?: FairnessHistory;
  /** Reference date for the 7-day objection window. Defaults to today. */
  asOf?: string;
}

export function buildOptions({
  timeline,
  member,
  targetDate,
  targetShift,
  base,
  fairness = EMPTY_FAIRNESS,
  asOf = new Date().toISOString().slice(0, 10),
}: BuildOptionsArgs): CoverOption[] {
  const proposals = proposeOptions(timeline, targetDate, targetShift, { base, member });

  return proposals.map((proposal) => {
    const validation = validatePlan(timeline, proposal.mutations);
    const delta = mutationDelta(member, proposal.mutations);
    const shortfalls = coverageShortfalls(base, delta);

    // Depleting a shift below its minimum is a hard operational stop. The OCC
    // sub-minimum has its own rule so the audit trail names the constraint that
    // actually failed rather than lumping it in with the parent group.
    const coverageFailures = shortfalls.map((s) =>
      toLedgerEntry(s.group === "OCC" ? "COVER.OCCMIN" : "COVER.SOURCE", {
        verdict: "violated",
        reason: `Removing them drops ${s.label} on the ${s.shift} of ${s.date} to ${s.after} (minimum ${s.required})`,
        observed: s.after,
        threshold: s.required,
      }),
    );

    const soft = softSignals(timeline, member, targetDate, fairness, asOf);
    const baseRung = LADDER[targetShift][proposal.strategy] ?? 99;

    return {
      id: `${timeline.employeeId}::${proposal.strategy}`,
      strategy: proposal.strategy,
      strategyLabel: STRATEGY_LABEL[proposal.strategy],
      rung: baseRung + (proposal.subRung ?? 0),
      rationale: proposal.note ?? STRATEGY_LABEL[proposal.strategy],
      employeeId: timeline.employeeId,
      name: timeline.name,
      team: timeline.team,
      rating: timeline.rating,
      currentDutyCode: timeline.dutyByDate.get(targetDate) ?? null,
      mutations: proposal.mutations,
      ledger: [...validation.introduced, ...validation.satisfied, ...coverageFailures, ...soft],
      blocked: validation.blocked || coverageFailures.length > 0,
      blockingFailures: [...validation.blockingFailures, ...coverageFailures],
      warnings: validation.warnings,
      coverageDelta: delta,
      shortfalls,
      fairnessLoad: fairnessLoad(fairness),
      softScore: soft.reduce((sum, e) => sum + e.points, 0),
    } satisfies CoverOption;
  });
}

/**
 * Lexicographic: rung, then fairness, then soft signals, then name for stability.
 * No step can be compensated by a later one.
 */
export function compareOptions(a: CoverOption, b: CoverOption): number {
  if (a.rung !== b.rung) return a.rung - b.rung;
  if (a.fairnessLoad !== b.fairnessLoad) return a.fairnessLoad - b.fairnessLoad;
  if (a.softScore !== b.softScore) return b.softScore - a.softScore;
  return a.name.localeCompare(b.name);
}

export function rankOptions(options: CoverOption[]): CoverOption[] {
  return [...options].sort(compareOptions);
}
