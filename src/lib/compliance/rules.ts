/**
 * compliance/rules.ts
 * ---------------------------------------------------------------------------
 * One implementation per rule, evaluated against a single employee-day.
 *
 * Both paths use these: candidate suitability (apply a plan's mutations to a cloned
 * timeline, then run the rules over the affected window) and audit breach scanning
 * (run the rules over an untouched timeline). Previously the night-rest logic was
 * written twice — in evaluateCandidate and again in detectScheduleBreaches — which is
 * how the two views drift apart.
 *
 * Every rule is pure: same timeline + date → same verdict.
 */
import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";

import { getDutyHours, getDutyStartMinutes } from "@/lib/dutyConfig";
import { parseDutyTokens } from "@/lib/teamDutyRotation";
import { activeExemption, effectiveParams, getRuleMeta, isRuleEnabled, ruleWeight } from "./registry";
import { classifyDuty, streakEndingOn, windowSumEnding, type EmployeeTimeline } from "./rosterState";
import type { LedgerEntry, Verdict } from "./types";

const EPOCH = "2000-01-01";
const MINUTES_PER_DAY = 1440;

/* ── Duty spans ───────────────────────────────────────────────────────────── */

/**
 * Absolute start/end of a duty in minutes, so a night duty crossing midnight is a
 * plain interval rather than a special case. Null when the day is not a working duty.
 */
export function dutySpan(date: string, code: string | null | undefined): { start: number; end: number } | null {
  const startMinutes = getDutyStartMinutes(code);
  const hours = getDutyHours(code);
  if (startMinutes === null || hours <= 0) return null;

  const dayIndex = differenceInCalendarDays(parseISO(date), parseISO(EPOCH));
  const start = dayIndex * MINUTES_PER_DAY + startMinutes;
  return { start, end: start + hours * 60 };
}

/** Spans of each component shift in a compound code, ordered by start. */
function componentSpans(date: string, code: string | null | undefined) {
  return parseDutyTokens(code)
    .map((token) => dutySpan(date, token))
    .filter((s): s is { start: number; end: number } => s !== null)
    .sort((a, b) => a.start - b.start);
}

/* ── Timeline helpers ─────────────────────────────────────────────────────── */

const shift = (n: number) => (date: string) => format(addDays(parseISO(date), n), "yyyy-MM-dd");
const prevDay = shift(-1);

function dutyOn(tl: EmployeeTimeline, date: string) {
  return tl.dutyByDate.get(date) ?? null;
}

function isWorking(tl: EmployeeTimeline, date: string) {
  return (tl.hoursByDate.get(date) ?? 0) > 0;
}

/** Consecutive night duties ending on (and including) `date`. */
function nightStreakEndingOn(tl: EmployeeTimeline, date: string): number {
  let count = 0;
  let cursor = date;
  while (classifyDuty(dutyOn(tl, cursor)).shifts.includes("N")) {
    count += 1;
    cursor = prevDay(cursor);
  }
  return count;
}

/** The most recent working day strictly before `date`, or null within `lookback` days. */
function previousWorkingDay(tl: EmployeeTimeline, date: string, lookback = 14): string | null {
  let cursor = prevDay(date);
  for (let i = 0; i < lookback; i++) {
    if (isWorking(tl, cursor)) return cursor;
    cursor = prevDay(cursor);
  }
  return null;
}

/* ── Rule definitions ─────────────────────────────────────────────────────── */

export interface DayContext {
  tl: EmployeeTimeline;
  date: string;
}

export interface RuleOutcome {
  verdict: Verdict;
  reason: string;
  observed?: string | number;
  threshold?: string | number;
}

export interface Rule {
  id: string;
  /**
   * How many days either side of a mutated date this rule can change verdict on.
   * planValidator derives its revalidation window from these, so the window can
   * never silently drift out of step with the rules it has to satisfy.
   */
  reach: number;
  /** Null when the rule does not apply to this employee-day. */
  evaluate(ctx: DayContext): RuleOutcome | null;
}

const dutyHoursOn = (tl: EmployeeTimeline, date: string) => tl.hoursByDate.get(date) ?? 0;

export const RULES_ORDERED: Rule[] = [
  {
    id: "WDTL.DUTY12",
    reach: 0,
    evaluate: ({ tl, date }) => {
      const hours = dutyHoursOn(tl, date);
      if (hours <= 0) return null;
      const limit = effectiveParams("WDTL.DUTY12", date).hours ?? 12;
      return hours > limit
        ? { verdict: "violated", reason: `${hours}h single duty period`, observed: hours, threshold: limit }
        : { verdict: "satisfied", reason: `${hours}h duty within the ${limit}h limit`, observed: hours, threshold: limit };
    },
  },

  {
    id: "WDTL.7D",
    // A duty on D counts toward every trailing 7-day window ending D … D+6.
    reach: 6,
    evaluate: ({ tl, date }) => {
      if (!isWorking(tl, date)) return null;
      const limit = effectiveParams("WDTL.7D", date).hours ?? 48;
      const total = windowSumEnding(tl.hoursByDate, date, 7);
      return total > limit
        ? { verdict: "violated", reason: `${total}h in the 7 days ending ${date}`, observed: total, threshold: limit }
        : { verdict: "satisfied", reason: `${total}h over 7 days, within ${limit}h`, observed: total, threshold: limit };
    },
  },

  {
    id: "WDTL.30D",
    reach: 29,
    evaluate: ({ tl, date }) => {
      if (!isWorking(tl, date)) return null;
      const limit = effectiveParams("WDTL.30D", date).hours ?? 190;
      const total = windowSumEnding(tl.hoursByDate, date, 30);
      return total > limit
        ? { verdict: "violated", reason: `${total}h in the 30 days ending ${date}`, observed: total, threshold: limit }
        : { verdict: "satisfied", reason: `${total}h over 30 days, within ${limit}h`, observed: total, threshold: limit };
    },
  },

  {
    id: "WDTL.NIGHT2",
    reach: 2,
    evaluate: ({ tl, date }) => {
      if (!classifyDuty(dutyOn(tl, date)).shifts.includes("N")) return null;
      const max = effectiveParams("WDTL.NIGHT2", date).max ?? 2;
      const streak = nightStreakEndingOn(tl, date);
      return streak > max
        ? { verdict: "violated", reason: `${streak} consecutive night duties`, observed: streak, threshold: max }
        : { verdict: "satisfied", reason: `Night ${streak} of a maximum ${max}`, observed: streak, threshold: max };
    },
  },

  {
    id: "WDTL.RESTN1",
    // §7.3.2(a): 48h rest after ONE night duty, owed to the next duty whenever it
    // falls — not only to one starting the very next day.
    reach: 3,
    evaluate: (ctx) => restAfterNights(ctx, "WDTL.RESTN1", 1, 48),
  },

  {
    id: "WDTL.RESTN2",
    // §7.3.2(b): 54h after two or more consecutive nights.
    reach: 4,
    evaluate: (ctx) => restAfterNights(ctx, "WDTL.RESTN2", 2, 54),
  },

  {
    id: "FATIGUE.2NDNIGHT",
    // §7.3.1 guidance: two consecutive nights are permitted but should be minimised
    // where practicable. Advisory only — WDTL.NIGHT2 owns the hard limit.
    reach: 1,
    evaluate: ({ tl, date }) => {
      const isNight = (d: string) => classifyDuty(dutyOn(tl, d)).shifts.includes("N");
      if (!isNight(date) || !isNight(prevDay(date))) return null;
      return {
        verdict: "violated",
        reason: "Second consecutive night duty — minimise where practicable",
        observed: 2,
      };
    },
  },

  {
    id: "WDTL.INTERVAL12",
    reach: 1,
    evaluate: ({ tl, date }) => {
      if (!isWorking(tl, date)) return null;
      const hours = effectiveParams("WDTL.INTERVAL12", date).hours ?? 12;
      const rest = restHoursBefore(tl, date);
      if (rest === null) return null;
      return rest < hours
        ? { verdict: "violated", reason: `Only ${rest}h since the previous duty`, observed: `${rest}h`, threshold: `${hours}h` }
        : { verdict: "satisfied", reason: `${rest}h since the previous duty`, observed: `${rest}h`, threshold: `${hours}h` };
    },
  },

  {
    id: "WDTL.CONSEC6",
    reach: 7,
    evaluate: ({ tl, date }) => {
      if (!isWorking(tl, date)) return null;
      // Only report on the last day of the run, so one long streak yields one breach.
      if (isWorking(tl, shift(1)(date))) return null;
      const max = effectiveParams("WDTL.CONSEC6", date).days ?? 6;
      const streak = streakEndingOn(tl.hoursByDate, date);
      return streak > max
        ? { verdict: "violated", reason: `${streak} consecutive duty days`, observed: streak, threshold: max }
        : { verdict: "satisfied", reason: `${streak} consecutive duty days, within ${max}`, observed: streak, threshold: max };
    },
  },

  {
    id: "WDTL.POSTSTREAK48",
    // §7.1.3(b): ≥48h between one block of consecutive duty days and the next.
    // This is what a night-break breaks — consuming the NO leaves only 36h.
    reach: 8,
    evaluate: ({ tl, date }) => {
      if (!isWorking(tl, date)) return null;
      if (isWorking(tl, prevDay(date))) return null; // not the first day of a block

      const hours = effectiveParams("WDTL.POSTSTREAK48", date).hours ?? 48;
      const rest = restHoursBefore(tl, date);
      if (rest === null) return null;
      return rest < hours
        ? { verdict: "violated", reason: `Only ${rest}h between duty blocks`, observed: `${rest}h`, threshold: `${hours}h` }
        : { verdict: "satisfied", reason: `${rest}h between duty blocks`, observed: `${rest}h`, threshold: `${hours}h` };
    },
  },

  {
    id: "OPS.ONEDUTY",
    reach: 0,
    evaluate: ({ tl, date }) => {
      const spans = componentSpans(date, dutyOn(tl, date));
      if (spans.length < 2) return null;

      // One duty PERIOD, not one shift code: M+A is a single contiguous 0700–1900
      // block and must pass. Only a genuine gap between components is a violation.
      const gap = spans.slice(1).reduce((worst, span, i) => Math.max(worst, span.start - spans[i].end), 0);
      return gap > 0
        ? { verdict: "violated", reason: `Split duty with a ${gap / 60}h gap on the same day`, observed: `${gap / 60}h gap` }
        : { verdict: "satisfied", reason: "Contiguous duty period" };
    },
  },
];

/**
 * Shared body of WDTL.RESTN1/RESTN2 — the rest owed once a block of night duties ends.
 *
 * Deliberately does NOT fire while the block is still running: two consecutive nights
 * are expressly permitted by §7.3.1(b), and the rest requirement attaches to the duty
 * that follows the block. WDTL.NIGHT2 governs the length of the block itself.
 */
function restAfterNights(
  { tl, date }: DayContext,
  ruleId: string,
  exactNights: number,
  fallbackHours: number,
): RuleOutcome | null {
  if (!isWorking(tl, date)) return null;

  // Skip only while a night block is genuinely CONTINUING — back-to-back nights are
  // permitted by §7.3.1(b) and their 12h turnaround must not be read as a rest
  // breach. A night after a gap day starts a new block and is owed the full rest.
  const isNight = (d: string) => classifyDuty(dutyOn(tl, d)).shifts.includes("N");
  if (isNight(date) && isNight(prevDay(date))) return null;

  const previous = previousWorkingDay(tl, date);
  if (!previous) return null;

  const nights = nightStreakEndingOn(tl, previous);
  // RESTN1 owns a single night; RESTN2 owns blocks of two or more.
  const applies = exactNights === 1 ? nights === 1 : nights >= 2;
  if (!applies) return null;

  const hours = effectiveParams(ruleId, date).hours ?? fallbackHours;
  const rest = restHoursBefore(tl, date);
  if (rest === null) return null;

  const noun = nights === 1 ? "a night duty" : `${nights} consecutive nights`;
  return rest < hours
    ? { verdict: "violated", reason: `${rest}h rest after ${noun}`, observed: `${rest}h`, threshold: `${hours}h` }
    : { verdict: "satisfied", reason: `${rest}h rest after ${noun}`, observed: `${rest}h`, threshold: `${hours}h` };
}

/**
 * Hours of rest between the end of the previous duty and the start of this one.
 * Null when there is no working duty on `date`, or no previous duty within lookback.
 */
function restHoursBefore(tl: EmployeeTimeline, date: string): number | null {
  const current = dutySpan(date, dutyOn(tl, date));
  if (!current) return null;

  const previous = previousWorkingDay(tl, date);
  if (!previous) return null;

  const prior = dutySpan(previous, dutyOn(tl, previous));
  if (!prior) return null;

  return Math.round(((current.start - prior.end) / 60) * 10) / 10;
}

export const RULE_BY_ID = new Map(RULES_ORDERED.map((r) => [r.id, r]));

/** Widest reach across all rules — the radius planValidator must revalidate. */
export const MAX_RULE_REACH = RULES_ORDERED.reduce((max, r) => Math.max(max, r.reach), 0);

/* ── Ledger construction ──────────────────────────────────────────────────── */

/**
 * Build a ledger entry, resolving tier/weight/refs from the governed registry.
 *
 * `asOf` decides whether a standing exemption is in force. An exempted rule keeps
 * its verdict and reason — so an exempted breach is still visible — but cannot block.
 */
export function toLedgerEntry(
  ruleId: string,
  outcome: RuleOutcome,
  pointsOverride?: number,
  asOf?: string,
): LedgerEntry {
  const meta = getRuleMeta(ruleId);
  const weight = ruleWeight(ruleId);
  const points =
    pointsOverride !== undefined
      ? pointsOverride
      : outcome.verdict === "satisfied"
        ? weight
        : outcome.verdict === "violated"
          ? -weight
          : 0;

  const exemption = activeExemption(ruleId, asOf);
  return {
    ruleId,
    title: meta?.title ?? ruleId,
    domain: meta?.domain ?? "schedule",
    tier: meta?.tier ?? "T0",
    blocking: exemption ? false : (meta?.blocking ?? false),
    verdict: outcome.verdict,
    points,
    reason: exemption ? `${outcome.reason} — ${exemption.note}` : outcome.reason,
    regulatoryRef: meta?.regulatoryRef,
    observed: outcome.observed,
    threshold: outcome.threshold,
    exemption: exemption ?? undefined,
  };
}

/** Run every enabled rule over one employee-day. */
export function evaluateDay(tl: EmployeeTimeline, date: string): LedgerEntry[] {
  const ledger: LedgerEntry[] = [];
  for (const rule of RULES_ORDERED) {
    if (!isRuleEnabled(rule.id, date)) continue;
    const outcome = rule.evaluate({ tl, date });
    if (outcome) ledger.push(toLedgerEntry(rule.id, outcome, undefined, date));
  }
  return ledger;
}
