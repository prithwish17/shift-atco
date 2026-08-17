/**
 * SARC engine vs. the live workbook.
 *
 * The fixture carries the sheet's own computed columns, so every difference
 * between engine and sheet has to be accounted for here by name. The exception
 * lists below are hand-maintained on purpose: `fixtures.ts` is regenerated from
 * a fresh export, and if the accepted departures lived there too, a regression
 * would be absorbed the next time somebody regenerated it.
 *
 * Historical parity is checked for rosters without training. Training now has
 * a deliberate, newer rule: it is general duty rather than a bridging day.
 */

import { describe, expect, it } from 'vitest';

import {
    FIXTURE_EXPORTED,
    FIXTURE_PERIOD,
    FIXTURE_PERIOD_DAYS,
    SARC_FIXTURES,
    type SarcFixtureRow,
} from './fixtures';
import { buildAnnexure, summariseAnnexure } from '../annexure';
import { detectBlocks, resolveSpans } from '../blocks';
import { classifyDutyCode } from '../codes';
import { formatDuration, hours, parseDuration } from '../duration';
import {
    GENERAL_RATE,
    SHIFT_RATE,
    applyCap,
    evaluate,
    evaluateEmployee,
    totalTimeIn,
    weightedTotal,
} from '../engine';
import { enumeratePeriodDates, periodDays, periodMonths } from '../period';
import type { IamatcHours, SarcEmployeeInput, SarcPeriod, SarcRow } from '../types';

/* ─── Accepted departures from the sheet ──────────────────────────────────── */

/**
 * Shift-team controllers whose accrual rises.
 *
 * The sheet ran a streak counter that dropped their leave and off days to the
 * general rate the moment they touched a *single* `G` day. Under §1.4 a
 * bridging day only takes the general rate inside a qualifying general span;
 * outside one it stays on the home rate of 1.0 (§2.4).
 */
const BRIDGING_RATE_EXCEPTIONS = [
    { empId: '10020139', name: 'ABHIJIT KUMAR', sheet: '46:00', engine: '53:00' },
    { empId: '10010146', name: 'DHANANJAY KUMAR', sheet: '46:00', engine: '53:00' },
    { empId: '10012533', name: 'MILAN KANTI MANDAL', sheet: '51:00', engine: '55:00' },
    { empId: '10012562', name: 'RANJIT KUMAR DAS', sheet: '50:00', engine: '53:30' },
    { empId: '10012104', name: 'DIPTI RANJAN SETHI', sheet: '52:00', engine: '55:00' },
    { empId: '10017084', name: 'BRAJ MOHAN', sheet: '48:00', engine: '49:30' },
    { empId: '10002405', name: 'DURGESH CHANDRA TRIPATHI', sheet: '56:00', engine: '57:00' },
    { empId: '10023192', name: 'APOORV KUSHWAHA', sheet: '54:00', engine: '55:00' },
    { empId: '10012517', name: 'DEB DAYAL', sheet: '48:30', engine: '49:00' },
] as const;

/**
 * General-team officers whose accrual falls.
 *
 * The sheet charged a full hour for any day that was neither `G` nor leave, so
 * a scattered shift duty billed at the watch rate. Under §1.4 a shift day only
 * takes the shift rate inside a qualifying shift span; outside one it stays on
 * the home rate of 0.5 (§2.3).
 */
const ISOLATED_DUTY_EXCEPTIONS = [
    { empId: '10020974', name: 'AMITAVA ROY', sheet: '35:00', engine: '33:30' },
    { empId: '10023424', name: 'ARUN KUMAR', sheet: '45:00', engine: '43:30' },
    { empId: '10002317', name: 'PRATICK DASGUPTA', sheet: '34:30', engine: '34:00' },
] as const;

const ACCRUAL_EXCEPTIONS = [...BRIDGING_RATE_EXCEPTIONS, ...ISOLATED_DUTY_EXCEPTIONS];
const ACCRUAL_EXCEPTION_IDS = new Set(ACCRUAL_EXCEPTIONS.map((e) => e.empId));

/**
 * The one requirement that differs without the accrual differing.
 *
 * Rated on the period's own start date. The sheet's `ratingDate < start` is
 * strict, so he fell into the pro-rate branch and drew 61:00 — above the 60:00
 * ceiling the cap enforces for everybody else (§2.6).
 */
const PRORATE_EXCEPTION = {
    empId: '10010144',
    name: 'DEBAJIT JOTDER',
    ratingDate: '2026-06-01',
    sheet: '61:00',
    engine: '60:00',
} as const;

/* ─── Fixture plumbing ────────────────────────────────────────────────────── */

const PERIOD_DATES = enumeratePeriodDates(FIXTURE_PERIOD);

function toIamatc(raw: SarcFixtureRow['iamatc']): IamatcHours | null {
    if (!raw) return null;
    const [a, b, c, d, e, f, g, h] = raw.map((value) => parseDuration(value) ?? 0);
    return {
        controlling: a,
        ojtPractical: b,
        ojtiTheory: c,
        wsoCmd: d,
        instructorExaminer: e,
        unitSupervisor: f,
        supportiveUnit: g,
        alpha: h,
    };
}

function toInput(row: SarcFixtureRow): SarcEmployeeInput {
    const codes = row.dutyCodes.split(',');
    const dutyCodes: Record<string, string> = {};
    codes.forEach((code, index) => {
        if (code !== '') dutyCodes[PERIOD_DATES[index]] = code;
    });

    return {
        empId: row.empId,
        name: row.name,
        designation: row.designation,
        team: row.team,
        dutyCodes,
        oldestRatingDate: row.oldestRatingDate,
        oldestEndorsementDate: row.oldestEndorsementDate,
        included: row.included,
        performed: toIamatc(row.iamatc),
    };
}

const INPUTS = SARC_FIXTURES.map(toInput);
const ROWS = evaluate({ period: FIXTURE_PERIOD, employees: INPUTS });
const BY_ID = new Map<string, SarcRow>(ROWS.map((row) => [row.empId, row]));
const FIXTURE_BY_ID = new Map(SARC_FIXTURES.map((row) => [row.empId, row]));

const secs = (value: string | null) => (value == null ? null : parseDuration(value));
const hasTrainingDuty = (row: SarcFixtureRow) =>
    row.dutyCodes.split(',').some((code) => ['T', 'TR'].includes(code.trim().toUpperCase()));

/* ─── Suites ──────────────────────────────────────────────────────────────── */

describe('fixture integrity', () => {
    it('covers the whole workbook', () => {
        expect(SARC_FIXTURES).toHaveLength(374);
        expect(FIXTURE_EXPORTED).toBe('2026-08-14');
    });

    it('spans 61 days across two calendar months', () => {
        expect(periodDays(FIXTURE_PERIOD)).toBe(FIXTURE_PERIOD_DAYS);
        expect(periodMonths(FIXTURE_PERIOD)).toBe(2);
        expect(PERIOD_DATES).toHaveLength(61);
    });

    it('gives every employee one duty code per day of the period', () => {
        const wrong = SARC_FIXTURES.filter(
            (row) => row.dutyCodes.split(',').length !== FIXTURE_PERIOD_DAYS,
        ).map((row) => `${row.name}: ${row.dutyCodes.split(',').length} codes`);

        expect(wrong).toEqual([]);
    });

    it('names every accepted departure against a real employee', () => {
        const missing = [...ACCRUAL_EXCEPTIONS, PRORATE_EXCEPTION]
            .filter((e) => !FIXTURE_BY_ID.has(e.empId))
            .map((e) => `${e.name} (${e.empId})`);

        expect(missing).toEqual([]);
    });
});

describe('IAMATC weighted total', () => {
    const withTotals = SARC_FIXTURES.filter((row) => row.iamatc && row.sheetWeightedTotal);

    it('reproduces the extract’s own total for every row', () => {
        const mismatches = withTotals
            .filter((row) => weightedTotal(toIamatc(row.iamatc)!) !== secs(row.sheetWeightedTotal))
            .map(
                (row) =>
                    `${row.name}: got ${formatDuration(weightedTotal(toIamatc(row.iamatc)!))}, extract ${row.sheetWeightedTotal}`,
            );

        expect(mismatches).toEqual([]);
        expect(withTotals.length).toBe(317);
    });

    it('caps the supportive component at 15 hours', () => {
        // K IBUNGOTON SINGHA: no controlling time at all, 69:25 of Alpha.
        // Half of that is 34:42, but the total the extract prints is 15:00.
        const row = FIXTURE_BY_ID.get('10017314')!;
        expect(row.sheetWeightedTotal).toBe('15:00:00');
        expect(weightedTotal(toIamatc(row.iamatc)!)).toBe(hours(15));
    });

    it('truncates the halved supportive component to the minute', () => {
        // SRABANI SARKAR: 3:45 of Alpha halves to 1:52:30, which the extract
        // carries as 1:52. Rounding instead would overstate by 30 seconds.
        const row = FIXTURE_BY_ID.get('10000684')!;
        expect(weightedTotal(toIamatc(row.iamatc)!)).toBe(secs(row.sheetWeightedTotal));
        expect(weightedTotal(toIamatc(row.iamatc)!) % 60).toBe(0);
    });
});

describe('accrual vs the sheet', () => {
    it('reproduces the historical Hours Required baseline where training is absent', () => {
        const mismatches = SARC_FIXTURES
            .filter((row) => !hasTrainingDuty(row) && !ACCRUAL_EXCEPTION_IDS.has(row.empId))
            .filter((row) => BY_ID.get(row.empId)!.required !== secs(row.sheetRequired))
            .map(
                (row) =>
                    `${row.name} (${row.empId}): got ${formatDuration(BY_ID.get(row.empId)!.required)}, sheet ${row.sheetRequired}`,
            );

        expect(mismatches).toEqual([]);
    });

    it('keeps the known non-training departures from the historical baseline', () => {
        const differing = SARC_FIXTURES.filter(
            (row) => !hasTrainingDuty(row) && BY_ID.get(row.empId)!.required !== secs(row.sheetRequired),
        ).map((row) => row.empId);

        const nonTrainingExceptions = ACCRUAL_EXCEPTIONS
            .filter((exception) => !hasTrainingDuty(FIXTURE_BY_ID.get(exception.empId)!))
            .map((exception) => exception.empId);
        expect(new Set(differing)).toEqual(new Set(nonTrainingExceptions));
    });

    it.each(ACCRUAL_EXCEPTIONS.filter((exception) => !hasTrainingDuty(FIXTURE_BY_ID.get(exception.empId)!)))(
        'charges $name $engine where the sheet charged $sheet',
        ({ empId, sheet, engine }) => {
            const row = BY_ID.get(empId)!;
            expect(FIXTURE_BY_ID.get(empId)!.sheetRequired).toBe(sheet);
            expect(formatDuration(row.required)).toBe(engine);
        },
    );

    it('raises the accrual only for shift-team controllers', () => {
        for (const { empId } of BRIDGING_RATE_EXCEPTIONS.filter((exception) => !hasTrainingDuty(FIXTURE_BY_ID.get(exception.empId)!))) {
            const row = BY_ID.get(empId)!;
            expect(row.home).toBe('shift');
            expect(row.required).toBeGreaterThan(secs(FIXTURE_BY_ID.get(empId)!.sheetRequired)!);
        }
    });

    it('lowers the accrual only for general-team officers', () => {
        for (const { empId } of ISOLATED_DUTY_EXCEPTIONS.filter((exception) => !hasTrainingDuty(FIXTURE_BY_ID.get(exception.empId)!))) {
            const row = BY_ID.get(empId)!;
            expect(row.home).toBe('general');
            expect(row.required).toBeLessThan(secs(FIXTURE_BY_ID.get(empId)!.sheetRequired)!);
        }
    });

    it('agrees with the sheet on who counts as general', () => {
        const mismatches = SARC_FIXTURES.filter((row) => !hasTrainingDuty(row)).filter(
            (row) => BY_ID.get(row.empId)!.isGeneral !== row.sheetGeneral,
        ).map((row) => `${row.name}: got ${BY_ID.get(row.empId)!.isGeneral}, sheet ${row.sheetGeneral}`);

        expect(mismatches).toEqual([]);
    });
});

describe('cap and rating pro-rate vs the sheet', () => {
    const comparable = SARC_FIXTURES.filter(
        (row) => !hasTrainingDuty(row) && !ACCRUAL_EXCEPTION_IDS.has(row.empId),
    );

    it('reproduces Adjusted Hours wherever the accrual matches', () => {
        const mismatches = comparable
            .filter((row) => BY_ID.get(row.empId)!.adjusted !== secs(row.sheetAdjusted))
            .map(
                (row) =>
                    `${row.name}: got ${formatDuration(BY_ID.get(row.empId)!.adjusted)}, sheet ${row.sheetAdjusted}`,
            );

        expect(mismatches).toEqual([]);
    });

    it('reproduces the requirement everywhere but the pro-rate exception', () => {
        const mismatches = comparable
            .filter((row) => row.empId !== PRORATE_EXCEPTION.empId)
            .filter((row) => BY_ID.get(row.empId)!.requirement !== secs(row.sheetRequirement))
            .map(
                (row) =>
                    `${row.name}: got ${formatDuration(BY_ID.get(row.empId)!.requirement)}, sheet ${row.sheetRequirement}`,
            );

        expect(mismatches).toEqual([]);
    });

    it('keeps a rating dated on the period start inside the cap', () => {
        const row = BY_ID.get(PRORATE_EXCEPTION.empId)!;
        expect(row.oldestRatingDate).toBe(PRORATE_EXCEPTION.ratingDate);
        expect(row.oldestRatingDate).toBe(FIXTURE_PERIOD.start);

        // The sheet pro-rated him instead, landing above its own ceiling.
        expect(FIXTURE_BY_ID.get(row.empId)!.sheetRequirement).toBe(PRORATE_EXCEPTION.sheet);
        expect(secs(PRORATE_EXCEPTION.sheet)!).toBeGreaterThan(row.adjusted);

        expect(formatDuration(row.requirement)).toBe(PRORATE_EXCEPTION.engine);
        expect(row.requirement).toBe(row.adjusted);
    });

    it('exempts everyone missing a rating or endorsement date', () => {
        const exempt = ROWS.filter((row) => row.requirement == null);
        expect(exempt).toHaveLength(199);

        for (const row of exempt) {
            expect(
                row.oldestRatingDate == null ||
                    row.oldestEndorsementDate == null ||
                    row.oldestRatingDate > FIXTURE_PERIOD.end,
            ).toBe(true);
        }
    });

    it('caps by the monthly standard rather than by exact match', () => {
        // A 59-day period accrues 29:30 at the general rate. The sheet's
        // exact-match normalisation would raise it to 30:00; a cap cannot.
        expect(applyCap(hours(29.5), 59, 2)).toBe(hours(29.5));
        expect(applyCap(hours(30.5), 61, 2)).toBe(hours(30));
        expect(applyCap(hours(61), 61, 2)).toBe(hours(60));
        // A mixed accrual is not crushed to the general ceiling.
        expect(applyCap(hours(45), 61, 2)).toBe(hours(45));
    });
});

describe('Annexure vs the issued statement', () => {
    const report = buildAnnexure(ROWS, FIXTURE_PERIOD);
    const summary = summariseAnnexure(report);

    it('is titled the way the sheet titles it', () => {
        expect(report.title).toBe(
            'Annexure- 2: Stress Allowance Recovery For The Period of June-July 2026',
        );
    });

    it('holds back exactly the employees the master-data check excludes', () => {
        expect(report.excluded.map((row) => row.name)).toEqual([
            'MILAN KANTI MANDAL',
            'AROON KUMAR SINGH',
        ]);
        // Both were already exempt, so exclusion moves no money (§2.11).
        expect(report.excluded.every((row) => row.requirement == null)).toBe(true);
        expect(report.rows).toHaveLength(372);
    });

    it('reproduces every recovery percentage', () => {
        const mismatches = report.rows
            .filter((row) => !hasTrainingDuty(FIXTURE_BY_ID.get(row.empId)!))
            .filter((row) => {
                const sheet = FIXTURE_BY_ID.get(row.empId)!.sheetRecovery;
                if (sheet == null || row.recovery == null) return false;
                return Math.abs(sheet - row.recovery) > 5e-5;
            })
            .map((row) => `${row.name}: got ${row.recovery}, sheet ${FIXTURE_BY_ID.get(row.empId)!.sheetRecovery}`);

        expect(mismatches).toEqual([]);
    });

    it('totals hours owed and performed over the same population', () => {
        // The two are adjacent in the interface and beg to be subtracted, so
        // they must cover the same employees. Summing performed hours over the
        // exempt as well would make the difference meaningless.
        const withRequirement = report.rows.filter(
            (row) => row.requirement != null && row.requirement > 0,
        );

        expect(summary.totalRequirement).toBe(
            withRequirement.reduce((sum, row) => sum + (row.requirement ?? 0), 0),
        );
        expect(summary.totalPerformed).toBe(
            withRequirement.reduce((sum, row) => sum + (row.performed ?? 0), 0),
        );
        // Exempt employees do perform hours, so the two populations differ.
        const everyone = report.rows.reduce((sum, row) => sum + (row.performed ?? 0), 0);
        expect(everyone).toBeGreaterThan(summary.totalPerformed);
    });

    it('reports the totals produced by the current duty rules', () => {
        expect(summary.withRequirement).toBe(175);
        expect(summary.inRecovery).toBe(6);
        expect(summary.meanRecovery).toBeCloseTo(0.01195, 4);
    });

    it('applies the training-as-general-duty accrual across the whole roster', () => {
        const sheetTotal = SARC_FIXTURES.reduce((sum, row) => sum + secs(row.sheetRequired)!, 0);
        const engineTotal = ROWS.reduce((sum, row) => sum + row.required, 0);

        expect(formatDuration(sheetTotal)).toBe('20974:30');
        expect(formatDuration(engineTotal)).toBe('20569:00');
    });
});

describe('the General/Shift split on Hours Performed', () => {
    /**
     * NEGATIVE oracle. The issued Annexure takes the weighted grand total for
     * everyone — the split the sheet's own formula describes was never applied
     * (§2.7). Where a General officer's A+B differs from that total, the engine
     * must diverge from the statement.
     */
    const generalWithDifferingTotals = SARC_FIXTURES.filter((row) => {
        const hours = toIamatc(row.iamatc);
        return (
            hours != null &&
            BY_ID.get(row.empId)!.isGeneral &&
            totalTimeIn(hours) !== weightedTotal(hours)
        );
    });

    it('finds General officers the sheet credited with the grand total', () => {
        expect(generalWithDifferingTotals.length).toBeGreaterThan(0);
    });

    it('does not reproduce the statement for them', () => {
        for (const fixture of generalWithDifferingTotals) {
            const row = BY_ID.get(fixture.empId)!;
            expect(row.performedSource).toBe('totalTimeIn');
            expect(row.performed).toBe(totalTimeIn(toIamatc(fixture.iamatc)!));
            expect(row.performed).not.toBe(secs(fixture.sheetPerformed));
        }
    });

    it('credits SANDIP BASU his controlling time, not the grand total', () => {
        const row = BY_ID.get('10012524')!;
        expect(row.isGeneral).toBe(true);
        expect(FIXTURE_BY_ID.get('10012524')!.sheetPerformed).toBe('33:15:00');
        expect(formatDuration(row.performed)).toBe('31:25');
    });

    it('uses the weighted total for shift controllers', () => {
        const shift = ROWS.filter((row) => !row.isGeneral && row.performed != null);
        expect(shift.every((row) => row.performedSource === 'weightedTotal')).toBe(true);
    });
});

/* ─── The rules in isolation ──────────────────────────────────────────────── */

function evaluateCodes(team: string | null, codes: string[]): SarcRow {
    const period: SarcPeriod = {
        start: '2026-06-01',
        end: `2026-06-${String(codes.length).padStart(2, '0')}`,
    };
    const dates = enumeratePeriodDates(period);
    const dutyCodes: Record<string, string> = {};
    codes.forEach((code, index) => {
        if (code !== '') dutyCodes[dates[index]] = code;
    });

    return evaluateEmployee(
        {
            empId: 'TEST',
            name: 'TEST',
            designation: null,
            team,
            dutyCodes,
            oldestRatingDate: null,
            oldestEndorsementDate: null,
            performed: null,
        },
        period,
    );
}

const G = 'G';
const CYCLE = ['M', 'A', 'N', 'NO', 'CO'];

describe('block detection', () => {
    it('counts duties rather than calendar days, so GGG·LLL·GG qualifies', () => {
        const classes = [...'GGG'].map(() => 'general' as const);
        const blocks = detectBlocks([
            ...classes,
            'bridging',
            'bridging',
            'bridging',
            'general',
            'general',
        ]);

        expect(blocks).toHaveLength(1);
        expect(blocks[0].dutyCount).toBe(5);
        expect(blocks[0].qualifies).toBe(true);
        expect(blocks[0].startIndex).toBe(0);
        expect(blocks[0].endIndex).toBe(7);
    });

    it('does not qualify a run of four', () => {
        const blocks = detectBlocks(['general', 'bridging', 'general', 'general', 'general']);
        expect(blocks[0].dutyCount).toBe(4);
        expect(blocks[0].qualifies).toBe(false);
    });

    it('ends a run at a duty of the other type', () => {
        const blocks = detectBlocks(['general', 'general', 'shift', 'general', 'general']);
        expect(blocks.map((b) => [b.type, b.startIndex, b.endIndex])).toEqual([
            ['general', 0, 1],
            ['shift', 2, 2],
            ['general', 3, 4],
        ]);
    });

    it('never lets the two span types overlap', () => {
        const classes = [
            'general', 'general', 'general', 'general', 'general',
            'bridging', 'bridging',
            'shift', 'shift', 'shift', 'shift', 'shift',
        ] as const;
        const spans = resolveSpans(detectBlocks([...classes]), classes.length);

        // The two bridging days sit between the spans, inside neither.
        expect(spans).toEqual([
            'general', 'general', 'general', 'general', 'general',
            null, null,
            'shift', 'shift', 'shift', 'shift', 'shift',
        ]);
    });

    it('leaves a trailing bridging day outside the span it follows', () => {
        const spans = resolveSpans(
            detectBlocks(['general', 'general', 'general', 'general', 'general', 'bridging']),
            6,
        );
        expect(spans[4]).toBe('general');
        expect(spans[5]).toBeNull();
    });
});

describe('charging rules', () => {
    it('charges a shift controller’s general block at the general rate', () => {
        const row = evaluateCodes('B', [...CYCLE, ...CYCLE, G, G, G, G, G, ...CYCLE, ...CYCLE]);
        const generalDays = row.days.filter((day) => day.dayClass === 'general');

        expect(generalDays).toHaveLength(5);
        expect(generalDays.every((day) => day.charge === GENERAL_RATE)).toBe(true);
        expect(generalDays.every((day) => day.reason === 'span')).toBe(true);
    });

    it('leaves a shift controller’s short general spell on the home rate', () => {
        // Both a five-day general block and a three-day spell, so the global
        // fallback stays out of it and the per-block rule is what is measured.
        const row = evaluateCodes('B', [
            ...CYCLE, ...CYCLE,
            G, G, G, G, G,
            ...CYCLE,
            G, G, G,
            ...CYCLE,
        ]);

        const spanned = row.days.filter(
            (day) => day.dayClass === 'general' && day.reason === 'span',
        );
        const homed = row.days.filter(
            (day) => day.dayClass === 'general' && day.reason === 'home',
        );

        expect(spanned).toHaveLength(5);
        expect(spanned.every((day) => day.charge === GENERAL_RATE)).toBe(true);

        expect(homed).toHaveLength(3);
        expect(homed.every((day) => day.charge === SHIFT_RATE)).toBe(true);
    });

    it('charges bridging days inside a general span at the general rate', () => {
        const row = evaluateCodes('B', [
            ...CYCLE, ...CYCLE,
            G, G, G, 'LEAVE', 'LEAVE', G, G,
            ...CYCLE, ...CYCLE,
        ]);
        const inside = row.days.filter((day) => day.code === 'LEAVE');

        expect(inside).toHaveLength(2);
        expect(inside.every((day) => day.span === 'general')).toBe(true);
        expect(inside.every((day) => day.charge === GENERAL_RATE)).toBe(true);
    });

    it('charges bridging days outside every span at the home rate', () => {
        const row = evaluateCodes('B', [
            ...CYCLE, ...CYCLE,
            G, G, G, G, G,
            'LEAVE', 'LEAVE',
            ...CYCLE, ...CYCLE,
        ]);
        const outside = row.days.filter((day) => day.code === 'LEAVE');

        expect(outside).toHaveLength(2);
        expect(outside.every((day) => day.span === null)).toBe(true);
        expect(outside.every((day) => day.charge === SHIFT_RATE)).toBe(true);
        expect(outside.every((day) => day.reason === 'home')).toBe(true);
    });

    it('puts a whole period with no qualifying shift block on 0.5/day', () => {
        const row = evaluateCodes('G', [...Array(10).fill(G), 'M', 'A', 'LEAVE']);

        expect(row.days.every((day) => day.reason === 'fallback-general')).toBe(true);
        expect(row.required).toBe(GENERAL_RATE * 13);
    });

    it('puts a whole period with no qualifying general block on 1.0/day', () => {
        const row = evaluateCodes('G', [...CYCLE, ...CYCLE, G, G, 'LEAVE']);

        expect(row.days.every((day) => day.reason === 'fallback-shift')).toBe(true);
        expect(row.required).toBe(SHIFT_RATE * 13);
    });

    it('skips blank and #N/A days without breaking a block', () => {
        const row = evaluateCodes('B', [...CYCLE, ...CYCLE, G, G, '#N/A', '', G, G, G]);
        const skipped = row.days.filter((day) => day.dayClass === 'skipped');

        expect(skipped).toHaveLength(2);
        expect(skipped.every((day) => day.charge === 0)).toBe(true);
        expect(row.daysOnRoster).toBe(15);

        // The five G days either side of the gap still form one qualifying
        // block, whose span covers all seven days. A skipped day reports no
        // span of its own, because it drew no rate — only the five general
        // days inside the span are charged.
        const block = row.blocks.find((candidate) => candidate.type === 'general')!;
        expect(block.dutyCount).toBe(5);
        expect(block.qualifies).toBe(true);
        expect([block.startIndex, block.endIndex]).toEqual([10, 16]);
        expect(row.days.filter((day) => day.span === 'general')).toHaveLength(5);
    });

    it('treats training as general duty', () => {
        expect(classifyDutyCode('T')).toBe('general');
        expect(classifyDutyCode('TR')).toBe('general');
        expect(classifyDutyCode('Tr')).toBe('general');

        const row = evaluateCodes('B', [...CYCLE, ...CYCLE, 'T', 'TR', 'T', 'TR', 'T', 'TR']);
        const training = row.days.filter(
            (day) => ['T', 'TR'].includes((day.code ?? '').toUpperCase()),
        );
        expect(training).toHaveLength(6);
        expect(training.every((day) => day.charge === GENERAL_RATE)).toBe(true);
        expect(training.every((day) => day.reason === 'span')).toBe(true);
    });

    it('reads NO as shift duty and CO as bridging', () => {
        expect(classifyDutyCode('NO')).toBe('shift');
        expect(classifyDutyCode('CO')).toBe('bridging');
    });

    it('reads GO as general duty, like G', () => {
        // "General Oscar" in the app's duty legend, sharing G's 0940 start. It
        // is the more common of the two on the live roster — 1,332 cells to
        // 734 — so treating it as a watch overcharged more days than G has.
        expect(classifyDutyCode('GO')).toBe('general');
        expect(classifyDutyCode('go')).toBe('general');

        const row = evaluateCodes('B', [...CYCLE, ...CYCLE, 'GO', 'GO', 'GO', 'GO', 'GO', ...CYCLE]);
        const generalDays = row.days.filter((day) => day.dayClass === 'general');
        expect(generalDays).toHaveLength(5);
        expect(generalDays.every((day) => day.charge === GENERAL_RATE)).toBe(true);
    });

    it('skips NA — not on the roster, so it accrues nothing', () => {
        // "Not Available" in the app's legend: not posted that day. 1,675 cells
        // over the live period, every one of which fell through to a full hour.
        expect(classifyDutyCode('NA')).toBe('skipped');
        expect(classifyDutyCode('na')).toBe('skipped');

        const row = evaluateCodes('B', [...CYCLE, ...CYCLE, 'NA', 'NA', 'NA']);
        const skipped = row.days.filter((day) => day.dayClass === 'skipped');
        expect(skipped).toHaveLength(3);
        expect(skipped.every((day) => day.charge === 0)).toBe(true);
        expect(row.daysOnRoster).toBe(10);
    });

    it('does not let NA break a block, any more than a blank does', () => {
        // Five general duties either side of an NA gap still form one block.
        const row = evaluateCodes('B', [...CYCLE, ...CYCLE, 'G', 'G', 'NA', 'G', 'G', 'G']);
        const block = row.blocks.find((b) => b.type === 'general')!;
        expect(block.dutyCount).toBe(5);
        expect(block.qualifies).toBe(true);
    });

    it('treats every off day and holiday identically', () => {
        const OFF_DAYS = [
            'NH', 'CH', 'GH', 'RH', 'SAT', 'SUN', 'LEAVE', 'CO', 'SL',
        ];
        for (const code of OFF_DAYS) expect(classifyDutyCode(code)).toBe('bridging');

        // Behavioural equivalence, not just a shared label: swap one day of an
        // otherwise identical roster for each code and the whole evaluation
        // must come out the same — the charge inside a span, the charge outside
        // one, and the period total.
        // Indexed, not looked up by code: CO also occurs inside CYCLE, so a
        // find-by-code would grade the wrong day.
        const INSIDE_AT = CYCLE.length * 2 + 3;
        const OUTSIDE_AT = CYCLE.length * 2 + 5;

        const shape = (code: string) => {
            const inside = evaluateCodes('B', [
                ...CYCLE, ...CYCLE, G, G, G, code, G, G, ...CYCLE,
            ]);
            const outside = evaluateCodes('B', [
                ...CYCLE, ...CYCLE, G, G, G, G, G, code, ...CYCLE,
            ]);
            expect(inside.days[INSIDE_AT].code).toBe(code);
            expect(outside.days[OUTSIDE_AT].code).toBe(code);
            return {
                insideCharge: inside.days[INSIDE_AT].charge,
                outsideCharge: outside.days[OUTSIDE_AT].charge,
                total: inside.required,
            };
        };

        const baseline = shape('CH');
        expect(baseline.insideCharge).toBe(GENERAL_RATE);
        expect(baseline.outsideCharge).toBe(SHIFT_RATE);
        for (const code of OFF_DAYS) expect(shape(code)).toEqual(baseline);
    });

    it('does not let a national holiday break a block', () => {
        const row = evaluateCodes('B', [...CYCLE, ...CYCLE, G, G, 'NH', G, G, G]);
        const block = row.blocks.find((b) => b.type === 'general')!;
        expect(block.dutyCount).toBe(5);
        expect(block.qualifies).toBe(true);
    });
});
