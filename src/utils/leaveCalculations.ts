import type { RawLeaveRecord } from "@/services/leaveApi";

export type NormalizedLeaveRecord = {
  empId: string;
  name: string;
  status: "Active" | "Inactive";
  casualLeave: unknown[];
  restrictedHolidays: unknown[];
  nationalHolidays: unknown[];
  closedHolidays: unknown[];
  lastYearCompOff: unknown[];
  opeDuty: unknown[];
  casualCount: number;
  casualRemaining: number;
  restrictedCount: number;
  compOffUsed: number;
  compOffRemaining: number;
  compOffEarned: number;
  usageScore: number;
  raw: RawLeaveRecord;
};

function normalizeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [];
}

function normalizeStatus(value: unknown): "Active" | "Inactive" {
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (!lowered) return "Active";
    if (lowered.includes("inactive") || lowered === "0" || lowered === "false") {
      return "Inactive";
    }
    if (lowered.includes("transfer") || lowered.includes("superannuation") || lowered.includes("retired")) {
      return "Inactive";
    }
    if (lowered.includes("active") || lowered === "1" || lowered === "true") {
      return "Active";
    }
  }
  return "Active";
}

function isNonEmpty(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function isMeaningfulValue(value: unknown): boolean {
  if (typeof value !== "string") return value != null;
  const v = value.trim().toUpperCase();
  if (!v) return false;
  if (v === "NA" || v === "N/A" || v === "VALIDITY LAPSED") return false;
  return true;
}

function countNonEmptyStrings(items: unknown[]): number {
  return items.filter((item) => typeof item === "string" && item.trim().length > 0).length;
}

function countByFields(items: unknown[], fields: string[]): number {
  return items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    return fields.some((field) => isNonEmpty((item as any)[field]));
  }).length;
}

const COMP_OFF_ELIGIBLE_DUTY = new Set([
  "M",
  "A",
  "N",
  "NO",
  "M+A",
  "NO+N",
  "SAT+NO",
  "SAT+N",
  "SUN+N",
  "SUN+M",
  "SUN+A",
  "SUN+NO",
  "CH",
  "SAT",
  "SUN",
]);

function normalizeDutyCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, "").toUpperCase();
}

export function calculateCasualLeaveCount(record: RawLeaveRecord): number {
  const items = normalizeArray(record.casualLeave);
  if (items.length === 0) return 0;
  const first = items[0];
  let used = 0;
  if (typeof first === "string") {
    used = countNonEmptyStrings(items);
  } else if (typeof first === "object") {
    used = countByFields(items, ["date", "leaveApplied"]);
  } else {
    used = items.length;
  }
  return Math.min(used, 12);
}

export function calculateRestrictedHolidayUsage(record: RawLeaveRecord): number {
  const items = normalizeArray(record.restrictedHolidays);
  if (items.length === 0) return 0;
  const first = items[0];
  if (typeof first === "string") return countNonEmptyStrings(items);
  if (typeof first === "object") return countByFields(items, ["date", "leaveApplied"]);
  return items.length;
}

export function calculateCompOffUsage(record: RawLeaveRecord): number {
  const { used } = calculateCompOffSummary(record);
  return used;
}

export function calculateCompOffSummary(record: RawLeaveRecord): {
  earned: number;
  used: number;
  remaining: number;
} {
  const items = normalizeArray(record.lastYearCompOff);
  if (items.length === 0) return { earned: 0, used: 0, remaining: 0 };

  let earned = 0;
  let used = 0;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const duty = normalizeDutyCode((item as any).dutyPerformed);
    const leaveApplied = (item as any).leaveApplied;
    if (!duty || duty === "NA" || duty === "N/A") continue;
    const eligible = COMP_OFF_ELIGIBLE_DUTY.has(duty);
    if (!eligible) {
      // Fallback: treat unknown duty codes as eligible if data source already lists comp-off entries.
      // This prevents under-counting when duty codes vary in the sheet.
      earned += 1;
    } else {
      earned += 1;
    }
    if (isMeaningfulValue(leaveApplied)) used += 1;
  }

  const remaining = Math.max(earned - used, 0);
  return { earned, used, remaining };
}

export function normalizeLeaveRecord(record: RawLeaveRecord): NormalizedLeaveRecord {
  const empId = record.empId != null ? String(record.empId).trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const status = normalizeStatus(record.status);

  const casualLeave = normalizeArray(record.casualLeave);
  const restrictedHolidays = normalizeArray(record.restrictedHolidays);
  const nationalHolidays = normalizeArray(record.nationalHolidays);
  const closedHolidays = normalizeArray(record.closedHolidays);
  const lastYearCompOff = normalizeArray(record.lastYearCompOff);
  const opeDuty = normalizeArray(record.opeDuty);

  const casualCount = calculateCasualLeaveCount(record);
  const casualRemaining = Math.max(12 - casualCount, 0);
  const restrictedCount = calculateRestrictedHolidayUsage(record);
  const compOffSummary = calculateCompOffSummary(record);
  const usageScore = casualCount + restrictedCount + compOffSummary.used;

  return {
    empId,
    name,
    status,
    casualLeave,
    restrictedHolidays,
    nationalHolidays,
    closedHolidays,
    lastYearCompOff,
    opeDuty,
    casualCount,
    casualRemaining,
    restrictedCount,
    compOffUsed: compOffSummary.used,
    compOffRemaining: compOffSummary.remaining,
    compOffEarned: compOffSummary.earned,
    usageScore,
    raw: record,
  };
}

export function normalizeLeaveRecords(records: RawLeaveRecord[]): NormalizedLeaveRecord[] {
  return records.map(normalizeLeaveRecord).filter((rec) => rec.empId);
}
