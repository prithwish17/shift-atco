import type { CompOffHistoryEntry } from "@/utils/leaveCalculations";
import { normalizeCompOffEntries } from "@/utils/leaveCalculations";

type JsonObject = Record<string, any>;

export type CompOffLedgerRow = {
  id: string;
  leave_category: string;
  source_event_type?: string | null;
  leave_date?: string | null;
  leave_used_on?: string | null;
  duty_code?: string | null;
  raw_leave_used_value?: string | null;
  metadata?: JsonObject | string | null;
  raw_event?: JsonObject | string | null;
};

export type CompOffAllocationCandidate = CompOffHistoryEntry & {
  recordId: string;
  leaveCategory: string;
  metadata: JsonObject;
};

export type CompOffAllocationResult = {
  requestedDays: number;
  availableCount: number;
  reservedCount: number;
  remainingAfterReservations: number;
  selectedEntries: CompOffAllocationCandidate[];
  canCoverRequest: boolean;
};

function parseJsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object") return value as JsonObject;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") return parsed as JsonObject;
    } catch {
      return {};
    }
  }
  return {};
}

function resolveLeaveUsedOn(row: CompOffLedgerRow, metadata: JsonObject, rawEvent: JsonObject): string | null {
  return (
    row.leave_used_on ||
    metadata.leave_used_on ||
    metadata.leave_applied ||
    row.raw_leave_used_value ||
    rawEvent.leaveUsedOn ||
    rawEvent.leaveApplied ||
    null
  );
}

function resolveDutyPerformed(row: CompOffLedgerRow, metadata: JsonObject, sourceType: string): string {
  const rawDutyPerformed = metadata.duty_performed || metadata.shift || row.duty_code || "";
  if (typeof rawDutyPerformed === "string" && rawDutyPerformed.trim()) {
    return rawDutyPerformed.trim();
  }

  return String(sourceType).toUpperCase().includes("OPE") ? "OPE" : "";
}

function compareCompOffCandidates(left: CompOffAllocationCandidate, right: CompOffAllocationCandidate) {
  const leftExpiry = left.expiryDate || "9999-12-31";
  const rightExpiry = right.expiryDate || "9999-12-31";
  if (leftExpiry !== rightExpiry) {
    return leftExpiry.localeCompare(rightExpiry);
  }

  const leftDuty = left.dutyDate || "9999-12-31";
  const rightDuty = right.dutyDate || "9999-12-31";
  if (leftDuty !== rightDuty) {
    return leftDuty.localeCompare(rightDuty);
  }

  return left.recordId.localeCompare(right.recordId);
}

export function buildCompOffAllocationCandidates(rows: CompOffLedgerRow[]): CompOffAllocationCandidate[] {
  return rows
    .filter((row) => ["COMP_OFF", "COMP_OFF_EARNED", "LAST_YEAR_CH_DUTY", "OPE"].includes(String(row.leave_category || "")))
    .map((row) => {
      const metadata = parseJsonObject(row.metadata);
      const rawEvent = parseJsonObject(row.raw_event);
      const sourceType = String(metadata.source_type || row.source_event_type || row.leave_category || "COMP_OFF");
      const [entry] = normalizeCompOffEntries([
        {
          dutyDate: metadata.duty_date || metadata.ope_duty_date || row.leave_date || null,
          leaveApplied: resolveLeaveUsedOn(row, metadata, rawEvent),
          dutyPerformed: resolveDutyPerformed(row, metadata, sourceType),
          sourceType,
          sourceLabel: metadata.source_label || "",
          eligible: typeof metadata.comp_off_eligible === "boolean" ? metadata.comp_off_eligible : undefined,
          expiryDate: metadata.expiry_date || null,
          remark: metadata.remark || "",
        },
      ]);

      return {
        ...entry,
        recordId: row.id,
        leaveCategory: row.leave_category,
        metadata,
      };
    })
    .filter((entry) => !entry.hideDates)
    .sort(compareCompOffCandidates);
}

export function allocateCompOffCandidates(
  candidates: CompOffAllocationCandidate[],
  requestedDays: number,
  reservedDays = 0,
): CompOffAllocationResult {
  const normalizedRequestedDays = Math.max(Math.ceil(requestedDays || 0), 0);
  const normalizedReservedDays = Math.max(Math.ceil(reservedDays || 0), 0);

  const availableEntries = candidates
    .filter((candidate) => candidate.status === "available")
    .sort(compareCompOffCandidates);

  const selectedEntries = availableEntries.slice(
    normalizedReservedDays,
    normalizedReservedDays + normalizedRequestedDays,
  );

  return {
    requestedDays: normalizedRequestedDays,
    availableCount: availableEntries.length,
    reservedCount: Math.min(normalizedReservedDays, availableEntries.length),
    remainingAfterReservations: Math.max(availableEntries.length - normalizedReservedDays, 0),
    selectedEntries,
    canCoverRequest: normalizedRequestedDays === 0 || selectedEntries.length >= normalizedRequestedDays,
  };
}