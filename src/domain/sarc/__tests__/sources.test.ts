import { describe, expect, it } from 'vitest';

import { FIXTURE_PERIOD, SARC_FIXTURES, type SarcFixtureRow } from './fixtures';
import { buildAnnexure, summariseAnnexure } from '../annexure';
import { parseDuration } from '../duration';
import { evaluate, homeCategory } from '../engine';
import { enumeratePeriodDates } from '../period';
import {
    assembleEmployees,
    toIsoDate,
    homeFromCurrentShift,
    inferHome,
    ratingDatesFrom,
    type EmployeeMetadata,
    type RosterMember,
} from '../sources';
import type { IamatcHours, SarcEmployeeInput } from '../types';

describe('toIsoDate', () => {
    it('accepts ISO', () => {
        expect(toIsoDate('2020-02-02')).toBe('2020-02-02');
        expect(toIsoDate('2020-02-02T11:30:00Z')).toBe('2020-02-02');
    });

    it('accepts the day-first form the rating sync also emits', () => {
        // The source workbook carries rating dates as 25-08-2008 and
        // endorsement dates as 2019-11-21 — day-first and ISO side by side.
        expect(toIsoDate('25-08-2008')).toBe('2008-08-25');
        expect(toIsoDate('1-3-2021')).toBe('2021-03-01');
        expect(toIsoDate('25/08/2008')).toBe('2008-08-25');
    });

    it('reads dd-mm-yyyy day-first, never month-first', () => {
        // 05-06-2026 is 5 June, not 6 May. Getting this backwards would move
        // people in and out of a mid-period proration.
        expect(toIsoDate('05-06-2026')).toBe('2026-06-05');
    });

    it('rejects anything that is not a date rather than guessing', () => {
        for (const bad of ['', '   ', 'not-a-date', '13-25-2020', '31-02-2020', '2020-13-01']) {
            expect(toIsoDate(bad)).toBeNull();
        }
    });
});

describe('ratingDatesFrom', () => {
    // Joined Kolkata long before every rating in these fixtures, so the Kolkata
    // filter is satisfied and the earliest-date logic is what is under test.
    const JOINED = '2000-01-01';

    it('takes the earliest of each date independently', () => {
        // The earliest endorsement need not belong to the earliest rating —
        // they are two separate columns in the sheet and two separate minima.
        expect(
            ratingDatesFrom(
                {
                    ADC: { rating_date: '2019-05-01', endorsement_date: '2021-01-01' },
                    APP: { rating_date: '2022-03-01', endorsement_date: '2019-09-09' },
                },
                JOINED,
            ),
        ).toEqual({
            oldestRatingDate: '2019-05-01',
            oldestEndorsementDate: '2019-09-09',
            oldestRatingDateAnyStation: '2019-05-01',
        });
    });

    it('ignores blanks, nulls and malformed dates', () => {
        const dates = ratingDatesFrom(
            {
                A: { rating_date: null, endorsement_date: '' },
                B: { rating_date: '   ', endorsement_date: 'not-a-date' },
                C: { rating_date: '2020-02-02', endorsement_date: '2020-03-03' },
            },
            JOINED,
        );
        expect(dates.oldestRatingDate).toBe('2020-02-02');
        expect(dates.oldestEndorsementDate).toBe('2020-03-03');
    });

    it('trims a timestamp down to the date', () => {
        expect(
            ratingDatesFrom({ A: { rating_date: '2020-02-02T11:30:00Z' } }, JOINED)
                .oldestRatingDate,
        ).toBe('2020-02-02');
    });

    it('compares across mixed formats, not lexically', () => {
        // A day-first 2008 date must win over an ISO 2019 one. Sorting the raw
        // strings would put "2019-11-21" before "25-08-2008" and pick the wrong
        // year entirely.
        const dates = ratingDatesFrom(
            {
                A: { rating_date: '2019-11-21', endorsement_date: '2019-11-21' },
                B: { rating_date: '25-08-2008', endorsement_date: '2020-01-01' },
            },
            JOINED,
        );
        expect(dates.oldestRatingDate).toBe('2008-08-25');
        expect(dates.oldestEndorsementDate).toBe('2019-11-21');
    });

    it('returns nulls for an empty or missing record', () => {
        for (const data of [{}, null]) {
            expect(ratingDatesFrom(data, JOINED)).toEqual({
                oldestRatingDate: null,
                oldestEndorsementDate: null,
                oldestRatingDateAnyStation: null,
            });
        }
    });
});

describe('ratingDatesFrom — the Kolkata filter', () => {
    const ratings = {
        OLD: { rating_date: '2016-12-19', endorsement_date: '2017-01-01' },
        KOL: { rating_date: '2026-03-05', endorsement_date: '2026-04-01' },
    };

    it('anchors on the oldest rating earned at Kolkata, not the oldest overall', () => {
        // A rating from a previous station is not a Kolkata rating.
        const dates = ratingDatesFrom(ratings, '2026-01-20');
        expect(dates.oldestRatingDate).toBe('2026-03-05');
        expect(dates.oldestRatingDateAnyStation).toBe('2016-12-19');
    });

    it('counts a rating issued on the joining date itself', () => {
        expect(ratingDatesFrom({ A: { rating_date: '2026-01-20' } }, '2026-01-20')
            .oldestRatingDate).toBe('2026-01-20');
    });

    it('exempts when every rating predates the move to Kolkata', () => {
        const dates = ratingDatesFrom({ OLD: ratings.OLD }, '2026-01-20');
        expect(dates.oldestRatingDate).toBeNull();
        // Kept so the UI can say why, rather than a bare "exempt".
        expect(dates.oldestRatingDateAnyStation).toBe('2016-12-19');
    });

    it('exempts when no joining date is on file', () => {
        // A sync gap must not quietly bill someone on a rating that may have
        // been earned elsewhere. Pre-flight raises this as a blocking error.
        for (const joined of [null, undefined, '', '   ']) {
            expect(ratingDatesFrom(ratings, joined).oldestRatingDate).toBeNull();
        }
    });

    it('reads a day-first joining date, as the master list writes it', () => {
        expect(ratingDatesFrom(ratings, '20-01-2026').oldestRatingDate).toBe('2026-03-05');
    });

    it('leaves the endorsement date unfiltered', () => {
        // Only ratings are filtered to Kolkata; the endorsement date is a
        // presence gate and keeps its earliest value whenever it was issued.
        expect(ratingDatesFrom(ratings, '2026-01-20').oldestEndorsementDate).toBe('2017-01-01');
    });
});

describe('homeCategory accepts what profiles actually stores', () => {
    it('reads the shift_type enum value, not only the roster letter', () => {
        // profiles.current_shift stores the literal string 'general'. Reading a
        // profile row straight into `team` must not charge a general officer at
        // the shift rate — that would double their requirement, silently.
        expect(homeCategory('G')).toBe('general');
        expect(homeCategory('general')).toBe('general');
        expect(homeCategory('General')).toBe('general');
        expect(homeCategory('b')).toBe('shift');
        expect(homeCategory(null)).toBe('shift');
    });
});

describe('homeFromCurrentShift', () => {
    it('maps the shift_type enum', () => {
        expect(homeFromCurrentShift('general')).toBe('general');
        expect(homeFromCurrentShift('a')).toBe('shift');
        expect(homeFromCurrentShift('E')).toBe('shift');
    });

    it('returns null when there is no profile value to read', () => {
        expect(homeFromCurrentShift(null)).toBeNull();
        expect(homeFromCurrentShift('  ')).toBeNull();
    });
});

describe('inferHome', () => {
    it('reads a general-majority roster as a general team', () => {
        expect(inferHome(['G', 'G', 'G', 'M', 'LEAVE'])).toBe('general');
    });

    it('reads anything else as a shift team', () => {
        expect(inferHome(['M', 'A', 'N', 'G', 'G'])).toBe('shift');
    });

    it('ignores days not worked, so leave cannot tip the balance', () => {
        expect(inferHome(['G', 'G', 'LEAVE', 'SAT', 'SUN', '', '#N/A'])).toBe('general');
    });

    it('returns null when there is nothing to go on', () => {
        expect(inferHome([])).toBeNull();
        expect(inferHome(['', '#N/A'])).toBeNull();
    });
});

/* ─── Assembly against the real roster ────────────────────────────────────── */

const PERIOD_DATES = enumeratePeriodDates(FIXTURE_PERIOD);

function toIamatc(raw: SarcFixtureRow['iamatc']): IamatcHours | null {
    if (!raw) return null;
    const [a, b, c, d, e, f, g, h] = raw.map((value) => parseDuration(value) ?? 0);
    return {
        controlling: a, ojtPractical: b, ojtiTheory: c, wsoCmd: d,
        instructorExaminer: e, unitSupervisor: f, supportiveUnit: g, alpha: h,
    };
}

function dutyCodeMap(row: SarcFixtureRow): Record<string, string> {
    const codes = row.dutyCodes.split(',');
    const map: Record<string, string> = {};
    codes.forEach((code, index) => {
        if (code !== '') map[PERIOD_DATES[index]] = code;
    });
    return map;
}

/** The fixture re-expressed as the shapes the repository hands over. */
const roster: RosterMember[] = SARC_FIXTURES.map((row) => ({
    empId: row.empId,
    name: row.name,
    dutyCodes: dutyCodeMap(row),
}));

const metadata = new Map<string, EmployeeMetadata>(
    SARC_FIXTURES.map((row) => [
        row.empId,
        {
            name: row.name,
            designation: row.designation,
            currentShift: row.team === 'G' ? 'general' : (row.team ?? '').toLowerCase() || null,
            // The fixture predates the Kolkata rule, so everyone is given a
            // joining date early enough that every rating qualifies. That keeps
            // this round-trip testing assembly, not the Kolkata filter.
            kolkataJoiningDate: '2000-01-01',
            ratingData:
                row.oldestRatingDate || row.oldestEndorsementDate
                    ? {
                          PRIMARY: {
                              rating_date: row.oldestRatingDate,
                              endorsement_date: row.oldestEndorsementDate,
                          },
                      }
                    : {},
        },
    ]),
);

const performed = new Map<string, IamatcHours>(
    SARC_FIXTURES.flatMap((row) => {
        const hours = toIamatc(row.iamatc);
        return hours ? [[row.empId, hours] as const] : [];
    }),
);

/** The direct path the golden master uses, for comparison. */
const direct: SarcEmployeeInput[] = SARC_FIXTURES.map((row) => ({
    empId: row.empId,
    name: row.name,
    designation: row.designation,
    team: row.team,
    dutyCodes: dutyCodeMap(row),
    oldestRatingDate: row.oldestRatingDate,
    oldestEndorsementDate: row.oldestEndorsementDate,
    included: row.included,
    performed: toIamatc(row.iamatc),
}));

describe('assembleEmployees against the real roster', () => {
    const assembled = assembleEmployees({ roster, metadata, performed });

    it('produces one employee per roster member', () => {
        expect(assembled).toHaveLength(374);
    });

    it('resolves every home category from a profile, none inferred', () => {
        expect(assembled.every((employee) => employee.homeSource === 'profile')).toBe(true);
    });

    it('reaches the same figures as the direct path', () => {
        const fromAssembly = evaluate({ period: FIXTURE_PERIOD, employees: assembled });
        const fromDirect = evaluate({ period: FIXTURE_PERIOD, employees: direct });

        const mismatches = fromAssembly
            .filter((row, index) => {
                const other = fromDirect[index];
                return (
                    row.empId !== other.empId ||
                    row.required !== other.required ||
                    row.adjusted !== other.adjusted ||
                    row.requirement !== other.requirement ||
                    row.performed !== other.performed ||
                    row.isGeneral !== other.isGeneral
                );
            })
            .map((row) => row.empId);

        expect(mismatches).toEqual([]);
    });

    it('reaches the same statement totals', () => {
        const summary = summariseAnnexure(
            buildAnnexure(evaluate({ period: FIXTURE_PERIOD, employees: assembled }), FIXTURE_PERIOD),
        );

        expect(summary.withRequirement).toBe(175);
        expect(summary.inRecovery).toBe(12);
        expect(summary.meanRecovery).toBeCloseTo(0.0182, 4);
    });
});

describe('assembleEmployees fallbacks', () => {
    const member: RosterMember = {
        empId: 'X1',
        name: 'FROM ROSTER',
        dutyCodes: { [PERIOD_DATES[0]]: 'G', [PERIOD_DATES[1]]: 'G', [PERIOD_DATES[2]]: 'M' },
    };

    it('infers the home category when no profile carries a team', () => {
        const [employee] = assembleEmployees({
            roster: [member],
            metadata: new Map(),
            performed: new Map(),
        });

        expect(employee.kolkataJoiningDate).toBeNull();
        expect(employee.home).toBe('general');
        expect(employee.homeSource).toBe('inferred');
        // No fake team letter is invented to stand for the inference.
        expect(employee.team).toBeNull();
    });

    it('prefers the profile over the duty-code mix', () => {
        const [employee] = assembleEmployees({
            roster: [member],
            metadata: new Map([['X1', { currentShift: 'b' }]]),
            performed: new Map(),
        });

        expect(employee.home).toBe('shift');
        expect(employee.homeSource).toBe('profile');
    });

    it('reports unknown when there is no team and nothing to infer from', () => {
        const [employee] = assembleEmployees({
            roster: [{ empId: 'X2', name: 'N', dutyCodes: {} }],
            metadata: new Map(),
            performed: new Map(),
        });

        expect(employee.homeSource).toBe('unknown');
        expect(employee.home).toBeUndefined();
    });

    it('falls back to the roster name when metadata carries none', () => {
        const [employee] = assembleEmployees({
            roster: [member],
            metadata: new Map([['X1', { name: '   ' }]]),
            performed: new Map(),
        });

        expect(employee.name).toBe('FROM ROSTER');
    });

    it('marks employees held back by the master-data check', () => {
        const [employee] = assembleEmployees({
            roster: [member],
            metadata: new Map(),
            performed: new Map(),
            excluded: new Set(['X1']),
        });

        expect(employee.included).toBe(false);
    });
});
