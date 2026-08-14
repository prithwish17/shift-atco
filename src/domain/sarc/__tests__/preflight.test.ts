import { describe, expect, it } from 'vitest';

import { FIXTURE_PERIOD, SARC_FIXTURES } from './fixtures';
import { isPreflightClean, preflight } from '../preflight';
import type { SarcEmployeeInput, SarcInput } from '../types';

const base: SarcEmployeeInput = {
    empId: '10000001',
    name: 'TEST',
    designation: null,
    team: 'B',
    dutyCodes: { '2026-06-01': 'M', '2026-06-02': 'A' },
    oldestRatingDate: '2020-01-01',
    oldestEndorsementDate: '2020-02-01',
    kolkataJoiningDate: '2000-01-01',
    performed: {
        controlling: 3600,
        ojtPractical: 0,
        ojtiTheory: 0,
        wsoCmd: 0,
        instructorExaminer: 0,
        unitSupervisor: 0,
        supportiveUnit: 0,
        alpha: 0,
    },
};

const employee = (overrides: Partial<SarcEmployeeInput>): SarcEmployeeInput => ({
    ...base,
    ...overrides,
});

const run = (employees: SarcEmployeeInput[], options = {}) =>
    preflight({ period: FIXTURE_PERIOD, employees } satisfies SarcInput, options);

const codes = (find: string, findings: ReturnType<typeof preflight>) =>
    findings.find((finding) => finding.code === find);

describe('preflight', () => {
    it('errors on an empty roster and stops there', () => {
        const findings = run([]);
        expect(findings).toHaveLength(1);
        expect(findings[0].code).toBe('empty-roster');
        expect(isPreflightClean(findings)).toBe(false);
    });

    it('errors on a duplicated employee ID', () => {
        const findings = run([employee({}), employee({})]);
        const finding = codes('duplicate-emp-id', findings)!;

        expect(finding.severity).toBe('error');
        expect(finding.empIds).toEqual(['10000001']);
        expect(isPreflightClean(findings)).toBe(false);
    });

    it('warns when an employee has no duty codes at all', () => {
        const findings = run([employee({ dutyCodes: {} })]);
        const finding = codes('no-roster-days', findings)!;

        expect(finding.severity).toBe('warning');
        expect(finding.message).toContain('schedule sync');
    });

    it('treats partial roster coverage as information, not a problem', () => {
        const finding = codes('partial-roster', run([employee({})]))!;
        expect(finding.severity).toBe('info');
        expect(finding.empIds).toEqual(['10000001']);
    });

    it('warns about duty codes dated outside the period', () => {
        const findings = run([
            employee({ dutyCodes: { '2026-06-01': 'M', '2026-09-14': 'M' } }),
        ]);
        expect(codes('duty-code-outside-period', findings)!.severity).toBe('warning');
    });

    it('reports unrecognised duty codes with their counts', () => {
        const findings = run([
            employee({ dutyCodes: { '2026-06-01': 'ZZ', '2026-06-02': 'ZZ', '2026-06-03': 'QQ' } }),
        ]);
        const finding = codes('unknown-duty-code', findings)!;

        expect(finding.message).toContain('ZZ (2)');
        expect(finding.message).toContain('QQ (1)');
    });

    it('warns when a team is missing, because it sets the home rate', () => {
        const finding = codes('no-team', run([employee({ team: null })]))!;
        expect(finding.severity).toBe('warning');
        expect(finding.message).toContain('home rate');
    });

    it('errors when a Kolkata joining date is missing', () => {
        // Without it no rating can be confirmed as earned here, so the employee
        // is exempt — which must never pass silently, because it is a sync gap
        // rather than a fact about the controller.
        const findings = run([
            employee({ empId: 'A', kolkataJoiningDate: null }),
            ...Array.from({ length: 9 }, (_, n) => employee({ empId: `B${n}` })),
        ]);

        const finding = codes('no-kolkata-joining-date', findings)!;
        expect(finding.severity).toBe('error');
        expect(finding.empIds).toEqual(['A']);
        expect(finding.message).toContain('fetch-atco-master');
        expect(isPreflightClean(findings)).toBe(false);
    });

    it('reports a controller rated only before joining Kolkata', () => {
        const findings = run([
            employee({
                empId: 'A',
                oldestRatingDate: null,
                oldestRatingDateAnyStation: '2016-12-19',
                kolkataJoiningDate: '2026-01-20',
            }),
            ...Array.from({ length: 9 }, (_, n) => employee({ empId: `B${n}` })),
        ]);

        const finding = codes('rated-before-joining-kolkata', findings)!;
        expect(finding.severity).toBe('info');
        expect(finding.empIds).toEqual(['A']);
        // Not conflated with the genuinely unrated.
        expect(codes('exempt-no-rating', findings)).toBeUndefined();
    });

    it('separates the unrated from the rated-but-unendorsed', () => {
        const findings = run([
            employee({ empId: 'A', oldestRatingDate: null, oldestEndorsementDate: null }),
            employee({ empId: 'B', oldestRatingDate: '2020-01-01', oldestEndorsementDate: null }),
            ...Array.from({ length: 8 }, (_, n) => employee({ empId: `C${n}` })),
        ]);

        // Both carry no requirement, but for different reasons and with
        // different urgency: A is simply unrated, B looks like a sync gap.
        expect(codes('exempt-no-rating', findings)!.empIds).toEqual(['A']);
        const unendorsed = codes('rated-not-endorsed', findings)!;
        expect(unendorsed.severity).toBe('warning');
        expect(unendorsed.empIds).toEqual(['B']);
    });

    it('errors when almost nobody carries a requirement, whichever date is missing', () => {
        // The signature of a broken rating sync: a statement where nobody owes
        // anything and every recovery reads zero.
        const missingRating = run(
            Array.from({ length: 10 }, (_, n) =>
                employee({ empId: `E${n}`, oldestRatingDate: n === 0 ? '2020-01-01' : null }),
            ),
        );
        const missingEndorsement = run(
            Array.from({ length: 10 }, (_, n) =>
                employee({ empId: `E${n}`, oldestEndorsementDate: n === 0 ? '2020-02-01' : null }),
            ),
        );

        for (const findings of [missingRating, missingEndorsement]) {
            const finding = codes('almost-everyone-exempt', findings)!;
            expect(finding.severity).toBe('error');
            expect(finding.message).toContain('every recovery will read zero');
            expect(isPreflightClean(findings)).toBe(false);
        }
    });

    it('errors when someone carrying a requirement is absent from the extract', () => {
        const findings = run([employee({ performed: null })]);
        const finding = codes('missing-from-extract', findings)!;

        expect(finding.severity).toBe('error');
        expect(isPreflightClean(findings)).toBe(false);
    });

    it('does not chase an extract row for an exempt employee', () => {
        const findings = run([
            employee({ performed: null, oldestRatingDate: null, oldestEndorsementDate: null }),
        ]);
        expect(codes('missing-from-extract', findings)).toBeUndefined();
    });

    it('flags extract rows matching nobody on the roster', () => {
        const findings = run([employee({})], { iamatcEmpIds: ['10000001', '99999999'] });
        const finding = codes('extract-orphan', findings)!;

        expect(finding.empIds).toEqual(['99999999']);
    });
});

describe('preflight against the real roster', () => {
    const employees: SarcEmployeeInput[] = SARC_FIXTURES.map((row) => {
        const dates = row.dutyCodes.split(',');
        const dutyCodes: Record<string, string> = {};
        dates.forEach((code, index) => {
            if (code === '') return;
            const day = new Date(2026, 5, 1 + index);
            dutyCodes[
                `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
            ] = code;
        });

        return {
            empId: row.empId,
            name: row.name,
            designation: row.designation,
            team: row.team,
            dutyCodes,
            oldestRatingDate: row.oldestRatingDate,
            oldestEndorsementDate: row.oldestEndorsementDate,
            kolkataJoiningDate: '2000-01-01',
            performed: row.iamatc
                ? {
                      controlling: 0, ojtPractical: 0, ojtiTheory: 0, wsoCmd: 0,
                      instructorExaminer: 0, unitSupervisor: 0, supportiveUnit: 0, alpha: 0,
                  }
                : null,
        };
    });

    const findings = preflight({ period: FIXTURE_PERIOD, employees });

    it('passes the real June–July roster with nothing blocking', () => {
        expect(isPreflightClean(findings)).toBe(true);
    });

    it('finds the eight partial-roster employees', () => {
        expect(codes('partial-roster', findings)!.empIds).toHaveLength(8);
    });

    it('finds the 199 exempt employees', () => {
        expect(codes('exempt-no-rating', findings)!.empIds).toHaveLength(199);
    });

    it('raises no Kolkata joining-date gap', () => {
        expect(codes('no-kolkata-joining-date', findings)).toBeUndefined();
    });

    it('finds no unknown codes, no missing teams and nobody rated-but-unendorsed', () => {
        expect(codes('unknown-duty-code', findings)).toBeUndefined();
        expect(codes('no-team', findings)).toBeUndefined();
        expect(codes('rated-not-endorsed', findings)).toBeUndefined();
    });
});
