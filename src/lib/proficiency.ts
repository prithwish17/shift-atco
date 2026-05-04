import { addDays, differenceInDays, endOfMonth, format, startOfDay, startOfMonth } from "date-fns";

import { normalizeTeamKey } from "@/lib/teamDutyRotation";

export const PROFICIENCY_RATING_TYPES = ["ADC", "APP", "ACC", "ACC(S)", "OCC", "PLR"] as const;

export type ProficiencyRatingType = typeof PROFICIENCY_RATING_TYPES[number];

export interface ProficiencyHistoryItem {
  date: string | null;
  instructor: string | null;
}

export interface ProficiencyRatingEntry {
  status: string | null;
  rating_date: string | null;
  endorsement_date: string | null;
  last_proficiency: ProficiencyHistoryItem;
  proficiency_history: Record<string, ProficiencyHistoryItem>;
}

export interface ProficiencyRecordLike {
  ratings: Record<string, ProficiencyRatingEntry>;
}

export interface InstructorQualificationLike {
  instructor_validity?: Record<string, string> | null;
  ojti?: Record<string, boolean> | null;
}

export interface MonthlyProficiencySource extends InstructorQualificationLike {
  employeeId: string;
  employeeName: string;
  currentShift: string | null;
  highestRating: string | null;
  ratingData: unknown;
}

export interface MonthlyProficiencyRow {
  id: string;
  employeeId: string;
  employeeName: string;
  shiftKey: string;
  shiftLabel: string;
  dueOn: string;
  dueOnDate: Date;
  sector: string;
  sourceRatings: string[];
  candidateRatingKeys: string[];
  instructorValidityKeys: string[];
  highestRating: string | null;
}

type ProfValidity = {
  validUpto: Date | null;
  daysLeft: number | null;
  exemptByAccS: boolean;
};

const POSITION_FILTER_LABELS: Record<string, string> = {
  ADC: "ADC",
  APP: "APP",
  "APP(S)": "APP(S)",
  "APP+APP(S)": "APP+APP(S)",
  ACC: "ACC",
  "ACC(S)": "ACC(S)",
  "ACC+ACC(S)": "ACC+ACC(S)",
  "ACC P & S": "ACC P & S",
  OCC: "OCC",
  PLR: "PLR",
  SCC: "SCC",
  ART: "ART",
};

const POSITION_FILTER_ORDER = [
  "ADC",
  "APP",
  "APP(S)",
  "APP+APP(S)",
  "ACC",
  "ACC(S)",
  "ACC+ACC(S)",
  "ACC P & S",
  "OCC",
  "PLR",
  "SCC",
  "ART",
];

const TEAM_LABELS: Record<string, string> = {
  G: "General",
  A: "Team A",
  B: "Team B",
  C: "Team C",
  D: "Team D",
  E: "Team E",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNullableString(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function normalizeHistoryItem(value: unknown): ProficiencyHistoryItem {
  const raw = isRecord(value) ? value : {};
  return {
    date: normalizeNullableString(raw.date),
    instructor: normalizeNullableString(raw.instructor),
  };
}

function hasMeaningfulRatingEntry(entry: ProficiencyRatingEntry) {
  return Boolean(
    entry.status ||
      entry.rating_date ||
      entry.endorsement_date ||
      entry.last_proficiency.date ||
      entry.last_proficiency.instructor ||
      Object.keys(entry.proficiency_history).length > 0,
  );
}

function normalizeDateKey(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, "yyyy-MM-dd");
}

function isDateInMonth(date: Date, monthStart: Date, monthEnd: Date) {
  const timestamp = date.getTime();
  return timestamp >= monthStart.getTime() && timestamp <= monthEnd.getTime();
}

function getSectorConfig(sector: string) {
  const normalized = normalizePositionKey(sector);

  switch (normalized) {
    case "ADC":
      return {
        label: "ADC",
        candidateRatingKeys: ["ADC"],
        instructorValidityKeys: ["INSTR ADC"],
      };
    case "APP":
      return {
        label: "APP",
        candidateRatingKeys: ["APP"],
        instructorValidityKeys: ["INSTR APP"],
      };
    case "ACC":
      return {
        label: "ACC",
        candidateRatingKeys: ["ACC"],
        instructorValidityKeys: ["INSTR ACC"],
      };
    case "ACC(S)":
      return {
        label: "ACC(S)",
        candidateRatingKeys: ["ACC", "ACC(S)"],
        instructorValidityKeys: ["INSTR ACC"],
      };
    case "ACC P & S":
      return {
        label: "ACC P & S",
        candidateRatingKeys: ["ACC", "ACC(S)"],
        instructorValidityKeys: ["INSTR ACC"],
      };
    case "OCC":
      return {
        label: "OCC",
        candidateRatingKeys: ["OCC"],
        instructorValidityKeys: ["INSTR OCC"],
      };
    case "PLR":
      return {
        label: "PLR",
        candidateRatingKeys: ["PLR"],
        instructorValidityKeys: ["INSTR PLR"],
      };
    default:
      return {
        label: normalized,
        candidateRatingKeys: [normalized],
        instructorValidityKeys: [],
      };
  }
}

export function normalizePositionKey(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

export function formatPositionFilterLabel(value: string) {
  const normalized = normalizePositionKey(value);
  return POSITION_FILTER_LABELS[normalized] || normalized;
}

export function comparePositionFilterKeys(left: string, right: string) {
  const leftNormalized = normalizePositionKey(left);
  const rightNormalized = normalizePositionKey(right);
  const leftOrder = POSITION_FILTER_ORDER.indexOf(leftNormalized);
  const rightOrder = POSITION_FILTER_ORDER.indexOf(rightNormalized);

  if (leftOrder !== -1 || rightOrder !== -1) {
    if (leftOrder === -1) return 1;
    if (rightOrder === -1) return -1;
    return leftOrder - rightOrder;
  }

  return leftNormalized.localeCompare(rightNormalized);
}

export function getTeamLabel(teamKey: string | null | undefined) {
  const normalized = normalizeTeamKey(teamKey);
  return TEAM_LABELS[normalized] || `Team ${normalized}`;
}

export function getLatestProficiencyFromHistory(entry: Pick<ProficiencyRatingEntry, "last_proficiency" | "proficiency_history">) {
  const latestHistory = Object.entries(entry.proficiency_history || {})
    .filter(([, history]) => history.date)
    .map(([historyKey, history]) => ({
      historyKey,
      date: history.date as string,
      instructor: history.instructor || null,
      time: new Date(history.date as string).getTime(),
    }))
    .filter((history) => !Number.isNaN(history.time))
    .sort((first, second) => second.time - first.time || second.historyKey.localeCompare(first.historyKey, undefined, { numeric: true }))[0];

  if (latestHistory) {
    return {
      date: latestHistory.date,
      instructor: latestHistory.instructor,
    };
  }

  return {
    date: entry.last_proficiency?.date || null,
    instructor: entry.last_proficiency?.instructor || null,
  };
}

export function normalizeRatingEntry(entry: Partial<ProficiencyRatingEntry> | Record<string, unknown> | null | undefined): ProficiencyRatingEntry {
  const raw = isRecord(entry) ? entry : {};
  const normalizedHistory = Object.fromEntries(
    Object.entries(isRecord(raw.proficiency_history) ? raw.proficiency_history : {})
      .map(([historyKey, history]) => [historyKey, normalizeHistoryItem(history)])
      .filter(([, history]) => history.date || history.instructor),
  );

  const normalizedEntry: ProficiencyRatingEntry = {
    status: normalizeNullableString(raw.status),
    rating_date: normalizeNullableString(raw.rating_date),
    endorsement_date: normalizeNullableString(raw.endorsement_date),
    last_proficiency: normalizeHistoryItem(raw.last_proficiency),
    proficiency_history: normalizedHistory,
  };

  return {
    ...normalizedEntry,
    last_proficiency: getLatestProficiencyFromHistory(normalizedEntry),
  };
}

export function normalizeRatingData(raw: unknown) {
  if (!isRecord(raw)) return {} as Record<string, ProficiencyRatingEntry>;

  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [normalizePositionKey(key), normalizeRatingEntry(value)] as const)
      .filter(([, entry]) => hasMeaningfulRatingEntry(entry)),
  );
}

export function getProfValidity(entry: ProficiencyRatingEntry, referenceDate: Date): ProfValidity | null {
  const baseDate = [entry.last_proficiency?.date, entry.endorsement_date]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((first, second) => second.getTime() - first.getTime())[0];

  if (!baseDate) return null;

  const validUpto = addDays(startOfDay(baseDate), 364);
  const daysLeft = differenceInDays(validUpto, startOfDay(referenceDate));

  return { validUpto, daysLeft, exemptByAccS: false };
}

export function getActiveRecordProfValidity(record: ProficiencyRecordLike, ratingKey: string, referenceDate: Date) {
  const entry = record.ratings[normalizePositionKey(ratingKey)];
  if (!entry || entry.status !== "1") return null;
  return getProfValidity(entry, referenceDate);
}

export function hasValidAccSRating(record: ProficiencyRecordLike, referenceDate: Date) {
  const validity = getActiveRecordProfValidity(record, "ACC(S)", referenceDate);
  return Boolean(validity && validity.daysLeft !== null && validity.daysLeft >= 0);
}

export function getRecordProfValidity(record: ProficiencyRecordLike, ratingKey: string, referenceDate: Date): ProfValidity | null {
  const normalizedKey = normalizePositionKey(ratingKey);
  const entry = record.ratings[normalizedKey];
  if (!entry) return null;

  if (normalizedKey === "PLR" && entry.status === "1" && hasValidAccSRating(record, referenceDate)) {
    return {
      validUpto: null,
      daysLeft: null,
      exemptByAccS: true,
    };
  }

  return entry.status === "1" ? getProfValidity(entry, referenceDate) : null;
}

export function isRatingValidThrough(record: ProficiencyRecordLike, ratingKey: string, requiredDate: Date) {
  const validity = getActiveRecordProfValidity(record, ratingKey, requiredDate);
  return Boolean(validity?.validUpto && validity.validUpto.getTime() >= startOfDay(requiredDate).getTime());
}

export function getInstructorKeys(record: InstructorQualificationLike | null | undefined) {
  if (!record) return [] as string[];

  const validityKeys = Object.keys(record.instructor_validity || {});
  const ojtiKeys = Object.entries(record.ojti || {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);

  return Array.from(
    new Set(
      [...validityKeys, ...ojtiKeys]
        .map((key) => normalizePositionKey(key))
        .filter(Boolean),
    ),
  );
}

export function hasInstructorValidityThrough(record: InstructorQualificationLike | null | undefined, instructorValidityKeys: string[], requiredDate: Date) {
  if (!record || instructorValidityKeys.length === 0) return false;

  const requiredDateKey = format(requiredDate, "yyyy-MM-dd");
  if (!requiredDateKey) return false;

  const normalizedValidityMap = new Map<string, string>();
  for (const [rawKey, rawValue] of Object.entries(record.instructor_validity || {})) {
    normalizedValidityMap.set(normalizePositionKey(rawKey), rawValue);
  }

  const normalizedOjtiKeys = new Set(
    Object.entries(record.ojti || {})
      .filter(([, value]) => Boolean(value))
      .map(([key]) => normalizePositionKey(key)),
  );

  return instructorValidityKeys.some((key) => {
    const normalizedKey = normalizePositionKey(key);

    const expiryValue = normalizedValidityMap.get(normalizedKey);
    if (expiryValue) {
      const expiryDateKey = normalizeDateKey(expiryValue);
      if (expiryDateKey && expiryDateKey >= requiredDateKey) return true;
    }

    const sectorCode = normalizedKey.replace(/^INSTR\s+/, "");
    if (normalizedOjtiKeys.has(normalizedKey) || normalizedOjtiKeys.has(sectorCode)) {
      return true;
    }

    return false;
  });
}

export function buildMonthlyProficiencyRows(sources: MonthlyProficiencySource[], selectedMonth: Date) {
  const monthStart = startOfMonth(selectedMonth);
  const monthEnd = endOfMonth(selectedMonth);

  return sources
    .flatMap((source) => {
      const ratings = normalizeRatingData(source.ratingData);
      const record = { ratings } satisfies ProficiencyRecordLike;
      const shiftKey = normalizeTeamKey(source.currentShift);
      const shiftLabel = getTeamLabel(shiftKey);
      const rows: MonthlyProficiencyRow[] = [];

      const accValidity = getActiveRecordProfValidity(record, "ACC", monthEnd);
      const accsValidity = getActiveRecordProfValidity(record, "ACC(S)", monthEnd);
      const plrValidity = getActiveRecordProfValidity(record, "PLR", monthEnd);
      const collapseAccFamily = Boolean(
        accValidity?.validUpto &&
          accsValidity?.validUpto &&
          plrValidity?.validUpto,
      );

      const collapsedDueDate = collapseAccFamily
        ? [accValidity?.validUpto, accsValidity?.validUpto, plrValidity?.validUpto]
            .filter((value): value is Date => Boolean(value))
            .sort((left, right) => left.getTime() - right.getTime())[0] || null
        : null;

      if (collapseAccFamily && collapsedDueDate && isDateInMonth(collapsedDueDate, monthStart, monthEnd)) {
        const sectorConfig = getSectorConfig("ACC P & S");
        rows.push({
          id: `${source.employeeId}-ACC-P-S-${format(collapsedDueDate, "yyyy-MM-dd")}`,
          employeeId: source.employeeId,
          employeeName: source.employeeName,
          shiftKey,
          shiftLabel,
          dueOn: format(collapsedDueDate, "yyyy-MM-dd"),
          dueOnDate: collapsedDueDate,
          sector: sectorConfig.label,
          sourceRatings: ["ACC", "ACC(S)", "PLR"],
          candidateRatingKeys: sectorConfig.candidateRatingKeys,
          instructorValidityKeys: sectorConfig.instructorValidityKeys,
          highestRating: source.highestRating,
        });
      }

      for (const ratingKey of PROFICIENCY_RATING_TYPES) {
        if (collapseAccFamily && (ratingKey === "ACC" || ratingKey === "ACC(S)" || ratingKey === "PLR")) {
          continue;
        }

        const validity = getActiveRecordProfValidity(record, ratingKey, monthEnd);
        if (!validity?.validUpto || !isDateInMonth(validity.validUpto, monthStart, monthEnd)) {
          continue;
        }

        const sectorConfig = getSectorConfig(ratingKey);
        rows.push({
          id: `${source.employeeId}-${normalizePositionKey(ratingKey)}-${format(validity.validUpto, "yyyy-MM-dd")}`,
          employeeId: source.employeeId,
          employeeName: source.employeeName,
          shiftKey,
          shiftLabel,
          dueOn: format(validity.validUpto, "yyyy-MM-dd"),
          dueOnDate: validity.validUpto,
          sector: sectorConfig.label,
          sourceRatings: [normalizePositionKey(ratingKey)],
          candidateRatingKeys: sectorConfig.candidateRatingKeys,
          instructorValidityKeys: sectorConfig.instructorValidityKeys,
          highestRating: source.highestRating,
        });
      }

      return rows;
    })
    .sort((left, right) => {
      if (left.dueOn !== right.dueOn) return left.dueOn.localeCompare(right.dueOn);
      const nameCompare = left.employeeName.localeCompare(right.employeeName);
      if (nameCompare !== 0) return nameCompare;
      return comparePositionFilterKeys(left.sector, right.sector);
    });
}