/**
 * compliance/engine.ts
 * ---------------------------------------------------------------------------
 * Breach detection for the audit views.
 *
 * Candidate suitability no longer lives here — it moved to ladder.ts, which builds
 * whole duty plans rather than single-cell candidates. What remains is the audit
 * half, and it now runs the SAME rule implementations (rules.ts) that gate the
 * candidates. Previously the night-rest logic was written twice, so the finder and
 * the dashboard could disagree about the same roster.
 */
import { addDays, format, parseISO } from "date-fns";

import type { MonthlyAvailabilityReport } from "@/lib/supervisorAvailability";
import { isRuleEnabled } from "./registry";
import { evaluateDay, toLedgerEntry } from "./rules";
import type { EmployeeTimeline } from "./rosterState";
import type { LedgerEntry } from "./types";

export interface BreachEntity {
  type: "employeeDay" | "employee" | "shiftCell";
  id: string;
  name?: string;
  team?: string | null;
  date?: string;
  shift?: string;
  group?: string;
}

export interface Breach extends LedgerEntry {
  entity: BreachEntity;
}

function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const last = parseISO(end);
  for (let cursor = parseISO(start); cursor <= last; cursor = addDays(cursor, 1)) {
    out.push(format(cursor, "yyyy-MM-dd"));
  }
  return out;
}

/**
 * Every rule violation across the given timelines and window.
 *
 * Replaces the former detectScheduleBreaches / detectWorkingHoursBreaches split:
 * the rule registry already tags each rule with its domain, so callers filter on
 * that rather than on which function produced the row.
 */
export function detectBreaches(
  timelines: Iterable<EmployeeTimeline>,
  start: string,
  end: string,
): Breach[] {
  const dates = datesBetween(start, end);
  const out: Breach[] = [];

  for (const tl of timelines) {
    for (const date of dates) {
      for (const entry of evaluateDay(tl, date)) {
        if (entry.verdict !== "violated") continue;
        out.push({
          ...entry,
          entity: {
            type: "employeeDay",
            id: tl.employeeId,
            name: tl.name,
            team: tl.team,
            date,
            shift: tl.dutyByDate.get(date) ?? undefined,
          },
        });
      }
    }
  }
  return out;
}

/** Kept as thin wrappers so the dashboard's domain filters still line up. */
export function detectScheduleBreaches(timelines: Iterable<EmployeeTimeline>, dates: string[]): Breach[] {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  return detectBreaches(timelines, sorted[0], sorted[sorted.length - 1]).filter(
    (b) => b.domain === "schedule",
  );
}

export function detectWorkingHoursBreaches(
  timelines: Iterable<EmployeeTimeline>,
  start: string,
  end: string,
): Breach[] {
  return detectBreaches(timelines, start, end).filter((b) => b.domain === "workingHours");
}

/** Rating groups below their minimum, from the monthly availability report. */
export function detectAvailabilityBreaches(report: MonthlyAvailabilityReport): Breach[] {
  const out: Breach[] = [];

  report.rows.forEach((row) => {
    if (!isRuleEnabled("COVER.GROUPMIN", row.isoDate)) return;

    (["M", "A", "N"] as const).forEach((shiftCode) => {
      row.shifts[shiftCode].groups.forEach((g) => {
        if (g.net >= 0) return;
        out.push({
          ...toLedgerEntry("COVER.GROUPMIN", {
            verdict: "violated",
            reason: `${g.label} short by ${Math.abs(g.net)} (${g.available}/${g.required})`,
            observed: g.available,
            threshold: g.required,
          }),
          entity: {
            type: "shiftCell",
            id: `${row.isoDate}:${shiftCode}:${g.group}`,
            date: row.isoDate,
            shift: shiftCode,
            group: g.label,
          },
        });
      });
    });
  });

  return out;
}

/** Worst first: most negative points, which orders by severity tier. */
export function sortBreaches(breaches: Breach[]): Breach[] {
  return [...breaches].sort((a, b) => a.points - b.points);
}
