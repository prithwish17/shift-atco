/**
 * Regenerate src/domain/sarc/__tests__/fixtures.ts from a SARC workbook export.
 *
 *   npx tsx scripts/generate-sarc-fixtures.ts <export-dir> [exported-YYYY-MM-DD]
 *
 * `<export-dir>` holds the five tabs exported as CSV. Files are matched on the
 * tab name appearing anywhere in the filename, so Google Sheets' default
 * "SARC (…) - Hours Required.csv" works untouched.
 *
 * The period and both month lengths are read from the workbook's own Start Date
 * and End Date cells, so a new period regenerates without editing this script.
 *
 * The accepted departures from the sheet live in sarc.test.ts, NOT here —
 * regenerating must never silently absorb a new one.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* ─── CSV ─────────────────────────────────────────────────────────────────── */

function parseCsv(path: string): string[][] {
    const text = readFileSync(path, 'utf8');
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quoted) {
            if (char !== '"') cell += char;
            else if (text[i + 1] === '"') { cell += '"'; i += 1; }
            else quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === ',') { row.push(cell); cell = ''; }
        else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (char !== '\r') cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

function findCsv(dir: string, tab: string): string[][] {
    const matches = readdirSync(dir).filter(
        (name) => name.toLowerCase().endsWith('.csv') && name.includes(tab),
    );
    if (matches.length === 0) throw new Error(`No CSV in ${dir} matching "${tab}"`);
    if (matches.length > 1) throw new Error(`Ambiguous CSVs for "${tab}": ${matches.join(', ')}`);
    return parseCsv(join(dir, matches[0]));
}

/* ─── Dates ───────────────────────────────────────────────────────────────── */

/** Accepts `dd-mm-yyyy` and `yyyy-mm-dd`; returns ISO or null. */
function toIso(raw: string | undefined): string | null {
    const value = (raw ?? '').trim();
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

const daysInMonth = (iso: string) => {
    const [year, month] = iso.split('-').map(Number);
    return new Date(year, month, 0).getDate();
};

/* ─── Generate ────────────────────────────────────────────────────────────── */

const exportDir = resolve(process.argv[2] ?? '.');
const exportedOn = process.argv[3] ?? new Date().toISOString().slice(0, 10);

const month1 = findCsv(exportDir, '1st Month Attendance');
const month2 = findCsv(exportDir, '2nd Month Attendance');
const hoursRequired = findCsv(exportDir, 'Hours Required');
const iamatc = findCsv(exportDir, 'IAMATC_Extract');
const annexure = findCsv(exportDir, 'Stress Recovery');

// Start Date / End Date live in the Hours Required tab's W2 / X2.
const START = toIso(hoursRequired[1]?.[22]);
const END = toIso(hoursRequired[1]?.[23]);
if (!START || !END) {
    throw new Error('Could not read Start Date / End Date from the Hours Required tab (W2/X2)');
}
if (!START.endsWith('-01')) throw new Error(`Period must start on the 1st of a month: ${START}`);
if (Number(END.slice(-2)) !== daysInMonth(END)) {
    throw new Error(`Period must end on the last day of a month: ${END}`);
}

const MONTH1_DAYS = daysInMonth(START);
const MONTH2_DAYS = daysInMonth(END);
const PERIOD_DAYS = MONTH1_DAYS + MONTH2_DAYS;

/** Attendance day columns start at F. */
const FIRST_DAY_COLUMN = 5;

const byId = (rows: string[][], skip: number, column: number) =>
    new Map(rows.slice(skip).filter((row) => row[column]?.trim()).map((row) => [row[column].trim(), row]));

const M1 = byId(month1, 2, 0);
const M2 = byId(month2, 2, 0);
const IA = byId(iamatc, 1, 2);
const AN = byId(annexure, 5, 1);

const quote = (value: string | null) => (value == null ? 'null' : JSON.stringify(value));

const entries: string[] = [];
for (const row of hoursRequired.slice(1)) {
    const empId = row[0]?.trim();
    if (!empId) continue;

    const first = M1.get(empId);
    const second = M2.get(empId);

    const codes: string[] = [];
    for (let day = 0; day < MONTH1_DAYS; day += 1) {
        codes.push((first?.[FIRST_DAY_COLUMN + day] ?? '').trim());
    }
    for (let day = 0; day < MONTH2_DAYS; day += 1) {
        codes.push((second?.[FIRST_DAY_COLUMN + day] ?? '').trim());
    }
    if (codes.length !== PERIOD_DAYS) throw new Error(`${empId}: expected ${PERIOD_DAYS} codes`);
    if (codes.some((code) => code.includes(','))) {
        throw new Error(`${empId}: duty code contains a comma, which the fixture format cannot carry`);
    }

    const extract = IA.get(empId);
    const statement = AN.get(empId);

    entries.push([
        '    {',
        `        empId: ${quote(empId)},`,
        `        name: ${quote(row[1] ?? '')},`,
        `        designation: ${quote(statement?.[3]?.trim() || null)},`,
        `        team: ${quote((first?.[1] ?? second?.[1] ?? '').trim() || null)},`,
        `        dutyCodes: ${JSON.stringify(codes.join(','))},`,
        `        oldestRatingDate: ${quote(toIso(row[6]))},`,
        `        oldestEndorsementDate: ${quote(toIso(row[7]))},`,
        `        included: ${row[5]?.trim() === 'Yes'},`,
        `        iamatc: ${
            extract
                ? `[${[3, 4, 6, 7, 8, 9, 10, 11].map((i) => JSON.stringify((extract[i] ?? '').trim())).join(', ')}]`
                : 'null'
        },`,
        `        sheetWeightedTotal: ${quote(extract ? (extract[12] ?? '').trim() || null : null)},`,
        `        sheetRequired: ${quote((row[2] ?? '').trim())},`,
        `        sheetGeneral: ${row[3]?.trim() === 'Yes'},`,
        `        sheetAdjusted: ${quote((row[8] ?? '').trim())},`,
        `        sheetRequirement: ${quote((row[9] ?? '').trim() || null)},`,
        `        sheetPerformed: ${quote(statement?.[5]?.trim() || null)},`,
        `        sheetRecovery: ${statement?.[6]?.trim() ? parseFloat(statement[6]) / 100 : 'null'},`,
        '    },',
    ].join('\n'));
}

const header = `/**
 * Golden fixtures — every employee of the SARC workbook for the ${START} to
 * ${END} period, joined across all five tabs of the export.
 *
 * GENERATED FILE. Regenerate rather than hand-editing:
 *
 *     npx tsx scripts/generate-sarc-fixtures.ts <export-dir> ${exportedOn}
 *
 * The accepted departures from the sheet live in ./sarc.test.ts, deliberately
 * hand-maintained: regenerating this file must never silently absorb a new one.
 *
 * The \`sheet*\` fields are the workbook's own computed columns and act as the
 * oracle — they are what the section works from today, so the engine has to
 * account for every difference against them.
 *
 * Two are NEGATIVE oracles, kept because the sheet is wrong:
 *
 *   \`sheetPerformed\` is the issued Annexure's Hours Performed column, which
 *   takes the weighted grand total for everyone. The General/Shift split the
 *   sheet's own formula describes was never actually applied (§2.7), so for a
 *   General employee whose A+B differs from the grand total the engine must
 *   NOT reproduce this value.
 *
 *   \`sheetRequirement\` for an employee rated exactly on the period start is
 *   above the cap the sheet enforces everywhere else (§2.6).
 */

import type { SarcPeriod } from '../types';

export interface SarcFixtureRow {
    empId: string;
    name: string;
    designation: string | null;
    /** Roster team. \`G\` is the general team. */
    team: string | null;
    /** One duty code per day of FIXTURE_PERIOD, comma-separated. Empty = not on roster. */
    dutyCodes: string;
    oldestRatingDate: string | null;
    oldestEndorsementDate: string | null;
    included: boolean;
    /** IAMATC columns A,B,C,D,E,F,G,H as \`[h]:mm:ss\`. Null = absent from the extract. */
    iamatc: [string, string, string, string, string, string, string, string] | null;
    /** The extract's own \`(A+B+C+D+E)+(F+G+H)/2\` column. */
    sheetWeightedTotal: string | null;

    /** 'Hours Required' column C — the accrual. */
    sheetRequired: string;
    /** Column D — the >50% general flag. */
    sheetGeneral: boolean;
    /** Column I — the accrual after the cap. */
    sheetAdjusted: string;
    /** Column J — the requirement after the rating pro-rate. Null = exempt. */
    sheetRequirement: string | null;
    /** Annexure 'Hours Performed'. NEGATIVE oracle — see above. */
    sheetPerformed: string | null;
    /** Annexure 'Recovery', as a fraction of the requirement. */
    sheetRecovery: number | null;
}

/** The period the workbook was evaluated for. */
export const FIXTURE_PERIOD: SarcPeriod = { start: '${START}', end: '${END}' };

/** Days in FIXTURE_PERIOD — the length every \`dutyCodes\` string expands to. */
export const FIXTURE_PERIOD_DAYS = ${PERIOD_DAYS};

/** Date the source workbook was exported. */
export const FIXTURE_EXPORTED = '${exportedOn}';

export const SARC_FIXTURES: SarcFixtureRow[] = [
`;

const target = resolve('src/domain/sarc/__tests__/fixtures.ts');
writeFileSync(target, `${header}${entries.join('\n')}\n];\n`);
console.log(
    `Wrote ${entries.length} fixtures for ${START} → ${END} ` +
    `(${MONTH1_DAYS} + ${MONTH2_DAYS} = ${PERIOD_DAYS} days) to ${target}`,
);
