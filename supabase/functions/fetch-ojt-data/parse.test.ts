import { describe, expect, it } from 'vitest';

import { OJT_FIXTURES } from '../../../src/domain/ojt/__tests__/fixtures';
import {
    ALIASES,
    extractArray,
    normalizeUnit,
    parseDuration,
    parseExtractedRow,
    parseISODate,
    parseOjtRow,
    pickString,
    buildLookup,
} from './parse';

/**
 * The payload docs/ojt-apps-script/Code.gs produces: hours as decimals, dates
 * already ISO, units normalised, both tabs in one object.
 */
function appsScriptPayload() {
    return {
        generated_at: '2026-08-11T13:00:00.000Z',
        extracted: OJT_FIXTURES.map((row) => ({
            emp_id: row.empId,
            name: row.name,
            designation: 'JE',
            unit: row.unit,
            required_hours: row.input.requiredHours,
            required_days: row.input.requiredDays,
            performed_hours: row.input.performedHours,
            performed_days: row.input.performedDays,
            date_marking_for_ojt: '2026-04-01',
        })),
        ojt: OJT_FIXTURES.map((row) => ({
            emp_id: row.empId,
            name: row.name,
            unit: row.unit,
            date_of_start_of_ojt: row.input.startDate,
        })),
    };
}

describe('Apps Script → fetch-ojt-data contract', () => {
    const payload = appsScriptPayload();

    it('finds both tabs in the payload', () => {
        expect(extractArray(payload, ['extracted', 'extracted_data', 'extractedData'])).toHaveLength(132);
        expect(extractArray(payload, ['ojt', 'ojt_data', 'ojtData'])).toHaveLength(132);
    });

    it('fails loudly rather than half-syncing when a tab is missing', () => {
        expect(extractArray({ extracted: [] }, ['ojt', 'ojt_data'])).toBeNull();
        expect(extractArray({}, ['extracted'])).toBeNull();
    });

    it('accepts the payload nested under a data envelope', () => {
        expect(extractArray({ data: { extracted: [{ a: 1 }] } }, ['extracted'])).toHaveLength(1);
    });

    it('round-trips every row back to its fixture values', () => {
        const extracted = extractArray(payload, ['extracted'])!;
        const ojt = extractArray(payload, ['ojt'])!;

        expect(extracted.map(parseExtractedRow).filter(Boolean)).toHaveLength(132);
        expect(ojt.map(parseOjtRow).filter(Boolean)).toHaveLength(132);

        extracted.forEach((raw, i) => {
            const parsed = parseExtractedRow(raw)!;
            const fixture = OJT_FIXTURES[i];

            expect(parsed.empId).toBe(fixture.empId);
            expect(parsed.unit).toBe(fixture.unit);
            expect(parsed.requiredHours).toBe(fixture.input.requiredHours);
            expect(parsed.requiredDays).toBe(fixture.input.requiredDays);
            expect(parsed.performedHours).toBe(fixture.input.performedHours);
            expect(parsed.performedDays).toBe(fixture.input.performedDays);
        });

        ojt.forEach((raw, i) => {
            expect(parseOjtRow(raw)!.startDate).toBe(OJT_FIXTURES[i].input.startDate);
        });
    });

    it('joins the two tabs on emp id + unit with nothing left over', () => {
        const extracted = extractArray(payload, ['extracted'])!.map(parseExtractedRow);
        const starts = new Map(
            extractArray(payload, ['ojt'])!
                .map(parseOjtRow)
                .map((r) => [`${r!.empId}|${r!.unit}`, r!.startDate]),
        );

        const unmatched = extracted.filter((r) => !starts.has(`${r!.empId}|${r!.unit}`));
        expect(unmatched).toHaveLength(0);
    });

    it('keeps concurrent cycles for one employee apart', () => {
        const rows = extractArray(payload, ['extracted'])!
            .map(parseExtractedRow)
            .filter((r) => r!.empId === '10003134');

        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r!.unit).sort()).toEqual(['ADC', 'APP+APP(S)']);
    });
});

describe('tolerance for how the sheet might actually arrive', () => {
    it('reads durations as strings when the Apps Script is bypassed', () => {
        expect(parseDuration('86:30:00')).toBe(86.5);
        expect(parseDuration('12:45')).toBe(12.75);
        expect(parseDuration('0:00')).toBe(0);
        expect(parseDuration('210:00:00')).toBe(210);
        expect(parseDuration('58.5')).toBe(58.5);
    });

    it('never wraps a duration past 24 hours', () => {
        expect(parseDuration('90:00')).toBe(90);
        expect(parseDuration('90:00')).not.toBe(18);
    });

    it('rejects junk instead of coercing it to zero', () => {
        expect(parseDuration('')).toBeNull();
        expect(parseDuration('n/a')).toBeNull();
        expect(parseDuration('-5:00')).toBeNull();
    });

    it('reads the date formats the workbook mixes', () => {
        expect(parseISODate('01-05-2026')).toBe('2026-05-01');
        expect(parseISODate('01/05/2026')).toBe('2026-05-01');
        expect(parseISODate('2026-05-01')).toBe('2026-05-01');
        expect(parseISODate('23-Feb-2026')).toBe('2026-02-23');
        expect(parseISODate('')).toBeNull();
    });

    it('survives raw sheet headers if the script is edited to pass them through', () => {
        const row = {
            'Employee Id': 10024032,
            'Name': 'ABHISHEK MUKHERJEE',
            'UNIT': 'ADC',
            'Required Hours': '90',
            'Required Days': '45',
            'Performed Hours': '58:30:00',
            'Performed Days': '96',
        };

        const parsed = parseExtractedRow(row)!;
        expect(parsed.empId).toBe('10024032');
        expect(parsed.requiredHours).toBe(90);
        expect(parsed.performedHours).toBe(58.5);
        expect(parsed.performedDays).toBe(96);
    });

    it('treats spacing differences in a unit as the same cycle', () => {
        expect(normalizeUnit('APP + APP(S)')).toBe('APP+APP(S)');
        expect(normalizeUnit('acc+acc(s)')).toBe('ACC+ACC(S)');
    });

    it('drops rows missing the join key rather than inventing one', () => {
        expect(parseExtractedRow({ name: 'No id', unit: 'ADC' })).toBeNull();
        expect(parseExtractedRow({ emp_id: '123', name: 'No unit' })).toBeNull();
        expect(parseOjtRow({ emp_id: '123', unit: 'ADC' })).toBeNull();
    });

    it('reads an employee id supplied as a number', () => {
        expect(pickString(buildLookup({ emp_id: 10023136 }), ALIASES.empId)).toBe('10023136');
    });
});
