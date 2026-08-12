/**
 * OJT progress math — the canonical TypeScript implementation.
 *
 * Mirrored in SQL by public.v_ojt_progress. Any change here must be made there
 * too; ./__tests__/progress.test.ts fails if the two drift.
 *
 * Verified against all 132 rows of the source workbook. Two deliberate
 * departures from the spreadsheet, both because the spreadsheet is wrong:
 *
 *   1. Its "Hours left" column is formatted `h:mm` instead of `[h]:mm`, so it
 *      wraps at 24 hours — 90h displays as 18:00, 77.25h as 5:15. 54 of 132
 *      rows are affected. We never wrap.
 *   2. Its deadline uses EDATE, which truncates fractional months to zero. A
 *      10-hour cycle (0.667 months) gets a deadline one day *before* its start
 *      date. We add the fraction as days.
 */

import { addDays, addMonths, differenceInCalendarDays } from 'date-fns';
import type { OjtBand, OjtProgress, OjtProgressInput } from './types';

/** Required hours per month of allowed duration. 90h → 6 months. */
export const OJT_HOURS_PER_MONTH = 15;

/** Days used to expand the fractional part of a month. */
export const OJT_DAYS_PER_FRACTIONAL_MONTH = 30;

/** Upper bound of the healthy burn rate, in hours per day. Inclusive. */
export const OJT_ON_TRACK_MAX_RATIO = 0.4;

/** Upper bound of the acceptable burn rate, in hours per day. Inclusive. */
export const OJT_WATCH_MAX_RATIO = 1;

/** Below this many days left, a >1 h/day burn rate needs GM (ATM) escalation. */
export const OJT_GM_EXTENSION_DAYS = 15;

/* ─── Date helpers ────────────────────────────────────────────────────────── */

/**
 * Today in India time. The database mirror is public.ojt_today().
 *
 * Between 00:00 and 05:30 IST a UTC-based "today" is still yesterday, which
 * would shift days_left by one for every trainee in the country.
 */
export function ojtToday(now: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}

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

/* ─── Core math ───────────────────────────────────────────────────────────── */

export function requiredMonths(requiredHours: number | null | undefined): number | null {
    if (requiredHours === null || requiredHours === undefined || !Number.isFinite(requiredHours)) {
        return null;
    }
    return requiredHours / OJT_HOURS_PER_MONTH;
}

/**
 * `start + whole months + round(frac × 30) days − 1 day`.
 *
 * Month addition clamps to month end (31 Jul + 4 months → 30 Nov), matching
 * both Postgres interval arithmetic and the sheet's EDATE.
 */
export function computeDeadline(
    startDate: string | null | undefined,
    requiredHours: number | null | undefined,
): string | null {
    const start = parseIsoDate(startDate);
    const months = requiredMonths(requiredHours);
    if (!start || months === null) return null;

    const whole = Math.floor(months);
    const fractionDays = Math.round((months - whole) * OJT_DAYS_PER_FRACTIONAL_MONTH);

    return formatIsoDate(addDays(addMonths(start, whole), fractionDays - 1));
}

export function resolveBand(params: {
    startDate: string | null;
    requiredHours: number | null;
    hoursLeft: number | null;
    daysLeft: number | null;
    ratio: number | null;
    /** True when nothing has been logged against the cycle yet. */
    notStarted: boolean;
}): OjtBand {
    const { startDate, requiredHours, hoursLeft, daysLeft, ratio, notStarted } = params;

    // Ahead of every other rule, including DEADLINE_PASSED: a trainee who has
    // not logged an hour has not begun the cycle, so the deadline derived from
    // the sheet's nominal start date is not a clock that can run out on them.
    // Nothing is calculated from it and the GM (ATM) is never asked to extend.
    if (notStarted && requiredHours !== null && requiredHours > 0) return 'NOT_STARTED';

    if (!startDate || requiredHours === null || hoursLeft === null) return 'AWAITING_START_DATE';
    if (hoursLeft <= 0) return 'HOURS_COMPLETE';
    if (daysLeft === null) return 'AWAITING_START_DATE';
    if (daysLeft <= 0) return 'DEADLINE_PASSED';
    if (ratio === null) return 'AWAITING_START_DATE';
    if (ratio <= OJT_ON_TRACK_MAX_RATIO) return 'ON_TRACK';
    if (ratio <= OJT_WATCH_MAX_RATIO) return 'WATCH';
    return 'CRITICAL';
}

export function computeProgress(
    input: OjtProgressInput,
    today: string = ojtToday(),
): OjtProgress {
    const { requiredHours, requiredDays, performedHours, performedDays, startDate } = input;

    const months = requiredMonths(requiredHours);
    const deadline = input.deadlineOverride ?? computeDeadline(startDate, requiredHours);
    const notStarted = (performedHours ?? 0) === 0;

    const hoursLeft = requiredHours === null || requiredHours === undefined
        ? null
        : Math.max(0, requiredHours - (performedHours ?? 0));

    const deadlineDate = parseIsoDate(deadline);
    const todayDate = parseIsoDate(today);
    const daysLeft = deadlineDate && todayDate
        ? differenceInCalendarDays(deadlineDate, todayDate)
        : null;

    const ratio = daysLeft !== null && daysLeft > 0 && hoursLeft !== null
        ? hoursLeft / daysLeft
        : null;

    const band = resolveBand({
        startDate: startDate ?? null,
        requiredHours: requiredHours ?? null,
        hoursLeft,
        daysLeft,
        ratio,
        notStarted,
    });

    // A cycle that has not begun reports no derived figures at all. Suppressed
    // here rather than at each call site so no surface can quietly present a
    // countdown the band says is not running.
    const suppressed = band === 'NOT_STARTED';

    return {
        requiredMonths: months,
        deadline,
        hoursLeft: suppressed ? null : hoursLeft,
        daysLeft: suppressed ? null : daysLeft,
        ratio: suppressed ? null : ratio,
        band,
        notStarted,
        daysRequirementMet:
            performedDays !== null && performedDays !== undefined &&
            requiredDays !== null && requiredDays !== undefined &&
            performedDays >= requiredDays,
        requiresGmExtension:
            band === 'CRITICAL' && daysLeft !== null && daysLeft < OJT_GM_EXTENSION_DAYS,
    };
}

/* ─── Presentation ────────────────────────────────────────────────────────── */

export const OJT_BAND_LABELS: Record<OjtBand, string> = {
    NOT_STARTED: 'OJT Not Started',
    AWAITING_START_DATE: 'Awaiting Start Date',
    HOURS_COMPLETE: 'Hours Completed',
    DEADLINE_PASSED: 'Deadline Passed',
    ON_TRACK: 'On Track',
    WATCH: 'Watch',
    CRITICAL: 'Critical',
};

export function getOjtBandLabel(band: OjtBand | null | undefined): string {
    return band ? OJT_BAND_LABELS[band] : 'Awaiting Start Date';
}

/** Badge classes in the same shape as getTraineeStatusBadgeClass. */
export function getOjtBandClass(band: OjtBand | null | undefined): string {
    switch (band) {
        case 'HOURS_COMPLETE':
        case 'ON_TRACK':
            return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/60';
        case 'WATCH':
            return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-900/60';
        case 'CRITICAL':
            return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/60';
        case 'DEADLINE_PASSED':
            return 'bg-rose-200 text-rose-900 border-rose-300 dark:bg-rose-950/60 dark:text-rose-100 dark:border-rose-900';
        case 'NOT_STARTED':
        case 'AWAITING_START_DATE':
        default:
            return 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-900/70 dark:text-slate-200 dark:border-slate-700';
    }
}

/** Text colour for the large ratio figure on cards. */
export function getOjtRatioTextClass(band: OjtBand | null | undefined): string {
    switch (band) {
        case 'HOURS_COMPLETE':
        case 'ON_TRACK':
            return 'text-emerald-600 dark:text-emerald-400';
        case 'WATCH':
            return 'text-amber-600 dark:text-amber-400';
        case 'CRITICAL':
        case 'DEADLINE_PASSED':
            return 'text-rose-600 dark:text-rose-400';
        default:
            return 'text-slate-500 dark:text-slate-400';
    }
}

/**
 * Decimal hours → `HH:MM`, never wrapping at 24. 210.5 → "210:30".
 * This is the bug in the source sheet that this function exists to avoid.
 */
export function formatOjtHours(hours: number | null | undefined): string {
    if (hours === null || hours === undefined || !Number.isFinite(hours)) return '—';

    const sign = hours < 0 ? '-' : '';
    const absolute = Math.abs(hours);
    let whole = Math.floor(absolute);
    let minutes = Math.round((absolute - whole) * 60);

    if (minutes === 60) {
        whole += 1;
        minutes = 0;
    }

    return `${sign}${whole}:${String(minutes).padStart(2, '0')}`;
}

export type OjtHoursInput =
    | { kind: 'empty' }
    | { kind: 'value'; hours: number }
    | { kind: 'invalid' };

/**
 * Parse supervisor input for an hours field. Accepts `86:30`, `86:30:00` and
 * `86.5` — the sheet writes durations, but people type decimals too.
 * An empty string is meaningful: it clears the override back to the sheet.
 */
export function parseOjtHoursInput(value: string): OjtHoursInput {
    const trimmed = value.trim();
    if (!trimmed) return { kind: 'empty' };

    if (trimmed.includes(':')) {
        const parts = trimmed.split(':');
        if (parts.length < 2 || parts.length > 3) return { kind: 'invalid' };

        const nums = parts.map((part) => Number(part.trim()));
        if (nums.some((n) => !Number.isFinite(n) || n < 0)) return { kind: 'invalid' };
        if (nums.slice(1).some((n) => n >= 60)) return { kind: 'invalid' };

        const [h, m, s = 0] = nums;
        return { kind: 'value', hours: Math.round((h + m / 60 + s / 3600) * 100) / 100 };
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return { kind: 'invalid' };
    return { kind: 'value', hours: Math.round(parsed * 100) / 100 };
}

export type OjtDaysInput =
    | { kind: 'empty' }
    | { kind: 'value'; days: number }
    | { kind: 'invalid' };

export function parseOjtDaysInput(value: string): OjtDaysInput {
    const trimmed = value.trim();
    if (!trimmed) return { kind: 'empty' };

    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) return { kind: 'invalid' };
    return { kind: 'value', days: parsed };
}

export function formatOjtRatio(ratio: number | null | undefined): string {
    if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
    return ratio.toFixed(1);
}

export function formatDaysLeft(daysLeft: number | null | undefined): string {
    if (daysLeft === null || daysLeft === undefined) return '—';
    if (daysLeft === 0) return 'Due today';
    if (daysLeft > 0) return `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
    return `${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} overdue`;
}

/** Percentage of required hours completed, clamped to 0–100 for progress bars. */
export function getOjtCompletionPercent(
    requiredHours: number | null | undefined,
    performedHours: number | null | undefined,
): number {
    if (!requiredHours || requiredHours <= 0) return 0;
    return Math.max(0, Math.min(100, ((performedHours ?? 0) / requiredHours) * 100));
}

/**
 * The GM (ATM) escalation sentence. Shared so the supervisor and the employee
 * read exactly the same instruction.
 */
export function buildGmExtensionMessage(
    progress: Pick<OjtProgress, 'hoursLeft' | 'daysLeft' | 'ratio' | 'deadline'>,
    formatDate: (iso: string) => string,
): string {
    const deadline = progress.deadline ? formatDate(progress.deadline) : 'the deadline';
    return (
        `${formatOjtHours(progress.hoursLeft)} hours remaining with ` +
        `${progress.daysLeft} day${progress.daysLeft === 1 ? '' : 's'} to the deadline of ${deadline} ` +
        `(${formatOjtRatio(progress.ratio)} hrs/day required). ` +
        `Approach the GM (ATM) for additional hours before the deadline.`
    );
}
