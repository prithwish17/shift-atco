// ─────────────────────────────────────────────────────────────────────────────
// Pure parsing helpers for fetch-ojt-data.
//
// Kept out of index.ts (which is Deno-only, because of Deno.serve) so the
// ingestion contract with docs/ojt-apps-script/Code.gs can be unit-tested —
// see parse.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type SheetRecord = Record<string, unknown>;

/** Normalised-key lookup so header drift ("Employee Id" → "employee_id") doesn't break the sync. */
export function normalizeKey(key: string) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function buildLookup(record: SheetRecord) {
    const map = new Map<string, unknown>();
    for (const [key, value] of Object.entries(record)) {
        map.set(normalizeKey(key), value);
    }
    return map;
}

export function pickString(lookup: Map<string, unknown>, aliases: string[]) {
    for (const alias of aliases) {
        const value = lookup.get(normalizeKey(alias));
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return "";
}

export function pickInteger(lookup: Map<string, unknown>, aliases: string[]) {
    const raw = pickString(lookup, aliases);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed);
}

/**
 * Duration → decimal hours.
 *   "86:30:00" → 86.5   "12:45" → 12.75   "0:00" → 0   "58.5" → 58.5
 * Durations exceed 24h routinely (210:00:00), so this must never wrap.
 */
export function parseDuration(raw: string): number | null {
    const value = raw.trim();
    if (!value) return null;

    if (value.includes(":")) {
        const parts = value.split(":");
        if (parts.length < 2 || parts.length > 3) return null;

        const nums = parts.map((part) => Number(part.trim()));
        if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

        const [h, m, s = 0] = nums;
        return Math.round((h + m / 60 + s / 3600) * 100) / 100;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed * 100) / 100;
}

export function pickDuration(lookup: Map<string, unknown>, aliases: string[]) {
    const raw = pickString(lookup, aliases);
    if (!raw) return null;
    return parseDuration(raw);
}

const MONTH_ABBR: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Parse "DD-MM-YYYY", "DD/MM/YYYY", "DD-Mon-YYYY" or ISO into "YYYY-MM-DD".
 * Same contract as the parser in fetch-trainee-data.
 */
export function parseISODate(raw: string): string | null {
    const s = raw.trim();
    if (!s) return null;

    const sep = s.includes("/") ? "/" : "-";
    const parts = s.split(sep);

    if (parts.length === 3) {
        const [p1, p2, p3] = parts;
        let day = "", monthRaw = "", year = "";

        if (p3.length === 4) {
            day = p1; monthRaw = p2; year = p3;
        } else if (p1.length === 4 && /^\d+$/.test(p1)) {
            year = p1; monthRaw = p2; day = p3;
        }

        if (year && monthRaw && day) {
            const monthNum = /^\d+$/.test(monthRaw)
                ? monthRaw.padStart(2, "0")
                : (MONTH_ABBR[monthRaw.toLowerCase().slice(0, 3)] || "");
            const dayNum = day.padStart(2, "0");
            const mon = Number(monthNum);
            const dy = Number(dayNum);
            if (monthNum && mon >= 1 && mon <= 12 && dy >= 1 && dy <= 31) {
                return `${year}-${monthNum}-${dayNum}`;
            }
        }
    }

    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getUTCFullYear();
        const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
        const d = String(parsed.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    return null;
}

export function pickDate(lookup: Map<string, unknown>, aliases: string[]) {
    const raw = pickString(lookup, aliases);
    if (!raw) return null;
    return parseISODate(raw);
}

/** "APP + APP(S)" and "APP+APP(S)" must key to the same OJT cycle. */
export function normalizeUnit(value: string) {
    return value.toUpperCase().replace(/\s+/g, "").trim();
}

export const ALIASES = {
    empId: ["emp_id", "employee_id", "employeeid", "Employee Id", "EMP ID"],
    name: ["name", "employee_name", "Name"],
    designation: ["designation", "Designation"],
    unit: ["unit", "UNIT"],
    requiredHours: ["required_hours", "Required Hours"],
    requiredDays: ["required_days", "Required Days"],
    performedHours: ["performed_hours", "Performed Hours"],
    performedDays: ["performed_days", "Performed Days"],
    markingDate: [
        "date_marking_for_ojt", "Date Marking for OJT",
        "date_of_marking_for_ojt", "Date of marking for OJT",
        "marking_date",
    ],
    startDate: [
        "date_of_start_of_ojt", "Date of start of OJT",
        "start_of_ojt", "start_date", "ojt_start_date",
    ],
};

export function extractArray(json: unknown, aliases: string[]): SheetRecord[] | null {
    if (!json || typeof json !== "object") return null;

    const container = json as Record<string, unknown>;
    const nested = (container.data && typeof container.data === "object" && !Array.isArray(container.data))
        ? container.data as Record<string, unknown>
        : null;

    for (const source of [container, nested]) {
        if (!source) continue;
        for (const [key, value] of Object.entries(source)) {
            if (!Array.isArray(value)) continue;
            if (aliases.some((alias) => normalizeKey(alias) === normalizeKey(key))) {
                return value as SheetRecord[];
            }
        }
    }

    return null;
}

export interface ParsedExtractedRow {
    empId: string;
    unit: string;
    employeeName: string;
    designation: string | null;
    requiredHours: number | null;
    requiredDays: number | null;
    performedHours: number | null;
    performedDays: number | null;
    markingDate: string | null;
}

/** Returns null when the row lacks the (emp_id, unit) join key. */
export function parseExtractedRow(record: SheetRecord): ParsedExtractedRow | null {
    const lookup = buildLookup(record);
    const empId = pickString(lookup, ALIASES.empId);
    const unit = normalizeUnit(pickString(lookup, ALIASES.unit));

    if (!empId || !unit) return null;

    return {
        empId,
        unit,
        employeeName: pickString(lookup, ALIASES.name) || empId,
        designation: pickString(lookup, ALIASES.designation) || null,
        requiredHours: pickDuration(lookup, ALIASES.requiredHours),
        requiredDays: pickInteger(lookup, ALIASES.requiredDays),
        performedHours: pickDuration(lookup, ALIASES.performedHours),
        performedDays: pickInteger(lookup, ALIASES.performedDays),
        markingDate: pickDate(lookup, ALIASES.markingDate),
    };
}

export interface ParsedOjtRow {
    empId: string;
    unit: string;
    startDate: string;
}

/** Returns null unless the row carries emp_id, unit and a parseable start date. */
export function parseOjtRow(record: SheetRecord): ParsedOjtRow | null {
    const lookup = buildLookup(record);
    const empId = pickString(lookup, ALIASES.empId);
    const unit = normalizeUnit(pickString(lookup, ALIASES.unit));
    const startDate = pickDate(lookup, ALIASES.startDate);

    if (!empId || !unit || !startDate) return null;

    return { empId, unit, startDate };
}

export function ojtKey(empId: string, unit: string) {
    return `${empId}|${unit}`;
}
