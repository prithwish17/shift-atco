/**
 * Roster fixtures for the compliance engine tests.
 *
 * Duties are generated from the REAL rotation helper (`getTeamDutyForDateKey`) rather
 * than hand-written tables, so a change to the production cycle surfaces here instead
 * of leaving the fixtures silently describing a roster the app no longer produces.
 *
 * The cycle is M → A → N → NO → CO (see teamDutyRotation.ts). Relative to the anchor
 * 2026-03-09: team A starts on N, B on A, C on M, D on CO, E on NO.
 */
import { addDays, format, parseISO } from "date-fns";

import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";
import { getTeamDutyForDateKey } from "@/lib/teamDutyRotation";

/** Rotation anchor — team C starts its cycle on M here, so C's first N is +2. */
export const ANCHOR = "2026-03-09";

/** ISO date `offset` days from `base`. */
export function day(base: string, offset: number): string {
  return format(addDays(parseISO(base), offset), "yyyy-MM-dd");
}

export interface PersonSpec {
  id: string;
  name?: string;
  /** Rotation team key: A–E (or G for General). */
  team?: string;
  rating?: string;
  designation?: string;
  gender?: string;
  ratingSummary?: Record<string, unknown> | null;
}

function row(person: PersonSpec, duty_date: string, duty_code: string | null): SummaryScheduleMember {
  return {
    employee_id: person.id,
    employee_name: person.name ?? person.id,
    duty_date,
    current_shift: person.team ?? null,
    designation: person.designation ?? "ATCO",
    gender: person.gender ?? "M",
    highest_rating: person.rating ?? "RSR",
    rating_summary: person.ratingSummary ?? null,
    instructor_validity: null,
    ojti: null,
    duty_code,
    duty_description: duty_code,
  };
}

/**
 * Explicit duty sequence, e.g. `"M A N NO CO"` starting at `from`.
 * Use `-` to emit no row at all for that day (an unrostered gap).
 */
export function scheduleOf(person: PersonSpec, from: string, duties: string): SummaryScheduleMember[] {
  return duties
    .trim()
    .split(/\s+/)
    .map((code, i) => (code === "-" ? null : row(person, day(from, i), code)))
    .filter((r): r is SummaryScheduleMember => r !== null);
}

/** `days` of duty generated from the person's real team rotation, starting at `from`. */
export function rotationOf(person: PersonSpec, from: string, days: number): SummaryScheduleMember[] {
  return Array.from({ length: days }, (_, i) => {
    const date = day(from, i);
    return row(person, date, getTeamDutyForDateKey(person.team ?? "C", date));
  });
}

export interface CohortSpec extends Omit<PersonSpec, "id"> {
  /** How many identical people to generate. */
  count: number;
  /** Employee-id prefix; ids become `${prefix}1`, `${prefix}2`, … */
  prefix: string;
}

/**
 * `count` interchangeable controllers on the same team and rating, each following the
 * real rotation. Used to build realistic head-counts for the coverage minimums
 * (G1 12/16, G2 4/4, G3 14/16, G4 9/9, G5 11/10 — see GROUP_SHIFT_MINIMUMS).
 */
export function cohort(spec: CohortSpec, from: string, days: number): SummaryScheduleMember[] {
  return Array.from({ length: spec.count }, (_, i) =>
    rotationOf({ ...spec, id: `${spec.prefix}${i + 1}` }, from, days),
  ).flat();
}

/** Override a single person's duty on one date (last row wins in buildTimelines). */
export function override(
  members: SummaryScheduleMember[],
  employeeId: string,
  date: string,
  dutyCode: string | null,
): SummaryScheduleMember[] {
  return members.map((m) =>
    m.employee_id === employeeId && m.duty_date === date
      ? { ...m, duty_code: dutyCode, duty_description: dutyCode }
      : m,
  );
}
