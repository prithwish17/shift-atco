/**
 * employee_leave_records → ATTENDANCE-2026 sheet payload.
 *
 * The exact inverse of supabase/functions/fetch-leave-data, which flattens the
 * sheet into the register. Keep the two in step: a category added there needs a
 * case here or its rows silently stop reaching the sheet.
 *
 * Shared by api/leave-sheet-push.ts (the in-app button) and
 * scripts/leave-sheet-push.ts (the CLI), so the two cannot disagree about where
 * a row belongs.
 *
 * See docs/LEAVE_SHEET_WRITEBACK.md for the column map this feeds.
 */

/** Columns both callers must select for the mapping below to work. */
export const LEAVE_RECORD_COLUMNS =
    "emp_id,employee_name,leave_category,source_event_type,event_kind,leave_date,leave_used_on,duty_code,metadata";

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
}

export interface SheetSlotEntry {
    date: string;
    dutyPerformed: string;
    leaveApplied: string;
    /** Targets one pair directly — the only way to reach an undated spare slot. */
    slotIndex?: number;
}

export interface SheetOpeEntry {
    opeDutyDate: string;
    leaveApplied: string;
    /** Names a reserved column ("ELECTION"); omitted means take the next free one. */
    slot?: string;
}

/**
 * The full contract the Apps Script accepts. Sections the register cannot
 * reconstruct are optional rather than empty: an absent section is left alone
 * on the sheet, whereas an empty one is a section with nothing in it.
 */
export interface SheetEmployeePayload {
    employee: { empId: string; name: string };
    casualLeave: string[];
    restrictedHolidays: { date: string; leaveApplied: string }[];
    nationalHolidays: (string | { date: string; mark: string })[];
    closedHolidays: SheetSlotEntry[];
    lastYearCompOff: SheetSlotEntry[];
    opeDuty: SheetOpeEntry[];
    /** Not derivable from employee_leave_records — see docs/LEAVE_SHEET_WRITEBACK.md §9. */
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

/** EMP NO as the sheet keys it: digits, no leading zeros. */
export function normaliseEmpId(value: unknown): string {
    const raw = String(value ?? "").trim();
    const digits = raw.replace(/[^0-9]/g, "");
    return digits ? digits.replace(/^0+(?=\d)/, "") : raw.toUpperCase();
}

/**
 * Group register rows into per-employee sheet sections.
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
    const inYear = (date?: string | null) =>
        !!date && Number(String(date).slice(0, 4)) === options.year;

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
        const dutyDate = str(row.leave_date);
        const usedOn = str(row.leave_used_on);
        const duty = str(row.duty_code) || str(meta.duty_performed);

        switch (row.leave_category) {
            case "CL":
                if (inYear(dutyDate)) entry.casualLeave.push(dutyDate);
                break;

            case "RH":
                if (inYear(dutyDate)) {
                    entry.restrictedHolidays.push({
                        date: dutyDate,
                        leaveApplied: usedOn || str(meta.leave_applied),
                    });
                }
                break;

            case "NH":
                if (inYear(dutyDate)) entry.nationalHolidays.push(dutyDate);
                break;

            // Duty performed on a closed holiday. Not filtered by year: the sheet
            // keys these by the holiday date in the column header, and a slot that
            // does not exist is reported by the script rather than written.
            case "COMP_OFF_EARNED":
            case "COMP_OFF":
                if (dutyDate) {
                    entry.closedHolidays.push({ date: dutyDate, dutyPerformed: duty, leaveApplied: usedOn });
                }
                break;

            case "LAST_YEAR_CH_DUTY":
                if (dutyDate) {
                    entry.lastYearCompOff.push({ date: dutyDate, dutyPerformed: duty, leaveApplied: usedOn });
                }
                break;

            case "OPE": {
                const opeDate = str(meta.ope_duty_date) || dutyDate;
                if (opeDate) entry.opeDuty.push({ opeDutyDate: opeDate, leaveApplied: usedOn });
                break;
            }

            default: {
                // `CH` and the legacy *_COMP_OFF categories record only the day the
                // comp-off was taken, never the holiday it was earned against, so
                // there is no column to put them in.
                const category = str(row.leave_category) || "(none)";
                skipped.set(category, (skipped.get(category) ?? 0) + 1);
            }
        }
    }

    return {
        employees: [...byEmp.values()],
        skipped: [...skipped.entries()]
            .map(([category, count]) => ({ category, count }))
            .sort((a, b) => b.count - a.count),
    };
}
