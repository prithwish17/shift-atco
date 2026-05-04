import { eachDayOfInterval, endOfMonth, format, isSameMonth, startOfMonth } from "date-fns";

import { parseRosterDate, type RosterEntry } from "@/hooks/useRosters";
import { getTeamDutyForDateKey } from "@/lib/teamDutyRotation";

export interface RosterDateColumn {
  isoDate: string;
  date: string;
  day: string;
  shifts: string[];
  shiftCodes: string[];
  colStart: number;
}

export interface RosterMatrixRow {
  slNo: string;
  unit: string;
  cells: string[];
  rowType: "extra" | "normal" | "general" | "summary" | "empty" | "header" | "ownTeam";
  cellColors?: string[];
}

export interface RosterMatrixData {
  monthLabel: string;
  dates: RosterDateColumn[];
  rows: RosterMatrixRow[];
}

export const SHIFT_ORDER = ["Morning", "Afternoon", "Night"];
export const SHIFT_NAME_TO_DUTY_CODE: Record<string, "M" | "A" | "N"> = {
  Morning: "M",
  Afternoon: "A",
  Night: "N",
};
const ROTATION_TEAMS = ["A", "B", "C", "D", "E"];
const SHIFT_CODE_FALLBACK: Record<string, string> = {
  Morning: "M",
  Afternoon: "A",
  Night: "N",
};
const EXCLUDED_ROSTER_UNITS = new Set(["EXTRA DUTY", "NORMAL DUTY", "GENERAL DUTY"]);

type ParsedRosterEntry = RosterEntry & {
  normalizedDate: string;
  parsedDate: Date;
  normalizedShift: string;
  normalizedUnit: string;
};

function normalizeShift(value?: string | null): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "morning") return "Morning";
  if (normalized === "afternoon") return "Afternoon";
  if (normalized === "night") return "Night";
  return String(value || "").trim();
}

function normalizeUnit(value?: string | null): string {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeUnitKey(value?: string | null) {
  return normalizeUnit(value).toUpperCase();
}

function getCanonicalUnitLabel(value?: string | null) {
  return normalizeUnit(value);
}

function getShiftTeamCode(isoDate: string, shiftName: string, visibleEntries: ParsedRosterEntry[]) {
  const dutyCode = SHIFT_NAME_TO_DUTY_CODE[shiftName];
  const rotatedTeam = ROTATION_TEAMS.find((teamKey) => getTeamDutyForDateKey(teamKey, isoDate) === dutyCode);
  if (rotatedTeam) return rotatedTeam;

  const rosterTeam = visibleEntries.find(
    (entry) => entry.normalizedDate === isoDate && entry.normalizedShift === shiftName,
  )?.team;

  return String(rosterTeam || "").trim() || SHIFT_CODE_FALLBACK[shiftName];
}

function classifyRow(unit: string): RosterMatrixRow["rowType"] {
  const normalized = unit.toUpperCase();
  if (normalized.includes("EXTRA")) return "extra";
  if (normalized.includes("GENERAL")) return "general";
  if (!normalized) return "empty";
  if (normalized.includes("NORMAL")) return "normal";
  return "summary";
}

function getCellValue(entries: ParsedRosterEntry[]): string {
  const values = entries
    .map((entry) => String(entry.employee_name || entry.position || "").trim())
    .filter(Boolean);

  return Array.from(new Set(values))[0] || "";
}

function compareParsedEntries(left: ParsedRosterEntry, right: ParsedRosterEntry): number {
  const leftTime = left.parsedDate.getTime();
  const rightTime = right.parsedDate.getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;

  const shiftDelta = SHIFT_ORDER.indexOf(left.normalizedShift) - SHIFT_ORDER.indexOf(right.normalizedShift);
  if (shiftDelta !== 0) return shiftDelta;

  return left.normalizedUnit.localeCompare(right.normalizedUnit);
}

export function buildRosterMatrix(entries: RosterEntry[], referenceDate = new Date()): RosterMatrixData {
  const parsedEntries: ParsedRosterEntry[] = entries
    .map((entry) => {
      const parsedDate = parseRosterDate(entry.date);
      const normalizedShift = normalizeShift(entry.shift);
      const normalizedUnit = getCanonicalUnitLabel(entry.unit);

      if (!parsedDate || !normalizedUnit || !SHIFT_ORDER.includes(normalizedShift)) {
        return null;
      }

      return {
        ...entry,
        parsedDate,
        normalizedDate: format(parsedDate, "yyyy-MM-dd"),
        normalizedShift,
        normalizedUnit,
      };
    })
    .filter((entry): entry is ParsedRosterEntry => Boolean(entry))
    .sort(compareParsedEntries);

  const uniqueDates = Array.from(
    new Map(parsedEntries.map((entry) => [entry.normalizedDate, entry.parsedDate])).entries(),
  )
    .map(([isoDate, parsedDate]) => ({ isoDate, parsedDate }))
    .sort((left, right) => left.parsedDate.getTime() - right.parsedDate.getTime());

  const activeMonthDate = uniqueDates.length > 0 && !uniqueDates.some(({ parsedDate }) => isSameMonth(parsedDate, referenceDate))
    ? startOfMonth(uniqueDates[uniqueDates.length - 1].parsedDate)
    : startOfMonth(referenceDate);

  const activeDates = eachDayOfInterval({
    start: startOfMonth(activeMonthDate),
    end: endOfMonth(activeMonthDate),
  }).map((parsedDate) => ({
    isoDate: format(parsedDate, "yyyy-MM-dd"),
    parsedDate,
  }));
  const allowedDateKeys = new Set(activeDates.map(({ isoDate }) => isoDate));
  const visibleEntries = parsedEntries.filter((entry) => allowedDateKeys.has(entry.normalizedDate));

  const dateColumns: RosterDateColumn[] = activeDates.map(({ isoDate, parsedDate }, index) => {
    const shiftCodes = SHIFT_ORDER.map((shiftName) => getShiftTeamCode(isoDate, shiftName, visibleEntries));

    return {
      isoDate,
      date: format(parsedDate, "d-MMM-yyyy"),
      day: format(parsedDate, "EEEE"),
      shifts: [...SHIFT_ORDER],
      shiftCodes,
      colStart: 2 + index * SHIFT_ORDER.length,
    };
  });

  const unitRows = new Map<string, RosterMatrixRow>();
  for (const entry of visibleEntries) {
    if (EXCLUDED_ROSTER_UNITS.has(normalizeUnitKey(entry.normalizedUnit))) {
      continue;
    }

    if (!unitRows.has(entry.normalizedUnit)) {
      unitRows.set(entry.normalizedUnit, {
        slNo: String(unitRows.size + 1),
        unit: entry.normalizedUnit,
        cells: Array(dateColumns.length * SHIFT_ORDER.length).fill(""),
        rowType: classifyRow(entry.normalizedUnit),
      });
    }
  }

  const groupedEntries = new Map<string, ParsedRosterEntry[]>();
  for (const entry of visibleEntries) {
    const key = `${entry.normalizedUnit}::${entry.normalizedDate}::${entry.normalizedShift}`;
    const existing = groupedEntries.get(key) || [];
    existing.push(entry);
    groupedEntries.set(key, existing);
  }

  dateColumns.forEach((dateColumn, dateIndex) => {
    SHIFT_ORDER.forEach((shiftName, shiftIndex) => {
      for (const [unitKey, row] of unitRows.entries()) {
        const key = `${unitKey}::${format(activeDates[dateIndex].parsedDate, "yyyy-MM-dd")}::${shiftName}`;
        const cellEntries = groupedEntries.get(key) || [];
        row.cells[dateIndex * SHIFT_ORDER.length + shiftIndex] = getCellValue(cellEntries);
      }
    });
  });

  const orderedRows = Array.from(unitRows.values()).map((row, index) => ({
    ...row,
    slNo: String(index + 1),
  }));

  return {
    monthLabel: format(activeMonthDate, "MMMM yyyy"),
    dates: dateColumns,
    rows: orderedRows,
  };
}