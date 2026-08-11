import { describe, expect, it } from 'vitest';

import {
    OJT_FIXTURES,
    FIXTURE_TODAY,
    FRACTIONAL_MONTH_EXCEPTION,
} from './fixtures';
import {
    computeDeadline,
    computeProgress,
    formatOjtHours,
    formatDaysLeft,
    getOjtCompletionPercent,
    ojtToday,
    parseOjtDaysInput,
    parseOjtHoursInput,
    requiredMonths,
    resolveBand,
} from '../progress';
import type { OjtBand } from '../types';

const isException = (row: { empId: string; unit: string }) =>
    row.empId === FRACTIONAL_MONTH_EXCEPTION.empId && row.unit === FRACTIONAL_MONTH_EXCEPTION.unit;

const run = (row: (typeof OJT_FIXTURES)[number]) => computeProgress(row.input, FIXTURE_TODAY);

describe('OJT engine vs. the live spreadsheet', () => {
    it('covers the whole workbook', () => {
        expect(OJT_FIXTURES).toHaveLength(132);
    });

    it('reproduces every deadline the sheet computes', () => {
        const mismatches = OJT_FIXTURES
            .filter((row) => !isException(row))
            .filter((row) => run(row).deadline !== row.sheetDeadline)
            .map((row) => `${row.name} (${row.unit}): got ${run(row).deadline}, sheet ${row.sheetDeadline}`);

        expect(mismatches).toEqual([]);
    });

    it('reproduces every days-left the sheet computes', () => {
        const mismatches = OJT_FIXTURES
            .filter((row) => !isException(row))
            .filter((row) => run(row).daysLeft !== row.sheetDaysLeft)
            .map((row) => `${row.name} (${row.unit}): got ${run(row).daysLeft}, sheet ${row.sheetDaysLeft}`);

        expect(mismatches).toEqual([]);
    });

    it('fixes the sheet deadline that lands before its own start date', () => {
        const row = OJT_FIXTURES.find(isException);
        expect(row).toBeDefined();

        // The sheet truncates 0.667 months to zero and returns 2026-06-16 for an
        // OJT starting 2026-06-17.
        expect(row!.input.startDate).toBe('2026-06-17');
        expect(row!.sheetDeadline).toBe('2026-06-16');
        expect(run(row!).deadline).toBe('2026-07-06');
    });
});

describe('hours left', () => {
    it('is required minus performed, floored at zero', () => {
        for (const row of OJT_FIXTURES) {
            const expected = Math.max(0, row.input.requiredHours - row.input.performedHours);
            expect(run(row).hoursLeft).toBeCloseTo(expected, 2);
        }
    });

    it('does not reproduce the sheet 24-hour display wrap', () => {
        // 54 of 132 rows are affected. If this count moves, the sheet's cell
        // formatting changed and the rollout note in the plan needs revisiting.
        const wrapped = OJT_FIXTURES.filter((row) => {
            const ours = run(row).hoursLeft ?? 0;
            return Math.abs(ours - row.sheetHoursLeftDisplay) > 0.01;
        });

        expect(wrapped).toHaveLength(54);

        // Every one of them is explained by modulo 24, not by an arithmetic bug.
        for (const row of wrapped) {
            const ours = run(row).hoursLeft ?? 0;
            expect(ours % 24).toBeCloseTo(row.sheetHoursLeftDisplay, 2);
        }
    });
});

describe('banding', () => {
    it('matches the verified distribution across the cohort', () => {
        const counts = OJT_FIXTURES.reduce<Record<string, number>>((acc, row) => {
            const { band } = run(row);
            acc[band] = (acc[band] || 0) + 1;
            return acc;
        }, {});

        expect(counts).toEqual({
            HOURS_COMPLETE: 43,
            ON_TRACK: 16,
            WATCH: 47,
            CRITICAL: 16,
            DEADLINE_PASSED: 10,
        });
    });

    it('never calls an overdue trainee on track', () => {
        // The trap: days_left is negative, so hours_left / days_left is negative
        // and would satisfy `ratio <= 0.4`.
        const overdue = OJT_FIXTURES.filter((row) => {
            const progress = run(row);
            return progress.daysLeft !== null && progress.daysLeft < 0 && (progress.hoursLeft ?? 0) > 0;
        });

        expect(overdue.length).toBeGreaterThan(0);
        for (const row of overdue) {
            const progress = run(row);
            expect(progress.band).toBe('DEADLINE_PASSED');
            expect(progress.ratio).toBeNull();
        }
    });

    it('honours the band boundaries inclusively', () => {
        const band = (ratio: number): OjtBand =>
            resolveBand({ startDate: '2026-01-01', requiredHours: 90, hoursLeft: 10, daysLeft: 10, ratio });

        expect(band(0.39)).toBe('ON_TRACK');
        expect(band(0.4)).toBe('ON_TRACK');
        expect(band(0.41)).toBe('WATCH');
        expect(band(1)).toBe('WATCH');
        expect(band(1.01)).toBe('CRITICAL');
    });

    it('treats completed hours as complete regardless of the deadline', () => {
        const progress = computeProgress({
            requiredHours: 60, requiredDays: 45,
            performedHours: 86.5, performedDays: 191,
            startDate: '2020-01-01',
        }, FIXTURE_TODAY);

        expect(progress.hoursLeft).toBe(0);
        expect(progress.band).toBe('HOURS_COMPLETE');
    });

    it('flags a missing start date instead of guessing a deadline', () => {
        const progress = computeProgress({
            requiredHours: 90, requiredDays: 45,
            performedHours: 0, performedDays: 0,
            startDate: null,
        }, FIXTURE_TODAY);

        expect(progress.deadline).toBeNull();
        expect(progress.daysLeft).toBeNull();
        expect(progress.band).toBe('AWAITING_START_DATE');
    });
});

describe('not-started flag', () => {
    it('is a flag, not a band — trainees with zero hours can still be critical', () => {
        const notStarted = OJT_FIXTURES.filter((row) => run(row).notStarted);
        expect(notStarted).toHaveLength(39);

        const criticalAndNotStarted = notStarted.filter((row) => run(row).band === 'CRITICAL');
        expect(criticalAndNotStarted).toHaveLength(13);
    });
});

describe('GM (ATM) extension escalation', () => {
    it('fires for exactly the trainees under 15 days and above 1 hr/day', () => {
        const escalations = OJT_FIXTURES
            .filter((row) => run(row).requiresGmExtension)
            .map((row) => row.name)
            .sort();

        expect(escalations).toEqual(['ALOK SRIVASTAV', 'MANOJ KUMAR YADAV', 'NAGMANI KUMAR']);
    });

    it('does not fire once the deadline has already passed', () => {
        const progress = computeProgress({
            requiredHours: 120, requiredDays: 60,
            performedHours: 82.75, performedDays: 247,
            startDate: '2025-06-09',
        }, FIXTURE_TODAY);

        expect(progress.band).toBe('DEADLINE_PASSED');
        expect(progress.requiresGmExtension).toBe(false);
    });

    it('needs both conditions, not either', () => {
        const base = { requiredDays: 45, performedDays: 10, startDate: '2026-08-01' };

        // >1 hr/day but plenty of runway.
        expect(computeProgress({ ...base, requiredHours: 90, performedHours: 0, startDate: '2026-08-01' }, FIXTURE_TODAY).band)
            .toBe('WATCH');

        // Under 15 days but a comfortable rate.
        const comfortable = computeProgress({
            requiredHours: 60, requiredDays: 45, performedHours: 57, performedDays: 40, startDate: '2026-04-25',
        }, FIXTURE_TODAY);
        expect(comfortable.daysLeft).toBeLessThan(15);
        expect(comfortable.requiresGmExtension).toBe(false);
    });
});

describe('deadline arithmetic', () => {
    it('derives months from hours at 15 hours per month', () => {
        expect(requiredMonths(90)).toBe(6);
        expect(requiredMonths(210)).toBe(14);
        expect(requiredMonths(15)).toBe(1);
        expect(requiredMonths(null)).toBeNull();
    });

    it('clamps month arithmetic to the end of a short month', () => {
        // 31 Dec + 5 months → 31 May; 31 Jul + 4 months → 30 Nov.
        expect(computeDeadline('2025-12-31', 75)).toBe('2026-05-30');
        expect(computeDeadline('2026-07-31', 60)).toBe('2026-11-29');
    });

    it('expands a fractional month into days', () => {
        expect(computeDeadline('2026-06-17', 10)).toBe('2026-07-06');
    });

    it('returns null without a start date or an hours requirement', () => {
        expect(computeDeadline(null, 90)).toBeNull();
        expect(computeDeadline('2026-01-01', null)).toBeNull();
    });
});

describe('formatting', () => {
    it('never wraps hours at 24', () => {
        expect(formatOjtHours(90)).toBe('90:00');
        expect(formatOjtHours(210.5)).toBe('210:30');
        expect(formatOjtHours(77.25)).toBe('77:15');
        expect(formatOjtHours(0)).toBe('0:00');
        expect(formatOjtHours(null)).toBe('—');
    });

    it('rounds 59.999 minutes up to the next hour', () => {
        expect(formatOjtHours(1.99999)).toBe('2:00');
    });

    it('describes days left in both directions', () => {
        expect(formatDaysLeft(14)).toBe('14 days left');
        expect(formatDaysLeft(1)).toBe('1 day left');
        expect(formatDaysLeft(0)).toBe('Due today');
        expect(formatDaysLeft(-3)).toBe('3 days overdue');
    });

    it('clamps the completion bar', () => {
        expect(getOjtCompletionPercent(90, 45)).toBe(50);
        expect(getOjtCompletionPercent(60, 86.5)).toBe(100);
        expect(getOjtCompletionPercent(0, 10)).toBe(0);
    });
});

describe('supervisor input parsing', () => {
    it('accepts durations and decimals alike', () => {
        expect(parseOjtHoursInput('86:30')).toEqual({ kind: 'value', hours: 86.5 });
        expect(parseOjtHoursInput('86:30:00')).toEqual({ kind: 'value', hours: 86.5 });
        expect(parseOjtHoursInput('86.5')).toEqual({ kind: 'value', hours: 86.5 });
        expect(parseOjtHoursInput('210:00')).toEqual({ kind: 'value', hours: 210 });
    });

    it('treats blank as a revert-to-sheet instruction, not as zero', () => {
        expect(parseOjtHoursInput('')).toEqual({ kind: 'empty' });
        expect(parseOjtHoursInput('   ')).toEqual({ kind: 'empty' });
        expect(parseOjtDaysInput('')).toEqual({ kind: 'empty' });
    });

    it('rejects malformed input rather than coercing it', () => {
        expect(parseOjtHoursInput('abc')).toEqual({ kind: 'invalid' });
        expect(parseOjtHoursInput('-5')).toEqual({ kind: 'invalid' });
        expect(parseOjtHoursInput('86:75')).toEqual({ kind: 'invalid' });
        expect(parseOjtHoursInput('1:2:3:4')).toEqual({ kind: 'invalid' });
        expect(parseOjtDaysInput('4.5')).toEqual({ kind: 'invalid' });
        expect(parseOjtDaysInput('-1')).toEqual({ kind: 'invalid' });
    });
});

describe('today', () => {
    it('is evaluated in India time, not UTC', () => {
        // 2026-08-11T20:00Z is already 2026-08-12 in Kolkata.
        expect(ojtToday(new Date('2026-08-11T20:00:00Z'))).toBe('2026-08-12');
        expect(ojtToday(new Date('2026-08-11T18:29:00Z'))).toBe('2026-08-11');
    });
});
