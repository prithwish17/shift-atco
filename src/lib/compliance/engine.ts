/**
 * compliance/engine.ts
 * Pure, deterministic evaluation core. Produces an itemized ledger + signed
 * score for a candidate (suitability) and breach ledgers for the schedule,
 * working-hours and availability domains (audit).
 */
import { addDays, format, parseISO } from "date-fns";

import type { MonthlyAvailabilityReport } from "@/lib/supervisorAvailability";
import { getRuleMeta, ruleWeight, effectiveParams, isRuleEnabled } from "./registry";
import {
  classifyDuty,
  getDutyHours,
  isClearOff,
  maxConsecutiveStreak,
  rollingPeak,
  streakEndingOn,
  type EmployeeTimeline,
  type ShiftCode,
} from "./rosterState";
import type { LedgerEntry, ScoreResult, Verdict } from "./types";

// ---------------------------------------------------------------------------
// Ledger helpers
// ---------------------------------------------------------------------------

function entry(
  ruleId: string,
  verdict: Verdict,
  opts: { reason: string; observed?: string | number; threshold?: string | number; points?: number } = { reason: "" },
): LedgerEntry {
  const meta = getRuleMeta(ruleId);
  const w = ruleWeight(ruleId);
  const points = opts.points !== undefined
    ? opts.points
    : verdict === "satisfied" ? w : verdict === "violated" ? -w : 0;
  return {
    ruleId,
    title: meta?.title ?? ruleId,
    domain: meta?.domain ?? "schedule",
    tier: meta?.tier ?? "T0",
    blocking: meta?.blocking ?? false,
    verdict,
    points,
    reason: opts.reason,
    regulatoryRef: meta?.regulatoryRef,
    observed: opts.observed,
    threshold: opts.threshold,
  };
}

const SOFT_MIN = -60;
const SOFT_MAX = 80;
function clampFit(softScore: number) {
  const pct = ((softScore - SOFT_MIN) / (SOFT_MAX - SOFT_MIN)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function aggregate(ledger: LedgerEntry[]): ScoreResult {
  const blockingFailures = ledger.filter((e) => e.blocking && e.verdict === "violated");
  // Displayed/ranking score = soft band only (non-blocking tiers).
  const score = ledger.filter((e) => !e.blocking).reduce((s, e) => s + e.points, 0);
  return {
    score,
    fit: clampFit(score),
    blocked: blockingFailures.length > 0,
    blockingFailures,
    ledger,
  };
}

// ---------------------------------------------------------------------------
// Candidate evaluation (suitability for an exchange/assignment)
// ---------------------------------------------------------------------------

export interface EmployeeHistory {
  opeMonth: number;
  opeYear: number;
  exMonth: number;
  exYear: number;
}

export interface CandidateEvaluation extends ScoreResult {
  mode: "call-in" | "swap";
  currentDutyCode: string | null;
  covering: boolean;
  onLeave: boolean;
  clearOff: boolean;
  general: boolean;
}

const SHIFT_OF_DUTY = (code: string | null | undefined) => classifyDuty(code).shifts;

export function evaluateCandidate(
  tl: EmployeeTimeline,
  targetDate: string,
  shift: ShiftCode,
  opts: { history?: EmployeeHistory } = {},
): CandidateEvaluation {
  const dPrev = format(addDays(parseISO(targetDate), -1), "yyyy-MM-dd");
  const dPrev2 = format(addDays(parseISO(targetDate), -2), "yyyy-MM-dd");

  const today = classifyDuty(tl.dutyByDate.get(targetDate));
  const prev = classifyDuty(tl.dutyByDate.get(dPrev));
  const prev2 = classifyDuty(tl.dutyByDate.get(dPrev2));

  const covering = today.kind === "working" && today.shifts.includes(shift);
  const onLeave = today.kind === "leave";
  const mode: "call-in" | "swap" = today.kind === "working" ? "swap" : "call-in";
  const clearOff = isClearOff(tl.dutyByDate.get(targetDate));
  const general = Boolean(today.general);

  const ledger: LedgerEntry[] = [];
  // Honour governed overrides: a disabled rule contributes nothing (no gate, no score).
  const push = (e: LedgerEntry) => {
    if (isRuleEnabled(e.ruleId, targetDate)) ledger.push(e);
  };

  // ── Hard gates: night rest / consecutive nights ─────────────────────────
  if (shift === "M" || shift === "A") {
    if (prev.shifts.includes("N") && prev2.shifts.includes("N")) {
      push(entry("WDTL.RESTN2", "violated", { reason: "Day shift the day after two night duties — needs 54h rest", threshold: "54h" }));
    } else if (prev.shifts.includes("N")) {
      push(entry("WDTL.RESTN1", "violated", { reason: "Day shift the day after a night duty — needs 48h rest", threshold: "48h" }));
    } else {
      push(entry("WDTL.RESTN1", "satisfied", { reason: "Required rest after night respected" }));
    }
  }
  if (shift === "N") {
    if (prev.shifts.includes("N") && prev2.shifts.includes("N")) {
      push(entry("WDTL.NIGHT2", "violated", { reason: "Would be a 3rd consecutive night", observed: 3, threshold: 2 }));
    } else if (prev.shifts.includes("N")) {
      push(entry("WDTL.NIGHT2", "satisfied", { reason: "Within the 2 consecutive nights limit" }));
      push(entry("FATIGUE.2NDNIGHT", "violated", { reason: "This would be a 2nd consecutive night" }));
    } else {
      push(entry("WDTL.NIGHT2", "satisfied", { reason: "First night in the sequence" }));
    }
  }

  // ── Hard gates: cumulative caps (prospective) ───────────────────────────
  const projected = new Map(tl.hoursByDate);
  projected.set(targetDate, (projected.get(targetDate) ?? 0) + getDutyHours(shift));

  const limit7 = effectiveParams("WDTL.7D", targetDate).hours ?? 48;
  const peak7 = rollingPeak(projected, targetDate, targetDate, 7);
  if (peak7 > limit7) {
    push(entry("WDTL.7D", "violated", { reason: `7-day total would reach ${peak7}h`, observed: peak7, threshold: limit7 }));
  } else {
    push(entry("WDTL.7D", "satisfied", { reason: `7-day total ${peak7}h within limit`, observed: peak7, threshold: limit7 }));
  }

  const limit30 = effectiveParams("WDTL.30D", targetDate).hours ?? 190;
  const peak30 = rollingPeak(projected, targetDate, targetDate, 30);
  if (peak30 > limit30) {
    push(entry("WDTL.30D", "violated", { reason: `30-day total would reach ${peak30}h`, observed: peak30, threshold: limit30 }));
  }

  // ── Hard gate: consecutive duty days (prospective) ──────────────────────
  const maxConsec = effectiveParams("WDTL.CONSEC6", targetDate).days ?? 6;
  const newStreak = streakEndingOn(tl.hoursByDate, dPrev) + 1;
  if (newStreak > maxConsec) {
    push(entry("WDTL.CONSEC6", "violated", { reason: `Would be ${newStreak} consecutive duty days`, observed: newStreak, threshold: maxConsec }));
  }

  // ── Soft: fatigue / preferences ─────────────────────────────────────────
  if (prev.kind === "off" || prev.kind === "none") {
    push(entry("FATIGUE.PREVDAY", "satisfied", { reason: "Rested the previous day" }));
  } else if (prev.kind === "working") {
    push(entry("FATIGUE.PREVDAY", "violated", { reason: "Worked the previous day" }));
  }

  if (clearOff) {
    push(entry("PREF.CLEAROFF", "violated", { reason: "On clear-off — lowest priority to disturb" }));
  } else if (mode === "call-in") {
    push(entry("PREF.CALLIN", "satisfied", { reason: "Off/resting that day — no swap needed" }));
  } else {
    push(entry("PREF.CALLIN", "violated", { reason: `Currently on ${today.shifts.join("/")} — requires a swap` }));
  }

  // ── Best-fit source shift (directional): N←Night-off, M←Afternoon, A←Morning ──
  if (general) {
    push(entry("PREF.GENERAL", "satisfied", { reason: "General shift — flexible, fills any shift without depleting M/A/N" }));
    push(entry("PREF.SHIFT_FIT", "satisfied", { reason: `General can cover ${shift === "M" ? "Morning" : shift === "A" ? "Afternoon" : "Night"}` }));
  } else if (shift === "N") {
    if (mode === "call-in" && !clearOff) {
      push(entry("PREF.SHIFT_FIT", "satisfied", { reason: "Best fit: Night cover from Night-off/rest" }));
    } else if (today.shifts.includes("A")) {
      push(entry("PREF.SHIFT_FIT", "satisfied", { reason: "Secondary fit: Afternoon → Night" }));
    }
  } else if (shift === "M") {
    if (today.shifts.includes("A")) {
      push(entry("PREF.SHIFT_FIT", "satisfied", { reason: "Best fit: Afternoon → Morning" }));
    }
  } else if (shift === "A") {
    if (today.shifts.includes("M")) {
      push(entry("PREF.SHIFT_FIT", "satisfied", { reason: "Best fit: Morning → Afternoon" }));
    }
  }

  // ── Fairness / load-balancing: fewer prior exchanges & OPE rank higher ──
  const h = opts.history;
  if (h && (h.exYear > 0 || h.exMonth > 0)) {
    push(entry("PREF.FAIR_EXCHANGE", "violated", {
      points: -(h.exYear * 3 + h.exMonth * 5),
      reason: `${h.exYear} exchange(s) this year, ${h.exMonth} this month`,
    }));
  }
  if (h && (h.opeYear > 0 || h.opeMonth > 0)) {
    push(entry("PREF.FAIR_OPE", "violated", {
      points: -(h.opeYear * 2 + h.opeMonth * 4),
      reason: `${h.opeYear} OPE this year, ${h.opeMonth} this month`,
    }));
  }

  // Multi-rating flexibility.
  const breadth = tl.ratingSummary ? Object.values(tl.ratingSummary).filter(Boolean).length : 0;
  if (breadth > 1) {
    push(entry("PREF.MULTIRATING", "satisfied", { reason: `Multi-rated (${breadth} qualifications)` }));
  }

  return {
    ...aggregate(ledger),
    mode,
    currentDutyCode: tl.dutyByDate.get(targetDate) ?? null,
    covering,
    onLeave,
    clearOff,
    general,
  };
}

// ---------------------------------------------------------------------------
// Breach detection (audit) — schedule / working hours / availability
// ---------------------------------------------------------------------------

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

function breach(e: LedgerEntry, entity: BreachEntity): Breach {
  return { ...e, entity };
}

export function detectScheduleBreaches(
  timelines: Iterable<EmployeeTimeline>,
  dates: string[],
): Breach[] {
  const out: Breach[] = [];
  for (const tl of timelines) {
    for (const date of dates) {
      const today = classifyDuty(tl.dutyByDate.get(date));
      if (today.kind !== "working") continue;

      const prev = SHIFT_OF_DUTY(tl.dutyByDate.get(format(addDays(parseISO(date), -1), "yyyy-MM-dd")));
      const prev2 = SHIFT_OF_DUTY(tl.dutyByDate.get(format(addDays(parseISO(date), -2), "yyyy-MM-dd")));
      const ent: BreachEntity = { type: "employeeDay", id: tl.employeeId, name: tl.name, team: tl.team, date, shift: today.shifts.join("/") };

      const isDay = today.shifts.includes("M") || today.shifts.includes("A");
      if (isDay && prev.includes("N") && prev2.includes("N") && isRuleEnabled("WDTL.RESTN2", date)) {
        out.push(breach(entry("WDTL.RESTN2", "violated", { reason: "Day shift after two consecutive nights (needs 54h rest)", threshold: "54h" }), ent));
      } else if (isDay && prev.includes("N") && isRuleEnabled("WDTL.RESTN1", date)) {
        out.push(breach(entry("WDTL.RESTN1", "violated", { reason: "Day shift the day after a night duty (needs 48h rest)", threshold: "48h" }), ent));
      }

      if (today.shifts.includes("N") && isRuleEnabled("WDTL.NIGHT2", date)) {
        const maxNights = effectiveParams("WDTL.NIGHT2", date).max ?? 2;
        const nStreak = (() => {
          let c = 0;
          let cur = parseISO(date);
          while (classifyDuty(tl.dutyByDate.get(format(cur, "yyyy-MM-dd"))).shifts.includes("N")) {
            c += 1;
            cur = addDays(cur, -1);
          }
          return c;
        })();
        if (nStreak > maxNights) {
          out.push(breach(entry("WDTL.NIGHT2", "violated", { reason: `${nStreak} consecutive night duties`, observed: nStreak, threshold: maxNights }), ent));
        }
      }
    }
  }
  return out;
}

export function detectWorkingHoursBreaches(
  timelines: Iterable<EmployeeTimeline>,
  start: string,
  end: string,
): Breach[] {
  const out: Breach[] = [];
  const limit7 = effectiveParams("WDTL.7D", end).hours ?? 48;
  const limit30 = effectiveParams("WDTL.30D", end).hours ?? 190;
  const maxConsec = effectiveParams("WDTL.CONSEC6", end).days ?? 6;
  const dutyMax = effectiveParams("WDTL.DUTY12", end).hours ?? 12;
  const on7 = isRuleEnabled("WDTL.7D", end);
  const on30 = isRuleEnabled("WDTL.30D", end);
  const onConsec = isRuleEnabled("WDTL.CONSEC6", end);
  const onDuty = isRuleEnabled("WDTL.DUTY12", end);

  for (const tl of timelines) {
    const ent: BreachEntity = { type: "employee", id: tl.employeeId, name: tl.name, team: tl.team };

    const peak7 = rollingPeak(tl.hoursByDate, start, end, 7);
    if (on7 && peak7 > limit7) out.push(breach(entry("WDTL.7D", "violated", { reason: `Peak 7-day duty ${peak7}h`, observed: peak7, threshold: limit7 }), ent));

    const peak30 = rollingPeak(tl.hoursByDate, start, end, 30);
    if (on30 && peak30 > limit30) out.push(breach(entry("WDTL.30D", "violated", { reason: `Peak 30-day duty ${peak30}h`, observed: peak30, threshold: limit30 }), ent));

    const streak = maxConsecutiveStreak(tl.hoursByDate, start, end);
    if (onConsec && streak > maxConsec) out.push(breach(entry("WDTL.CONSEC6", "violated", { reason: `${streak} consecutive duty days`, observed: streak, threshold: maxConsec }), ent));

    if (onDuty) {
      for (const [date, hours] of tl.hoursByDate) {
        if (hours > dutyMax) out.push(breach(entry("WDTL.DUTY12", "violated", { reason: `${hours}h duty on ${date}`, observed: hours, threshold: dutyMax }), { ...ent, type: "employeeDay", date }));
      }
    }
  }
  return out;
}

export function detectAvailabilityBreaches(report: MonthlyAvailabilityReport): Breach[] {
  const out: Breach[] = [];
  report.rows.forEach((row) => {
    if (!isRuleEnabled("COVER.GROUPMIN", row.isoDate)) return;
    (["M", "A", "N"] as const).forEach((shiftCode) => {
      const section = row.shifts[shiftCode];
      section.groups.forEach((g) => {
        if (g.net < 0) {
          out.push(
            breach(
              entry("COVER.GROUPMIN", "violated", {
                reason: `${g.label} short by ${Math.abs(g.net)} (${g.available}/${g.required})`,
                observed: g.available,
                threshold: g.required,
              }),
              { type: "shiftCell", id: `${row.isoDate}:${shiftCode}:${g.group}`, date: row.isoDate, shift: shiftCode, group: g.label },
            ),
          );
        }
      });
    });
  });
  return out;
}

/** Sort worst-first (most negative points), then by tier severity. */
export function sortBreaches(breaches: Breach[]): Breach[] {
  return [...breaches].sort((a, b) => a.points - b.points);
}
