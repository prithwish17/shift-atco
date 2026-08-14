import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { CompOffHistoryEntry } from "@/utils/leaveCalculations";

export const MONTH_INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"] as const;

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const ISO_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/**
 * The leave register spells a date either as ISO or as "JUL 15 2026", and the
 * page used to format both to a display string before anything else saw them.
 * Bucketing by month needs the raw day back, so parse to ISO here and let the
 * view format at the last moment.
 */
export function toIsoLeaveDay(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(ISO_DAY_PATTERN);
  if (isoMatch) return isoMatch[0];

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;

  return format(parsed, "yyyy-MM-dd");
}

/**
 * ISO days out of the mixed arrays the register returns: casualLeave is a list
 * of date strings, restrictedHolidays and the comp-off ledger are objects whose
 * date lives under one of `fields`.  Rows flagged `hideDates` are placeholders
 * with no real date and are skipped, as they are everywhere else on the page.
 */
export function extractIsoLeaveDays(items: unknown[], fields: string[] = []): string[] {
  const days = new Set<string>();

  for (const item of items) {
    if (typeof item === "string") {
      const day = toIsoLeaveDay(item);
      if (day) days.add(day);
      continue;
    }

    if (!item || typeof item !== "object") continue;
    if ((item as { hideDates?: boolean }).hideDates) continue;

    for (const field of fields) {
      const day = toIsoLeaveDay((item as Record<string, unknown>)[field]);
      if (day) days.add(day);
    }
  }

  return [...days];
}

/** Every day in [from, to] inclusive. Earned Leave is stored as ranges, not days. */
export function expandIsoRange(from: unknown, to: unknown): string[] {
  const start = toIsoLeaveDay(from);
  const end = toIsoLeaveDay(to) ?? start;
  if (!start || !end) return [];

  const startDate = parseISO(start);
  const endDate = parseISO(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return [];

  const span = differenceInCalendarDays(endDate, startDate);
  if (span < 0) return [];

  // A single leave never runs a year; a bad pair that says otherwise would
  // otherwise expand into an unbounded list.
  if (span > 366) return [];

  return Array.from({ length: span + 1 }, (_, offset) => format(addDays(startDate, offset), "yyyy-MM-dd"));
}

/**
 * The days of `year` grouped into twelve months, index 0 = January.  Each month
 * holds its own sorted days so the strip can show a count and reveal the dates
 * behind it.
 */
export function bucketIsoDaysByMonth(isoDays: string[], year: number): string[][] {
  const months: string[][] = Array.from({ length: 12 }, () => []);
  const yearPrefix = `${year}-`;

  for (const day of isoDays) {
    if (!day.startsWith(yearPrefix)) continue;

    const monthIndex = Number(day.slice(5, 7)) - 1;
    if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) continue;

    months[monthIndex].push(day);
  }

  return months.map((days) => [...new Set(days)].sort());
}

/**
 * Comp-offs still available but close enough to their 89-day expiry to be worth
 * warning about, soonest first.  Nothing on the leave page used to surface this,
 * so a comp-off could lapse with no signal anywhere.
 */
export function getExpiringCompOffs(entries: CompOffHistoryEntry[], withinDays: number): CompOffHistoryEntry[] {
  return entries
    .filter((entry) =>
      entry.status === "available" &&
      entry.daysRemaining != null &&
      entry.daysRemaining >= 0 &&
      entry.daysRemaining <= withinDays,
    )
    .sort((left, right) => (left.daysRemaining ?? 0) - (right.daysRemaining ?? 0));
}

/** "12 Sep", the form the expiry rail reads best in. */
export function formatShortLeaveDay(isoDay: string | null): string | null {
  if (!isoDay) return null;

  const parsed = parseISO(isoDay);
  if (Number.isNaN(parsed.getTime())) return null;

  return format(parsed, "d MMM");
}

/**
 * Every day the strip covers, spelled out in order — "4 Mar", "11 May".  The
 * dates are printed under each row rather than hidden behind a tap, so they
 * have to come out sorted and readable rather than in register order.
 */
export function formatLeaveDayLabels(monthDays: string[][]): string[] {
  return monthDays
    .flat()
    .sort()
    .map((day) => formatShortLeaveDay(day) || day);
}

/**
 * A leave range as one label: "15–19 Jun", or "29 Jun – 2 Jul" when it crosses a
 * month.  Earned Leave is stored as ranges, and listing a fortnight day by day
 * would bury the row it belongs to.
 */
export function formatLeaveRangeLabel(from: unknown, to: unknown): string | null {
  const start = toIsoLeaveDay(from);
  const end = toIsoLeaveDay(to) ?? start;
  if (!start || !end) return null;

  const startDate = parseISO(start);
  const endDate = parseISO(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;

  if (start === end) return format(startDate, "d MMM");

  if (format(startDate, "yyyy-MM") === format(endDate, "yyyy-MM")) {
    return `${format(startDate, "d")}–${format(endDate, "d MMM")}`;
  }

  return `${format(startDate, "d MMM")} – ${format(endDate, "d MMM")}`;
}
