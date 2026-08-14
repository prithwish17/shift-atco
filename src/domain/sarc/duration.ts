/**
 * Duration parsing and formatting for SARC.
 *
 * The source data uses `[h]:mm:ss` — an elapsed-time format that runs past 24
 * hours, so `139:00:00` is a hundred and thirty-nine hours, not a wrapped
 * clock time. Everything here works in whole seconds.
 */

import type { Seconds } from './types';

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;

/** Half an hour — the granularity the charging rules move in. */
export const HALF_HOUR = SECONDS_PER_HOUR / 2;

/**
 * Parse `h:mm`, `h:mm:ss` or a bare hour count into seconds.
 *
 * Returns null for blank, `#N/A` and anything unparseable, so a dirty cell
 * surfaces as a warning rather than a silent zero.
 */
export function parseDuration(raw: string | number | null | undefined): Seconds | null {
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? Math.round(raw * SECONDS_PER_HOUR) : null;
    }

    const text = (raw ?? '').trim();
    if (!text || text.toUpperCase() === '#N/A') return null;

    const match = /^(-?)(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(text);
    if (!match) {
        const bare = Number(text);
        return Number.isFinite(bare) ? Math.round(bare * SECONDS_PER_HOUR) : null;
    }

    const [, sign, hours, minutes, seconds] = match;
    const total =
        Number(hours) * SECONDS_PER_HOUR +
        Number(minutes) * SECONDS_PER_MINUTE +
        Number(seconds ?? 0);
    return sign === '-' ? -total : total;
}

/** Format seconds as `[h]:mm`, the form the Annexure prints. */
export function formatDuration(seconds: Seconds | null | undefined): string {
    if (seconds == null) return '';
    const sign = seconds < 0 ? '-' : '';
    const abs = Math.abs(Math.round(seconds));
    const hours = Math.floor(abs / SECONDS_PER_HOUR);
    const minutes = Math.floor((abs % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    return `${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}

/** Format seconds as `[h]:mm:ss`, matching the IAMATC extract's own format. */
export function formatDurationWithSeconds(seconds: Seconds | null | undefined): string {
    if (seconds == null) return '';
    const sign = seconds < 0 ? '-' : '';
    const abs = Math.abs(Math.round(seconds));
    const hours = Math.floor(abs / SECONDS_PER_HOUR);
    const minutes = Math.floor((abs % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const secs = abs % SECONDS_PER_MINUTE;
    return `${sign}${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Whole hours as seconds. `hours(30)` → 108000. */
export function hours(value: number): Seconds {
    return Math.round(value * SECONDS_PER_HOUR);
}

/** Drop any part-minute. The IAMATC weighted total truncates rather than rounds. */
export function truncateToMinute(seconds: Seconds): Seconds {
    return seconds - (seconds % SECONDS_PER_MINUTE);
}

/** Round to the nearest half-hour — the rating pro-rate's `ROUND(x*2)/2`. */
export function roundToHalfHour(seconds: Seconds): Seconds {
    return Math.round(seconds / HALF_HOUR) * HALF_HOUR;
}
