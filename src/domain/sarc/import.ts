/**
 * IAMATC extract import.
 *
 * The extract is the one SARC input with no equivalent in the app — it records
 * actual time on position, whereas `working_hours_cache` holds rostered hours
 * derived from duty codes, a different quantity.
 *
 * CSV only, parsed here rather than through a dependency. The only npm-published
 * SheetJS build carries unpatched advisories, and every other input to this
 * module already arrives as CSV; `exceljs` is the clean addition if operators
 * ever need `.xlsx`.
 *
 * Nothing is silently corrected. Where our own weighted total disagrees with
 * the one the extract prints, both are reported and the extract's is kept —
 * the header formula is not the whole rule (see `weightedTotal`), so a
 * disagreement more likely means a changed export than a bad row.
 */

import { parseDuration } from './duration';
import { weightedTotal } from './engine';
import type { IamatcHours, Seconds } from './types';

/* ─── CSV ─────────────────────────────────────────────────────────────────── */

/**
 * Minimal RFC 4180 reader: quoted fields, escaped quotes, CRLF, and embedded
 * commas and newlines. Returns rows of raw strings; no type coercion.
 *
 * Blank rows are **kept**, so a row's index is its line in the source file.
 * Filtering them here would shift every line number reported afterwards, and
 * an issue that names the wrong row is worse than one that names none —
 * the row it points at may look perfectly fine. Callers skip blanks themselves.
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;

    // A leading BOM survives Excel round-trips and would corrupt the first header.
    const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        if (quoted) {
            if (char !== '"') cell += char;
            else if (source[i + 1] === '"') { cell += '"'; i += 1; }
            else quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === ',') { row.push(cell); cell = ''; }
        else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (char !== '\r') cell += char;
    }
    if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }

    return rows;
}

/** True for a row that carries no content — a spacer or a stray newline. */
function isBlankRow(cells: readonly string[]): boolean {
    return cells.every((value) => value.trim() === '');
}

/* ─── Column mapping ──────────────────────────────────────────────────────── */

/**
 * Header fragments identifying each column, lower-cased and matched as
 * substrings so the extract's own spacing and punctuation can drift
 * (`Unit SuperVisor`, `INSTRUCTOR/EXAMINER DUTY(E)`) without breaking the import.
 */
const COLUMN_MATCHERS = {
    empId: ['employee id', 'emp id', 'emp_id'],
    name: ['name'],
    controlling: ['controlling'],
    ojtPractical: ['ojt_practical', 'ojt practical'],
    ojtiTheory: ['ojti'],
    wsoCmd: ['wso/cmd', 'wso'],
    instructorExaminer: ['instructor'],
    unitSupervisor: ['supervisor'],
    supportiveUnit: ['supportive'],
    alpha: ['alpha'],
    statedTotal: ['(a+b+c+d+e)'],
} as const;

type ColumnKey = keyof typeof COLUMN_MATCHERS;

/** Columns without which the import cannot proceed. */
const REQUIRED_COLUMNS: ColumnKey[] = ['empId', 'controlling'];

function locateColumns(header: readonly string[]): Partial<Record<ColumnKey, number>> {
    const cells = header.map((cell) => cell.trim().toLowerCase());
    const found: Partial<Record<ColumnKey, number>> = {};

    for (const [key, fragments] of Object.entries(COLUMN_MATCHERS) as [
        ColumnKey,
        readonly string[],
    ][]) {
        // `TOTAL TIME-IN (A+B)` also contains "a+b"; the stated-total column is
        // matched on its full signature so the two cannot be confused.
        const index = cells.findIndex((cell) =>
            fragments.some((fragment) => cell.includes(fragment)),
        );
        if (index !== -1) found[key] = index;
    }

    // "name" is a substring of nothing else here, but Employee Id must win if a
    // header happens to read "Employee Id Name".
    if (found.name != null && found.name === found.empId) delete found.name;

    return found;
}

/* ─── Result ──────────────────────────────────────────────────────────────── */

export interface IamatcImportRow {
    empId: string;
    name: string | null;
    hours: IamatcHours;
    /** The extract's own `(A+B+C+D+E)+(F+G+H)/2` column, when present. */
    statedTotal: Seconds | null;
    /** 1-based line in the source file, for pointing an operator at a bad row. */
    line: number;
}

export interface IamatcImportIssue {
    code:
        | 'missing-column'
        | 'no-rows'
        | 'blank-emp-id'
        | 'duplicate-emp-id'
        | 'unparseable-duration'
        | 'suspect-duration-format'
        | 'total-mismatch';
    severity: 'error' | 'warning';
    message: string;
    line?: number;
}

export interface IamatcImport {
    rows: IamatcImportRow[];
    issues: IamatcImportIssue[];
    /** False when the file could not be read as an IAMATC extract at all. */
    ok: boolean;
}

/** Index the result for the assembly step. */
export function indexImport(result: IamatcImport): Map<string, IamatcHours> {
    return new Map(result.rows.map((row) => [row.empId, row.hours]));
}

export function parseIamatcCsv(text: string): IamatcImport {
    const issues: IamatcImportIssue[] = [];
    const table = parseCsv(text);

    // Nothing is filtered out of `table`: a row's index is its line in the
    // source file, which is the only way a reported line number can be trusted.
    const headerIndex = table.findIndex((cells) => !isBlankRow(cells));

    if (headerIndex === -1 || table.length <= headerIndex + 1) {
        return {
            rows: [],
            ok: false,
            issues: [{ code: 'no-rows', severity: 'error', message: 'The file has no data rows.' }],
        };
    }

    const columns = locateColumns(table[headerIndex]);

    const missing = REQUIRED_COLUMNS.filter((key) => columns[key] == null);
    if (missing.length > 0) {
        return {
            rows: [],
            ok: false,
            issues: [
                {
                    code: 'missing-column',
                    severity: 'error',
                    message: `Not an IAMATC extract — missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`,
                },
            ],
        };
    }

    const rows: IamatcImportRow[] = [];
    const seen = new Map<string, number>();

    // A real extract writes elapsed time as `h:mm:ss`. If not one duration cell
    // in the file contains a colon, it was almost certainly exported with raw
    // values, where a spreadsheet emits day-fractions — 30 hours becomes
    // "1.25", is read as an hour and a quarter, and the whole statement comes
    // out roughly 24x short while still looking entirely plausible.
    let sawFormattedDuration = false;

    table.slice(headerIndex + 1).forEach((cells, offset) => {
        // Absolute position in the file, 1-based — blank rows still occupy a line.
        const line = headerIndex + offset + 2;
        const empId = (cells[columns.empId!] ?? '').trim();
        if (!empId) return; // blank, spacer and trailing rows are not worth reporting

        const previous = seen.get(empId);
        if (previous != null) {
            issues.push({
                code: 'duplicate-emp-id',
                severity: 'warning',
                message: `Employee ${empId} appears on lines ${previous} and ${line}; the first is used.`,
                line,
            });
            return;
        }
        seen.set(empId, line);

        const read = (key: ColumnKey): Seconds => {
            const index = columns[key];
            if (index == null) return 0;
            const raw = (cells[index] ?? '').trim();
            if (raw === '') return 0;
            if (raw.includes(':')) sawFormattedDuration = true;
            const parsed = parseDuration(raw);
            if (parsed == null) {
                issues.push({
                    code: 'unparseable-duration',
                    severity: 'warning',
                    message: `Employee ${empId}: could not read "${raw}" as a duration; counted as zero.`,
                    line,
                });
                return 0;
            }
            return parsed;
        };

        const hours: IamatcHours = {
            controlling: read('controlling'),
            ojtPractical: read('ojtPractical'),
            ojtiTheory: read('ojtiTheory'),
            wsoCmd: read('wsoCmd'),
            instructorExaminer: read('instructorExaminer'),
            unitSupervisor: read('unitSupervisor'),
            supportiveUnit: read('supportiveUnit'),
            alpha: read('alpha'),
        };

        const statedTotal =
            columns.statedTotal == null
                ? null
                : parseDuration((cells[columns.statedTotal] ?? '').trim());

        if (statedTotal != null && weightedTotal(hours) !== statedTotal) {
            issues.push({
                code: 'total-mismatch',
                severity: 'warning',
                message:
                    `Employee ${empId}: the extract's own total disagrees with the one computed ` +
                    `from its columns. The extract's is used. If this appears on many rows, the ` +
                    `extract's formula has changed and the engine needs updating.`,
                line,
            });
        }

        rows.push({
            empId,
            name: columns.name == null ? null : (cells[columns.name] ?? '').trim() || null,
            hours,
            statedTotal,
            line,
        });
    });

    if (rows.length === 0) {
        issues.push({
            code: 'no-rows',
            severity: 'error',
            message: 'No rows carried an employee ID.',
        });
    } else if (!sawFormattedDuration) {
        issues.push({
            code: 'suspect-duration-format',
            severity: 'error',
            message:
                'No duration in this file is written as h:mm:ss. It was probably exported ' +
                'with raw values rather than formatted times, in which case every figure ' +
                'here is around 24 times too small. Re-export with the durations formatted.',
        });
    }

    return { rows, issues, ok: rows.length > 0 };
}
