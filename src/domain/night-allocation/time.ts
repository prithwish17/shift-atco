/**
 * Night Channel Allocation — the one place minutes-from-13:30 become clock
 * times. Nothing else in the module formats a time.
 */
import { NIGHT_SPAN_MIN, NIGHT_START_MIN, SLOT_MIN } from "./constants.js";

const pad = (value: number) => String(value).padStart(2, "0");

/** `0` → "13:30", `630` → "00:00", `720` → "01:30". */
export function formatMinutes(min: number): string {
  const clock = ((NIGHT_START_MIN + min) % 1440 + 1440) % 1440;
  return `${pad(Math.floor(clock / 60))}:${pad(clock % 60)}`;
}

/** Same as `formatMinutes` without the colon — the WhatsApp roster uses it. */
export function formatMinutesCompact(min: number): string {
  return formatMinutes(min).replace(":", "");
}

/** True once the clock has passed midnight, i.e. the time is the next date. */
export function isNextDay(min: number): boolean {
  return NIGHT_START_MIN + min >= 1440;
}

/** "18:30 (+1)" style label for pickers, marking times after midnight. */
export function formatPickerLabel(min: number): string {
  return `${formatMinutes(min)}${isNextDay(min) ? " (+1)" : ""}`;
}

/** "13:30–14:45" for a duty or a window. */
export function formatRange(startMin: number, endMin: number): string {
  return `${formatMinutes(startMin)}–${formatMinutes(endMin)}`;
}

/** `105` → "1h 45m". Whole hours drop the minutes, `0` reads as "0m". */
export function formatDuration(min: number): string {
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

/** Every grid time in `[from, to]`, for a select. */
export function slotRange(from: number, to: number, step: number = SLOT_MIN): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += step) out.push(m);
  return out;
}

/** Round a pixel-derived minute onto the grid and inside the night. */
export function snapToSlot(min: number): number {
  const snapped = Math.round(min / SLOT_MIN) * SLOT_MIN;
  return Math.max(0, Math.min(NIGHT_SPAN_MIN, snapped));
}

/** A real calendar date written `YYYY-MM-DD` — not merely the right shape. */
export function isNightDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * The night a local moment belongs to, as its `YYYY-MM-DD` key.
 *
 * A night runs from 13:30 on its own date to 01:30 the next, so until 01:30 the
 * night in progress is the previous date's. Taking the calendar date instead
 * opened tomorrow's night for everyone still on shift after midnight.
 */
export function nightDateAt(moment: Date): string {
  const minuteOfDay = moment.getHours() * 60 + moment.getMinutes();
  const nightEnds = NIGHT_START_MIN + NIGHT_SPAN_MIN - 1440;
  const day = new Date(
    moment.getFullYear(),
    moment.getMonth(),
    moment.getDate() - (minuteOfDay < nightEnds ? 1 : 0),
  );
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/**
 * The calendar date a minute offset falls on, given the night's start date.
 * Used by the exports, which show real dates rather than a `+1` marker.
 */
export function dateOfMinute(nightDate: string, min: number): string {
  if (!isNextDay(min)) return nightDate;
  const [year, month, day] = nightDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}
