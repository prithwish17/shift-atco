/**
 * compliance/rosterState.ts
 * Normalizes raw schedule rows into a per-employee duty timeline plus the
 * duty-hour model and rolling-window helpers the engine needs. Pure, no I/O.
 */
import { addDays, format, parseISO } from "date-fns";

import type { SummaryScheduleMember } from "@/lib/supervisorAvailability";
import { parseDutyTokens } from "@/lib/teamDutyRotation";
import { getDutyHours, getDutyStartMinutes } from "@/lib/dutyConfig";

// Re-export from the single source of truth so existing imports keep working.
export { getDutyHours, getDutyStartMinutes } from "@/lib/dutyConfig";

export type ShiftCode = "M" | "A" | "N";

const WORKING_TOKENS = new Set<ShiftCode>(["M", "A", "N"]);
const OFF_TOKENS = new Set(["NO", "CO", "SAT", "SUN", "WO", "RD"]);
const LEAVE_TOKENS = new Set([
  "SL", "EL", "CL", "ML", "PL", "HPL", "CCL", "GO", "TR", "TRG", "OD",
  "CH", "NH", "NA", "HO", "LWP", "QL", "SPL",
]);

export type DutyKind = "working" | "off" | "leave" | "none";

export interface DutyClass {
  kind: DutyKind;
  shifts: ShiftCode[];
  /** General shift (G/GO): a flexible day duty that can cover M/A/N. */
  general?: boolean;
}

const GENERAL_TOKENS = new Set(["G", "GO"]);

/** True when the day is a Clear-Off rest day (CO) with no working shift. */
export function isClearOff(dutyCode: string | null | undefined): boolean {
  const tokens = parseDutyTokens(dutyCode);
  if (tokens.length === 0) return false;
  if (tokens.some((t) => WORKING_TOKENS.has(t as ShiftCode))) return false;
  return tokens.includes("CO");
}

/** Human label for where a candidate is coming from on the target day. */
export function originLabel(dutyCode: string | null | undefined): string {
  const c = classifyDuty(dutyCode);
  if (c.general) return "General";
  if (c.kind === "working") {
    return c.shifts
      .map((s) => (s === "M" ? "Morning" : s === "A" ? "Afternoon" : "Night"))
      .join("/");
  }
  if (isClearOff(dutyCode)) return "Clear-off";
  const tokens = parseDutyTokens(dutyCode);
  if (tokens.includes("NO")) return "Night-off";
  if (c.kind === "off") return "Rest day";
  if (c.kind === "leave") return "Leave";
  return "Unrostered";
}

export function classifyDuty(dutyCode: string | null | undefined): DutyClass {
  const tokens = parseDutyTokens(dutyCode);
  if (tokens.length === 0) return { kind: "none", shifts: [] };

  const shifts = tokens.filter((t): t is ShiftCode => WORKING_TOKENS.has(t as ShiftCode));
  if (shifts.length > 0) return { kind: "working", shifts };

  // General shift (G/GO): flexible working duty, no specific M/A/N slot.
  if (tokens.some((t) => GENERAL_TOKENS.has(t))) return { kind: "working", shifts: [], general: true };

  if (tokens.some((t) => LEAVE_TOKENS.has(t))) return { kind: "leave", shifts: [] };
  if (tokens.every((t) => OFF_TOKENS.has(t))) return { kind: "off", shifts: [] };

  return { kind: "leave", shifts: [] }; // unknown → conservative (unavailable)
}

export interface EmployeeTimeline {
  employeeId: string;
  name: string;
  team: string | null;
  rating: string | null;
  ratingSummary: Record<string, unknown> | null;
  member: SummaryScheduleMember;
  /** date(yyyy-MM-dd) → raw duty code */
  dutyByDate: Map<string, string | null>;
  /** date → duty hours */
  hoursByDate: Map<string, number>;
}

function memberKey(m: Pick<SummaryScheduleMember, "employee_id" | "employee_name">) {
  return String(m.employee_id || m.employee_name || "").trim().toUpperCase();
}

export function buildTimelines(members: SummaryScheduleMember[]): Map<string, EmployeeTimeline> {
  const timelines = new Map<string, EmployeeTimeline>();

  members.forEach((member) => {
    const key = memberKey(member);
    if (!key) return;

    let tl = timelines.get(key);
    if (!tl) {
      tl = {
        employeeId: member.employee_id,
        name: String(member.employee_name || member.employee_id || "").trim(),
        team: member.current_shift || null,
        rating: member.highest_rating || null,
        ratingSummary: member.rating_summary || null,
        member,
        dutyByDate: new Map(),
        hoursByDate: new Map(),
      };
      timelines.set(key, tl);
    }

    if (member.duty_date) {
      tl.dutyByDate.set(member.duty_date, member.duty_code ?? null);
      const prior = tl.hoursByDate.get(member.duty_date) ?? 0;
      tl.hoursByDate.set(member.duty_date, prior + getDutyHours(member.duty_code));
    }
  });

  return timelines;
}

/** Max sum over any contiguous `windowDays` window covering [start,end]. */
export function rollingPeak(
  hoursByDate: Map<string, number>,
  start: string,
  end: string,
  windowDays: number,
): number {
  let max = 0;
  let cursor = addDays(parseISO(start), -(windowDays - 1));
  const last = parseISO(end);
  while (cursor <= last) {
    let sum = 0;
    for (let d = 0; d < windowDays; d++) {
      sum += hoursByDate.get(format(addDays(cursor, d), "yyyy-MM-dd")) ?? 0;
    }
    if (sum > max) max = sum;
    cursor = addDays(cursor, 1);
  }
  return max;
}

/** Window sum for a fixed `windowDays` window that ENDS on `endDate`. */
export function windowSumEnding(
  hoursByDate: Map<string, number>,
  endDate: string,
  windowDays: number,
): number {
  let sum = 0;
  for (let d = 0; d < windowDays; d++) {
    sum += hoursByDate.get(format(addDays(parseISO(endDate), -d), "yyyy-MM-dd")) ?? 0;
  }
  return sum;
}

/** Longest run of consecutive working days within [start,end]. */
export function maxConsecutiveStreak(
  hoursByDate: Map<string, number>,
  start: string,
  end: string,
): number {
  let max = 0;
  let cur = 0;
  let cursor = parseISO(start);
  const last = parseISO(end);
  while (cursor <= last) {
    const h = hoursByDate.get(format(cursor, "yyyy-MM-dd")) ?? 0;
    if (h > 0) {
      cur += 1;
      if (cur > max) max = cur;
    } else {
      cur = 0;
    }
    cursor = addDays(cursor, 1);
  }
  return max;
}

/** Consecutive working days ending ON (and including) `date`. */
export function streakEndingOn(hoursByDate: Map<string, number>, date: string): number {
  let count = 0;
  let cursor = parseISO(date);
  while ((hoursByDate.get(format(cursor, "yyyy-MM-dd")) ?? 0) > 0) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}
