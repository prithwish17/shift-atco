/**
 * compliance/planValidator.ts
 * ---------------------------------------------------------------------------
 * Applies a candidate plan to a cloned timeline and re-runs the rules over the
 * affected window.
 *
 * Two design choices worth stating:
 *
 * 1. Recompute, don't reason incrementally. Working out which rules a mutation
 *    "could" affect is where compliance engines quietly go wrong. We re-evaluate a
 *    provably sufficient window instead, and derive that window from the rules'
 *    own declared `reach` so it cannot drift out of step with them.
 *
 * 2. Report what the plan INTRODUCES, not what it inherits. Rosters carry
 *    pre-existing breaches; blaming a candidate for one that was already there would
 *    block half the workforce for someone else's problem. We diff before against
 *    after and gate only on newly-introduced violations.
 */
import { addDays, format, parseISO } from "date-fns";

import { getDutyHours } from "@/lib/dutyConfig";
import { MAX_RULE_REACH, evaluateDay } from "./rules";
import type { EmployeeTimeline } from "./rosterState";
import type { LedgerEntry } from "./types";

export interface DutyMutation {
  employeeId: string;
  date: string;
  /** Duty code before the change — for display and for the undo path. */
  from: string | null;
  /** Duty code after the change. */
  to: string;
}

export interface PlanValidation {
  /** Violations this plan introduces that were not present beforehand. */
  introduced: LedgerEntry[];
  /** Violations already on the roster in the affected window, left as-is. */
  preExisting: LedgerEntry[];
  /** Rules the plan satisfies — the positive half of the explanation. */
  satisfied: LedgerEntry[];
  /** True when the plan introduces a violation of a blocking rule. */
  blocked: boolean;
  blockingFailures: LedgerEntry[];
  /** Non-blocking violations the plan introduces, e.g. the night-break's 36h rest. */
  warnings: LedgerEntry[];
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function cloneTimeline(tl: EmployeeTimeline): EmployeeTimeline {
  return { ...tl, dutyByDate: new Map(tl.dutyByDate), hoursByDate: new Map(tl.hoursByDate) };
}

/** A new timeline with the mutations applied. The input is never modified. */
export function applyMutations(tl: EmployeeTimeline, mutations: DutyMutation[]): EmployeeTimeline {
  const next = cloneTimeline(tl);
  for (const m of mutations) {
    next.dutyByDate.set(m.date, m.to);
    next.hoursByDate.set(m.date, getDutyHours(m.to));
  }
  return next;
}

/**
 * Days that must be re-evaluated for a set of mutations.
 *
 * Rules reach forward (a duty on D counts toward the trailing 7- and 30-day windows
 * ending as late as D+29) and backward (WDTL.CONSEC6 reports on the last day of a
 * run, so extending a run moves where the verdict lands). A symmetric radius of
 * MAX_RULE_REACH covers both without per-rule special-casing.
 */
export function affectedWindow(mutations: DutyMutation[]): { start: string; end: string; dates: string[] } {
  const dates = mutations.map((m) => m.date).sort();
  const first = parseISO(dates[0]);
  const last = parseISO(dates[dates.length - 1]);
  const start = addDays(first, -MAX_RULE_REACH);
  const end = addDays(last, MAX_RULE_REACH);

  const all: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) all.push(iso(cursor));
  return { start: iso(start), end: iso(end), dates: all };
}

/** Stable identity for a verdict so before/after can be diffed. */
const verdictKey = (date: string, e: LedgerEntry) => `${date}::${e.ruleId}`;

function violationsOver(tl: EmployeeTimeline, dates: string[]) {
  const found = new Map<string, LedgerEntry>();
  const satisfied: LedgerEntry[] = [];
  for (const date of dates) {
    for (const e of evaluateDay(tl, date)) {
      if (e.verdict === "violated") found.set(verdictKey(date, e), e);
      else if (e.verdict === "satisfied") satisfied.push(e);
    }
  }
  return { found, satisfied };
}

export function validatePlan(tl: EmployeeTimeline, mutations: DutyMutation[]): PlanValidation {
  const { dates } = affectedWindow(mutations);

  const before = violationsOver(tl, dates);
  const after = violationsOver(applyMutations(tl, mutations), dates);

  const introduced: LedgerEntry[] = [];
  const preExisting: LedgerEntry[] = [];
  for (const [key, entry] of after.found) {
    if (before.found.has(key)) preExisting.push(entry);
    else introduced.push(entry);
  }

  const blockingFailures = introduced.filter((e) => e.blocking);
  return {
    introduced,
    preExisting,
    satisfied: after.satisfied,
    blocked: blockingFailures.length > 0,
    blockingFailures,
    warnings: introduced.filter((e) => !e.blocking),
  };
}
