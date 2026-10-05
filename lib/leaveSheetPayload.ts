/**
 * employee_leave_records → ATTENDANCE sheet payload.
 *
 * The inverse of supabase/functions/fetch-leave-data, which flattens the sheet
 * into the register. Keep the two in step: a category added there needs a case
 * here or its rows silently stop reaching the sheet.
 *
 * Shared by lib/leave/sheetPush.ts (the in-app button) and
 * scripts/leave-sheet-push.ts (the CLI), so the two cannot disagree about where
 * a row belongs.
 *
 * Only facts go out. A value the app does not know — a comp-off not yet taken,
 * a duty code it never recorded — is omitted rather than sent as "", because
 * the writer treats a sent value as something to put in the cell. The writer
 * refuses blanks in merge mode as well, but the payload should not rely on it.
 *
 * See docs/LEAVE_SHEET_WRITEBACK.md for the column map this feeds.
 */

/** Columns both callers must select for the mapping below to work. */
export const LEAVE_RECORD_COLUMNS =
    "emp_id,employee_name,leave_category,source_event_type,event_kind,leave_date,leave_used_on,duty_code,metadata,raw_event";

export interface LeaveRecordRow {
    emp_id: string;
    employee_name?: string | null;
    leave_category?: string | null;
    source_event_type?: string | null;
    event_kind?: string | null;
    leave_date?: string | null;
    leave_used_on?: string | null;
    duty_code?: string | null;
    metadata?: Record<string, unknown> | string | null;
    raw_event?: Record<string, unknown> | string | null;
}

export interface SheetSlotEntry {
    date: string;
    dutyPerformed?: string;
    leaveApplied?: string;
    /** Targets one pair directly — the only way to reach an undated spare slot. */
    slotIndex?: number;
}

export interface SheetOpeEntry {
    opeDutyDate: string;
    leaveApplied?: string;
    /** Names a reserved column ("ELECTION"); omitted means take the next free one. */
    slot?: string;
}

export interface SheetRhEntry {
    /** The holiday the RH was declared against. */
    date: string;
    /** The day it was actually taken, when that differs or is known. */
    leaveApplied?: string;
}

/**
 * The full contract the Apps Script accepts. Sections the register cannot
 * reconstruct are optional rather than empty: an absent section is left alone
 * on the sheet, whereas an empty one is a section with nothing in it.
 */
export interface SheetEmployeePayload {
    employee: { empId: string; name: string };
    casualLeave: string[];
    restrictedHolidays: SheetRhEntry[];
    nationalHolidays: (string | { date: string; mark: string })[];
    closedHolidays: SheetSlotEntry[];
    lastYearCompOff: SheetSlotEntry[];
    opeDuty: SheetOpeEntry[];
    /** Only sent when the app holds half-day CLs; the feed never reads them back. */
    halfCasualLeave?: string[];
    opePreviousStation?: SheetOpeEntry[];
}

export interface BuildSheetPayloadResult {
    employees: SheetEmployeePayload[];
    /** Rows the sheet has no column for, by category — surface, never swallow. */
    skipped: { category: string; count: number }[];
}

function asObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object") return value as Record<string, unknown>;
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
        } catch {
            return {};
        }
    }
    return {};
}

function str(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

/** `{ key: value }` when value is non-empty, else `{}` — for spreading. */
function present<K extends string>(key: K, value: string): Partial<Record<K, string>> {
    return value ? ({ [key]: value } as Record<K, string>) : {};
}

function yearOf(date: string): number {
    return Number(String(date).slice(0, 4));
}

/** EMP NO as the sheet keys it: digits, no leading zeros. */
export function normaliseEmpId(value: unknown): string {
    const raw = String(value ?? "").trim();
    const digits = raw.replace(/[^0-9]/g, "");
    return digits ? digits.replace(/^0+(?=\d)/, "") : raw.toUpperCase();
}

/**
 * Group register rows into per-employee sheet sections for one workbook year.
 *
 * The one thing that is easy to get backwards: for comp-off categories
 * `leave_date` is the DUTY date and the day off is `leave_used_on`. For plain
 * leave rows `leave_date` is the leave day itself.
 */
export function buildSheetPayload(
    rows: LeaveRecordRow[],
    options: { year: number },
): BuildSheetPayloadResult {
    const byEmp = new Map<string, SheetEmployeePayload>();
    const skipped = new Map<string, number>();
    const inYear = (date?: string | null) => !!date && yearOf(date) === options.year;
    const skip = (label: string) => skipped.set(label, (skipped.get(label) ?? 0) + 1);

    const bucket = (row: LeaveRecordRow): SheetEmployeePayload => {
        const key = String(row.emp_id);
        let entry = byEmp.get(key);
        if (!entry) {
            entry = {
                employee: { empId: normaliseEmpId(row.emp_id), name: str(row.employee_name) },
                casualLeave: [],
                restrictedHolidays: [],
                nationalHolidays: [],
                closedHolidays: [],
                lastYearCompOff: [],
                opeDuty: [],
            };
            byEmp.set(key, entry);
        }
        return entry;
    };

    for (const row of rows) {
        if (!row?.emp_id) continue;

        const entry = bucket(row);
        const meta = asObject(row.metadata);
        const rawEvent = asObject(row.raw_event);
        const dutyDate = str(row.leave_date);
        const usedOn = str(row.leave_used_on);
        const duty = str(row.duty_code) || str(meta.duty_performed);

        switch (row.leave_category) {
            case "CL":
                if (inYear(dutyDate)) entry.casualLeave.push(dutyDate);
                break;

            case "CL_1ST":
            case "CL_2ND":
                if (inYear(dutyDate)) (entry.halfCasualLeave ??= []).push(dutyDate);
                break;

            case "RH": {
                // Keyed by the holiday it was declared against. Older backfilled
                // rows carry the day taken in leave_date and the holiday in
                // metadata.rh_date.
                const rhDate = str(meta.rh_date) || dutyDate;
                if (inYear(rhDate)) {
                    entry.restrictedHolidays.push({
                        date: rhDate,
                        ...present("leaveApplied", usedOn || str(meta.leave_applied)),
                    });
                }
                break;
            }

            case "NH":
                if (inYear(dutyDate)) entry.nationalHolidays.push(dutyDate);
                break;

            // Duty performed on a closed holiday. This year's holidays have their
            // own dated columns; last year's that are still open are carried in
            // the "LAST YEAR C-OFF" block. Older ones have no home on this sheet.
            case "COMP_OFF_EARNED":
            case "COMP_OFF": {
                if (!dutyDate) break;
                // The legacy feed's "last year" entries ({dutyPerformed,
                // leaveApplied}) lost their holiday date on the way in: a shift
                // code in the duty cell leaves leave_date as the day taken. There
                // is no telling which pair they came from, and guessing by date
                // could land in the wrong holiday's column.
                if ("dutyPerformed" in rawEvent && !("date" in rawEvent)) {
                    skip(`${row.leave_category} (last-year entry, holiday date unknown)`);
                    break;
                }
                const slot: SheetSlotEntry = {
                    date: dutyDate,
                    ...present("dutyPerformed", duty),
                    ...present("leaveApplied", usedOn),
                };
                if (yearOf(dutyDate) === options.year) {
                    entry.closedHolidays.push(slot);
                } else if (
                    yearOf(dutyDate) === options.year - 1 &&
                    (!usedOn || yearOf(usedOn) >= options.year)
                ) {
                    entry.lastYearCompOff.push(slot);
                } else {
                    skip(`${row.leave_category} (${yearOf(dutyDate)})`);
                }
                break;
            }

            case "LAST_YEAR_CH_DUTY":
                if (dutyDate) {
                    entry.lastYearCompOff.push({
                        date: dutyDate,
                        ...present("dutyPerformed", duty),
                        ...present("leaveApplied", usedOn),
                    });
                }
                break;

            case "OPE": {
                // fetch-leave-data files a "last year" entry whose duty column
                // holds a date under OPE as well. It belongs back in the
                // last-year block, in the spare pair whose duty cell is that date.
                if (!("opeDutyDate" in rawEvent) && "dutyPerformed" in rawEvent) {
                    if (dutyDate) {
                        entry.lastYearCompOff.push({
                            date: dutyDate,
                            dutyPerformed: dutyDate,
                            ...present("leaveApplied", usedOn),
                        });
                    }
                    break;
                }

                const opeDate = str(meta.ope_duty_date) || dutyDate;
                if (opeDate) {
                    entry.opeDuty.push({
                        opeDutyDate: opeDate,
                        ...present("leaveApplied", usedOn),
                    });
                }
                break;
            }

            default:
                // `CH` and the legacy *_COMP_OFF categories record only the day the
                // comp-off was taken, never the holiday it was earned against, so
                // there is no column to put them in. EL, HPL and the rest have no
                // column on this sheet at all.
                skip(str(row.leave_category) || "(none)");
        }
    }

    return {
        employees: [...byEmp.values()],
        skipped: [...skipped.entries()]
            .map(([category, count]) => ({ category, count }))
            .sort((a, b) => b.count - a.count),
    };
}
