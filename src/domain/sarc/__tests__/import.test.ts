import { describe, expect, it } from 'vitest';

import { SARC_FIXTURES } from './fixtures';
import { formatDurationWithSeconds, parseDuration } from '../duration';
import { weightedTotal } from '../engine';
import { indexImport, parseCsv, parseIamatcCsv } from '../import';

const HEADER =
    'Sl No,Name,Employee Id,Controlling(A),OJT_Practical(B),TOTAL TIME-IN (A+B),' +
    'OJTI_Theo/Sim(C),WSO/CMD(D),INSTRUCTOR/EXAMINER DUTY(E),Unit SuperVisor(F),' +
    'Supportive Unit(G),Alpha(H),(A+B+C+D+E)+(F+G+H)/2';

describe('parseCsv', () => {
    it('reads quoted fields, escaped quotes and embedded commas', () => {
        expect(parseCsv('a,"b,c","he said ""hi""",d')).toEqual([
            ['a', 'b,c', 'he said "hi"', 'd'],
        ]);
    });

    it('handles CRLF and a trailing newline', () => {
        expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([['a', 'b'], ['c', 'd']]);
    });

    it('strips a leading byte-order mark', () => {
        // Excel round-trips leave a BOM that would otherwise corrupt the first header.
        expect(parseCsv('﻿Employee Id,Name')[0][0]).toBe('Employee Id');
    });

    it('keeps blank rows, so a row index is its source line', () => {
        // Filtering them here would shift every line number reported by the
        // importer, and an issue that names the wrong row is worse than none.
        expect(parseCsv('a,b\n,,\nc,d')).toEqual([['a', 'b'], ['', '', ''], ['c', 'd']]);
    });

    it('keeps a newline inside a quoted field', () => {
        expect(parseCsv('a,"line1\nline2"')).toEqual([['a', 'line1\nline2']]);
    });
});

describe('parseIamatcCsv', () => {
    it('rejects a file that is not an extract', () => {
        const result = parseIamatcCsv('Date,Duty Code\n2026-06-01,M');
        expect(result.ok).toBe(false);
        expect(result.issues[0].code).toBe('missing-column');
        expect(result.rows).toEqual([]);
    });

    it('rejects an empty file', () => {
        expect(parseIamatcCsv('').ok).toBe(false);
        expect(parseIamatcCsv(HEADER).issues[0].code).toBe('no-rows');
    });

    it('reads a row into the eight component columns', () => {
        const result = parseIamatcCsv(
            `${HEADER}\n5,JAGANNATH SAHOO,10012551,37:15:00,107:15:00,144:30:00,24:15:00,,,6:30:00,,,172:00:00`,
        );

        expect(result.ok).toBe(true);
        expect(result.issues).toEqual([]);
        expect(result.rows).toHaveLength(1);

        const [row] = result.rows;
        expect(row.empId).toBe('10012551');
        expect(row.name).toBe('JAGANNATH SAHOO');
        expect(row.hours.controlling).toBe(parseDuration('37:15:00'));
        expect(row.hours.ojtPractical).toBe(parseDuration('107:15:00'));
        expect(row.hours.ojtiTheory).toBe(parseDuration('24:15:00'));
        expect(row.hours.unitSupervisor).toBe(parseDuration('6:30:00'));
        expect(row.statedTotal).toBe(parseDuration('172:00:00'));
        // TOTAL TIME-IN also contains "a+b"; the stated total must not read it.
        expect(row.statedTotal).not.toBe(parseDuration('144:30:00'));
    });

    it('tolerates the extract’s own header drift', () => {
        const drifted = HEADER.replace('Unit SuperVisor(F)', '  unit supervisor (f)  ');
        const result = parseIamatcCsv(`${drifted}\n1,X,10000001,1:00:00,,1:00:00,,,,4:00:00,,,3:00:00`);

        expect(result.ok).toBe(true);
        expect(result.rows[0].hours.unitSupervisor).toBe(parseDuration('4:00:00'));
    });

    it('keeps the first of a duplicated employee and says so', () => {
        const result = parseIamatcCsv(
            `${HEADER}\n1,A,10000001,5:00:00,,5:00:00,,,,,,,5:00:00` +
            `\n2,A again,10000001,9:00:00,,9:00:00,,,,,,,9:00:00`,
        );

        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].hours.controlling).toBe(parseDuration('5:00:00'));
        const issue = result.issues.find((i) => i.code === 'duplicate-emp-id')!;
        expect(issue.severity).toBe('warning');
        expect(issue.line).toBe(3);
    });

    it('counts an unreadable duration as zero and flags the line', () => {
        const result = parseIamatcCsv(`${HEADER}\n1,A,10000001,not-a-time,,,,,,,,,`);

        expect(result.rows[0].hours.controlling).toBe(0);
        const issue = result.issues.find((i) => i.code === 'unparseable-duration')!;
        expect(issue.line).toBe(2);
        expect(issue.message).toContain('not-a-time');
    });

    it('reports a disagreement with the extract’s own total without correcting it', () => {
        const result = parseIamatcCsv(`${HEADER}\n1,A,10000001,10:00:00,,10:00:00,,,,,,,99:00:00`);

        expect(result.rows[0].statedTotal).toBe(parseDuration('99:00:00'));
        expect(result.issues.some((i) => i.code === 'total-mismatch')).toBe(true);
    });

    it('skips rows with no employee ID without complaining', () => {
        const result = parseIamatcCsv(`${HEADER}\n,,,,,,,,,,,,\n1,A,10000001,5:00:00,,5:00:00,,,,,,,5:00:00`);

        expect(result.rows).toHaveLength(1);
        expect(result.issues).toEqual([]);
    });

    it('reports the true source line when the file contains blank lines', () => {
        // The bad row is on line 4. Filtering blanks before numbering would
        // report line 3 and send the operator to a row that looks fine.
        const result = parseIamatcCsv(
            `${HEADER}\n\n\n1,A,10000001,not-a-time,,,,,,,,,`,
        );

        expect(result.issues.find((issue) => issue.code === 'unparseable-duration')!.line).toBe(4);
    });

    it('numbers lines from the header even when the file starts with blanks', () => {
        const result = parseIamatcCsv(`\n\n${HEADER}\n1,A,10000001,not-a-time,,,,,,,,,`);

        expect(result.ok).toBe(true);
        expect(result.issues.find((issue) => issue.code === 'unparseable-duration')!.line).toBe(4);
    });

    it('refuses a file whose durations were exported as raw values', () => {
        // A spreadsheet exporting raw values emits day-fractions: 30 hours
        // becomes "1.25", reads as an hour and a quarter, and the statement
        // comes out ~24x short while looking entirely plausible.
        const result = parseIamatcCsv(
            `${HEADER}\n1,A,10000001,1.25,,1.25,,,,,,,1.25\n2,B,10000002,0.5,,0.5,,,,,,,0.5`,
        );

        const issue = result.issues.find((i) => i.code === 'suspect-duration-format')!;
        expect(issue).toBeDefined();
        expect(issue.severity).toBe('error');
    });

    it('does not cry format on a properly formatted file', () => {
        const result = parseIamatcCsv(`${HEADER}\n1,A,10000001,5:00:00,,5:00:00,,,,,,,5:00:00`);
        expect(result.issues.some((i) => i.code === 'suspect-duration-format')).toBe(false);
    });
});

describe('round-trip against the real extract', () => {
    /**
     * Rebuild the extract from the golden fixture and read it back. This is the
     * shape and formatting the live file actually uses, so it exercises the
     * importer against 317 real rows without a second fixture file.
     */
    const withExtract = SARC_FIXTURES.filter((row) => row.iamatc && row.sheetWeightedTotal);
    const csv = [
        HEADER,
        ...withExtract.map((row, index) => {
            const [a, b, c, d, e, f, g, h] = row.iamatc!;
            return [
                index + 1,
                row.name,
                row.empId,
                a, b,
                formatDurationWithSeconds((parseDuration(a) ?? 0) + (parseDuration(b) ?? 0)),
                c, d, e, f, g, h,
                row.sheetWeightedTotal,
            ].join(',');
        }),
    ].join('\n');

    const result = parseIamatcCsv(csv);

    it('reads every row', () => {
        expect(result.ok).toBe(true);
        expect(result.rows).toHaveLength(withExtract.length);
        expect(withExtract.length).toBe(317);
    });

    it('raises no issues on a well-formed extract', () => {
        expect(result.issues).toEqual([]);
    });

    it('agrees with the extract’s own total on every row', () => {
        const disagreements = result.rows
            .filter((row) => weightedTotal(row.hours) !== row.statedTotal)
            .map((row) => row.empId);

        expect(disagreements).toEqual([]);
    });

    it('indexes by employee ID for assembly', () => {
        const index = indexImport(result);
        expect(index.size).toBe(317);
        expect(index.get('10012551')!.controlling).toBe(parseDuration('37:15:00'));
    });
});
