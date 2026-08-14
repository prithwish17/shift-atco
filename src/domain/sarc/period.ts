/**
 * Period arithmetic for SARC.
 *
 * Every length here is derived from the period's own dates. The sheet
 * hardcoded a 28-day first month across five columns — a leftover from when it
 * was built for February–March, which silently discarded 29 and 30 June from
 * the reference period and would be wrong differently for every other period
 * (§2.1).
 */

import { differenceInCalendarDays, differenceInCalendarMonths } from 'date-fns';
import type { SarcPeriod } from './types';

/** Parse `YYYY-MM-DD` at local midnight, so no timezone can shift the day. */
export function parseIsoDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (!match) return null;

    const [, year, month, day] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatIsoDate(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function requireDate(value: string, label: string): Date {
    const parsed = parseIsoDate(value);
    if (!parsed) throw new Error(`SARC period ${label} is not a valid ISO date: ${value}`);
    return parsed;
}

/** Every date in the period, inclusive of both ends, in order. */
export function enumeratePeriodDates(period: SarcPeriod): string[] {
    const start = requireDate(period.start, 'start');
    const end = requireDate(period.end, 'end');
    if (end < start) {
        throw new Error(`SARC period ends before it starts: ${period.start} → ${period.end}`);
    }

    const dates: string[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        dates.push(formatIsoDate(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
}

/** Calendar days in the period, inclusive. 1 Jun – 31 Jul → 61. */
export function periodDays(period: SarcPeriod): number {
    return (
        differenceInCalendarDays(
            requireDate(period.end, 'end'),
            requireDate(period.start, 'start'),
        ) + 1
    );
}

/**
 * Calendar months the period spans, inclusive. 1 Jun – 31 Jul → 2.
 *
 * Drives the monthly-standard cap, which is expressed per month rather than
 * per day precisely so it survives a 59-, 61- or 62-day period unchanged.
 */
export function periodMonths(period: SarcPeriod): number {
    return (
        differenceInCalendarMonths(
            requireDate(period.end, 'end'),
            requireDate(period.start, 'start'),
        ) + 1
    );
}

/** Days from `from` to the period end, inclusive — the rating pro-rate's numerator. */
export function daysRemainingInPeriod(period: SarcPeriod, from: string): number {
    const fromDate = parseIsoDate(from);
    if (!fromDate) return 0;
    return differenceInCalendarDays(requireDate(period.end, 'end'), fromDate) + 1;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The Annexure heading, reproducing the sheet's own title formula:
 * `"…For The Period of " & TEXT(start,"mmmm") & "-" & TEXT(end,"mmmm yyyy")`.
 */
export function annexureTitle(period: SarcPeriod): string {
    const start = requireDate(period.start, 'start');
    const end = requireDate(period.end, 'end');
    const from = MONTH_NAMES[start.getMonth()];
    const to = `${MONTH_NAMES[end.getMonth()]} ${end.getFullYear()}`;
    return `Annexure- 2: Stress Allowance Recovery For The Period of ${from}-${to}`;
}
