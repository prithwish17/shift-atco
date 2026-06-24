/**
 * dutyConfig.ts — SINGLE SOURCE OF TRUTH for duty hours & cumulative limits.
 *
 * Used by both the Working Hours page and the compliance/availability engine,
 * so duty-hour values are defined in exactly one place. Edit values here.
 *
 * Shift model (confirmed): M 0700–1300 (6h), A 1300–1900 (6h),
 * N 1900–0700 next day (12h) — sums to a full 24h day. NO (Night-Off) is the
 * rest day given after a night and counts as 0 duty hours.
 */

/* ── Duty period limits (DGCA CAR §7.1.1 / §7.1.2) ───────────────────────── */
export const DUTY_PERIOD_LIMITS = {
  singleDuty: { hours: 12, label: "Maximum single duty period" },
  minGap: { hours: 12, label: "Minimum gap between duty periods" },
} as const;

/* ── Cumulative duty limits (DGCA CAR §7.1.1(b)) — 15-day intentionally absent ─ */
export const ATCO_LIMITS = {
  peak7: { hours: 48, label: "7-day", windowDays: 7 },
  peak30: { hours: 190, label: "30-day", windowDays: 30 },
} as const;

/* ── Consecutive duty days (DGCA CAR §7.1.3) ─────────────────────────────── */
export const CONSECUTIVE_LIMITS = {
  maxConsecutiveDays: 6,
  minRestAfterConsecutive: 48, // hours
} as const;

/* ── Duty code → hours ───────────────────────────────────────────────────
   M/A = 6h day shifts, N = 12h night duty (1900–0700). NO/CO/leave = 0h rest.
   Night-containing compounds = 12h (the night duty); night-off compounds = 0h. */
export const DUTY_HOURS_MAP: Record<string, number> = {
  M: 6, A: 6, N: 12, NO: 0,
  CO: 0, SL: 0, Tr: 0, T: 0, CH: 0, NH: 0, SAT: 0, SUN: 0, NA: 0, LEAVE: 0, L: 0,
  G: 8, GO: 8,
  "M+A": 12, "A+M": 12, "NO+N": 12,
  "CO+N": 12, "CO+A": 6, "CO+M": 6,
  "SAT+NO": 0, "SAT+N": 12,
  "SUN+N": 12, "SUN+M": 6, "SUN+A": 6, "SUN+NO": 0,
};

export function getDutyHours(code: string | null | undefined): number {
  if (!code) return 0;
  const t = code.trim();
  return DUTY_HOURS_MAP[t] ?? DUTY_HOURS_MAP[t.toUpperCase()] ?? 0;
}

/* ── Duty code → start time (IST, "HHmm") ────────────────────────────────── */
export const DUTY_START_TIMES: Record<string, string> = {
  M: "0700",
  A: "1300",
  N: "1900",
  NO: "1900",
  "M+A": "0700",
  "A+M": "0700",
  G: "0940",
  GO: "0940",
  "CO+N": "1900",
  "CO+A": "1300",
  "CO+M": "0700",
  "SAT+NO": "1900",
  "SAT+N": "1900",
  "SUN+N": "1900",
  "SUN+M": "0700",
  "SUN+A": "1300",
  "SUN+NO": "1900",
  "NO+N": "1900",
};

export function getDutyStartTime(code: string | null | undefined): string {
  if (!code) return "—";
  const t = code.trim();
  return DUTY_START_TIMES[t] ?? DUTY_START_TIMES[t.toUpperCase()] ?? "—";
}

/** Duty start time as minutes-from-midnight (for interval checks); null if unknown. */
export function getDutyStartMinutes(code: string | null | undefined): number | null {
  const hhmm = getDutyStartTime(code);
  if (hhmm === "—") return null;
  return parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(2), 10);
}

/** OPE (extra duty) codes — compound duties where an ATCO works beyond a normal shift. */
export const OPE_CODES: string[] = [
  "M+A", "A+M", "NO+N", "SAT+NO", "SAT+N",
  "SUN+N", "SUN+M", "SUN+A", "SUN+NO", "CO+N", "CO+A", "CO+M",
];

export function isOpeCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return OPE_CODES.includes(code.trim().toUpperCase());
}
