import { addMonths, differenceInCalendarDays, format, parseISO, startOfDay, subDays } from "date-fns";
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
  compOffEntries: CompOffHistoryEntry[];
  compOffEarnedEntries: CompOffHistoryEntry[];
  compOffUsedEntries: CompOffHistoryEntry[];
  opeDuty: unknown[];
  casualCount: number;
  casualRemaining: number;
  restrictedCount: number;
  compOffUsed: number;
  compOffRemaining: number;
  compOffEarned: number;
  compOffExpired: number;
  usageScore: number;
  raw: RawLeaveRecord;
};

export type CompOffHistoryEntry = {
  dutyDate: string | null;
  leaveApplied: string | null;
  dutyPerformed: string;
  sourceType: string;
  sourceLabel?: string;
  expiryDate: string | null;
  daysRemaining: number | null;
  hideDates: boolean;
  eligible: boolean;
  earned: boolean;
  used: boolean;
  expired: boolean;
  remark: string;
  status: "available" | "used" | "expired" | "not_available";
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
  "G",
  "SAT+NO",
  "SAT+N",
  "SUN+N",
  "SUN+M",
  "SUN+A",
  "SUN+NO",
]);

function normalizeDutyCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, "").toUpperCase();
}

function normalizeSourceType(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
}

function isCompOffUsedEntry(leaveApplied: unknown): boolean {
  return isMeaningfulValue(leaveApplied);
}

function isCompOffEarnedEntry(duty: string, sourceType: string): boolean {
  if (["LAST_YEAR_CH_DUTY", "FROM_LAST_YEAR", "OPE_DUTY", "OPE"].includes(sourceType)) return true;
  if (!duty || duty === "NA" || duty === "N/A") return false;
  return COMP_OFF_ELIGIBLE_DUTY.has(duty);
}

function formatIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function resolveCompOffExpiryDate(dutyDate: string | null, explicitExpiryDate: string | null, eligible: boolean): string | null {
  if (!eligible) return null;
  if (dutyDate) {
    try {
      return formatIsoDate(subDays(addMonths(parseISO(dutyDate), 3), 1));
    } catch {
      return explicitExpiryDate;
    }
  }
  if (explicitExpiryDate) return explicitExpiryDate;
  if (!dutyDate) return null;
  try {
    return formatIsoDate(subDays(addMonths(parseISO(dutyDate), 3), 1));
  } catch {
    return null;
  }
}

export function normalizeCompOffEntries(items: unknown[]): CompOffHistoryEntry[] {
  const today = startOfDay(new Date());

  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => {
      const dutyPerformed = typeof item.dutyPerformed === "string" ? item.dutyPerformed.trim() : "";
      const sourceType = normalizeSourceType(item.sourceType);
      const sourceLabel = typeof item.sourceLabel === "string" && item.sourceLabel.trim()
        ? item.sourceLabel.trim()
        : undefined;
      const duty = normalizeDutyCode(dutyPerformed);
      const hideDates = duty === "NA" || duty === "N/A";
      const leaveApplied =
        typeof item.leaveApplied === "string" && item.leaveApplied.trim()
          ? item.leaveApplied
          : null;
      const dutyDate =
        typeof item.dutyDate === "string" && item.dutyDate.trim()
          ? item.dutyDate
          : null;
      const explicitEligible = typeof item.eligible === "boolean"
        ? item.eligible
        : typeof item.compOffEligible === "boolean"
          ? item.compOffEligible
          : null;
      const explicitRemark =
        typeof item.remark === "string" && item.remark.trim()
          ? item.remark.trim()
          : null;
      const earned = explicitEligible ?? isCompOffEarnedEntry(duty, sourceType);
      const used = isCompOffUsedEntry(leaveApplied);
      const rawExpiryDate =
        typeof item.expiryDate === "string" && item.expiryDate.trim()
          ? item.expiryDate
          : null;
      const expiryDate = resolveCompOffExpiryDate(dutyDate, rawExpiryDate, earned);
      const daysRemaining = expiryDate ? differenceInCalendarDays(parseISO(expiryDate), today) : null;
      const expired = !used && earned && daysRemaining != null && daysRemaining < 0;
      const remark = explicitRemark
        ? explicitRemark
        : !earned
          ? "Comp Off Not Available"
          : expired
            ? `Expired on ${expiryDate}`
            : used
              ? `Used on ${leaveApplied}`
              : expiryDate
                ? `${daysRemaining ?? 0} day${daysRemaining === 1 ? "" : "s"} remaining`
                : "Available";
      const status: CompOffHistoryEntry["status"] =
        !earned ? "not_available" : used ? "used" : expired ? "expired" : "available";

      return {
        dutyDate,
        leaveApplied,
        dutyPerformed,
        sourceType,
        sourceLabel,
        expiryDate,
        daysRemaining,
        hideDates,
        eligible: earned,
        earned,
        used,
        expired,
        remark,
        status,
      };
    });
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
  expired: number;
  remaining: number;
} {
  const items = normalizeCompOffEntries(normalizeArray(record.lastYearCompOff));
  if (items.length === 0) return { earned: 0, used: 0, expired: 0, remaining: 0 };

  const earned = items.filter((item) => item.earned).length;
  const used = items.filter((item) => item.used).length;
  const expired = items.filter((item) => item.expired).length;

  const remaining = Math.max(earned - used - expired, 0);
  return { earned, used, expired, remaining };
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
  const compOffEntries = normalizeCompOffEntries(lastYearCompOff);
  const compOffEarnedEntries = compOffEntries.filter((item) => item.earned);
  const compOffUsedEntries = compOffEntries.filter((item) => item.used);
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
    compOffEntries,
    compOffEarnedEntries,
    compOffUsedEntries,
    opeDuty,
    casualCount,
    casualRemaining,
    restrictedCount,
    compOffUsed: compOffSummary.used,
    compOffRemaining: compOffSummary.remaining,
    compOffEarned: compOffSummary.earned,
    compOffExpired: compOffSummary.expired,
    usageScore,
    raw: record,
  };
}

export function normalizeLeaveRecords(records: RawLeaveRecord[]): NormalizedLeaveRecord[] {
  return records.map(normalizeLeaveRecord).filter((rec) => rec.empId);
}
