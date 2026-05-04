import { eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";

import { getDutyShiftMatches, getTeamDutyForDateKey } from "@/lib/teamDutyRotation";

export type SummaryScheduleMember = {
  employee_id: string;
  employee_name: string | null;
  duty_date: string;
  current_shift: string | null;
  designation: string | null;
  gender: string | null;
  highest_rating: string | null;
  rating_summary: Record<string, unknown> | null;
  instructor_validity: Record<string, string> | null;
  ojti: Record<string, boolean> | null;
  duty_code: string | null;
  duty_description: string | null;
};

export type AvailabilityShiftCode = "M" | "A" | "N";
export type GroupNum = 1 | 2 | 3 | 4 | 5;

const ROTATION_TEAM_KEYS = ["A", "B", "C", "D", "E"] as const;
const SHIFT_CODES: AvailabilityShiftCode[] = ["M", "A", "N"];
const RATING_RANK: string[] = [
  "RSR+UBN",
  "RSR",
  "ASR+RSR",
  "ASR+APP",
  "ACC-PLR",
  "OCC+ACC-PLR",
  "ADC+ACC-PLR",
  "ACC-PLR+ACC-P",
  "ADC+ACC-P",
  "ACC-P+OCC",
  "OCC",
  "ADC/SMC",
  "ADC",
  "SMC",
  "ALPHA",
];

export const INSTRUCTOR_SECTOR_ROWS = [
  "INSTR ADC",
  "INSTR APP",
  "INSTR ACC",
  "INSTR OCC",
  "INSTR PLR",
] as const;

export const RATING_GROUPS: Record<GroupNum, { label: string; shortLabel: string; categories: string[] }> = {
  1: { label: "Group 1 — RSR", shortLabel: "RSR", categories: ["RSR+UBN", "RSR"] },
  2: { label: "Group 2 — ASR", shortLabel: "ASR", categories: ["ASR+RSR", "ASR+APP"] },
  3: {
    label: "Group 3 — ACC/OCC",
    shortLabel: "ACC/OCC",
    categories: ["ACC-PLR", "OCC+ACC-PLR", "ADC+ACC-PLR", "ACC-PLR+ACC-P", "ADC+ACC-P", "ACC-P+OCC", "OCC"],
  },
  4: { label: "Group 4 — ADC/SMC", shortLabel: "ADC/SMC", categories: ["ADC/SMC"] },
  5: { label: "Group 5 — ALPHA", shortLabel: "ALPHA", categories: ["ALPHA"] },
};

export const OCC_RATING_CATEGORIES = ["OCC", "OCC+ACC-PLR", "ACC-P+OCC"];

export const GROUP_SHIFT_MINIMUMS: Record<GroupNum, [number, number]> = {
  1: [12, 16],
  2: [4, 4],
  3: [14, 16],
  4: [9, 9],
  5: [11, 10],
};

export const OCC_SHIFT_MINIMUMS: [number, number] = [4, 7];

export const TOTAL_SHIFT_REQUIREMENTS: Record<AvailabilityShiftCode, number> = {
  M: Object.values(GROUP_SHIFT_MINIMUMS).reduce((sum, [minimum]) => sum + minimum, 0),
  A: Object.values(GROUP_SHIFT_MINIMUMS).reduce((sum, [minimum]) => sum + minimum, 0),
  N: Object.values(GROUP_SHIFT_MINIMUMS).reduce((sum, [, minimum]) => sum + minimum, 0),
};

export interface AvailabilityGroupReportCell {
  group: GroupNum;
  label: string;
  available: number;
  required: number;
  net: number;
  colorClass: string;
}

export interface AvailabilityShiftReportSection {
  shiftCode: AvailabilityShiftCode;
  teamCode: string;
  totalAvailable: number;
  totalRequired: number;
  net: number;
  groups: AvailabilityGroupReportCell[];
}

export interface AvailabilityReportRow {
  isoDate: string;
  dateLabel: string;
  dayLabel: string;
  availability: Record<AvailabilityShiftCode, number>;
  net: Record<AvailabilityShiftCode, number>;
  shifts: Record<AvailabilityShiftCode, AvailabilityShiftReportSection>;
}

export interface MonthlyAvailabilityReport {
  monthLabel: string;
  rows: AvailabilityReportRow[];
  requirements: {
    totals: Record<AvailabilityShiftCode, number>;
    groups: Array<{
      group: GroupNum;
      label: string;
      shortLabel: string;
      morningAfternoon: number;
      night: number;
    }>;
  };
}

function normalizeUpper(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function memberDisplayName(member: Pick<SummaryScheduleMember, "employee_name" | "employee_id">) {
  return String(member.employee_name || member.employee_id || "").trim();
}

function memberKey(member: Pick<SummaryScheduleMember, "employee_id" | "employee_name">) {
  return String(member.employee_id || member.employee_name || "").trim().toUpperCase() || "UNKNOWN";
}

export function buildMonthDateKeys(referenceDate: Date) {
  return eachDayOfInterval({
    start: startOfMonth(referenceDate),
    end: endOfMonth(referenceDate),
  }).map((date) => format(date, "yyyy-MM-dd"));
}

export function matchesSummaryCategory(category: string, member: SummaryScheduleMember) {
  const rating = normalizeUpper(member.highest_rating);
  const designation = normalizeUpper(member.designation);
  const gender = normalizeUpper(member.gender);

  switch (category) {
    case "RSR+UBN":
      return rating === "RSR+UBN";
    case "RSR":
      return rating === "RSR" || (rating.startsWith("RSR+") && rating !== "RSR+UBN");
    case "ASR+RSR":
      return rating === "ASR+RSR";
    case "ASR+APP":
      return rating === "ASR+APP";
    case "ACC-PLR":
      return rating === "ACC-PLR";
    case "OCC+ACC-PLR":
      return rating === "OCC+ACC-PLR";
    case "ADC+ACC-PLR":
      return rating === "ADC+ACC-PLR";
    case "ACC-PLR+ACC-P":
      return rating === "ACC-PLR+ACC-P";
    case "ADC+ACC-P":
      return rating === "ADC+ACC-P";
    case "ACC-P+OCC":
      return rating === "ACC-P+OCC";
    case "OCC":
      return rating === "OCC";
    case "ADC/SMC":
      return rating === "ADC/SMC" || rating === "ADC" || rating === "SMC";
    case "ALPHA":
      return rating === "ALPHA" || designation.includes("ALPHA");
    case "SAR TRAINED ATCOs": {
      const ratingSummary = member.rating_summary || {};
      return Boolean(ratingSummary["SAR"] || ratingSummary["SAR & AIS"] || ratingSummary["AIS"]);
    }
    case "WSO": {
      const ratingSummary = member.rating_summary || {};
      return Boolean(ratingSummary["WSO"]);
    }
    case "FEMALE ATCOs IN SHIFT":
      return gender === "F" || gender === "FEMALE";
    default:
      return false;
  }
}

export function getInstructorQualificationKeys(member: SummaryScheduleMember) {
  const validityKeys = Object.keys(member.instructor_validity || {});
  const ojtiKeys = Object.entries(member.ojti || {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);

  return Array.from(new Set([...validityKeys, ...ojtiKeys].map((key) => normalizeUpper(key)).filter(Boolean)));
}

export function matchesInstructorSector(category: (typeof INSTRUCTOR_SECTOR_ROWS)[number], member: SummaryScheduleMember) {
  const keys = getInstructorQualificationKeys(member);
  if (keys.length === 0) return false;

  switch (category) {
    case "INSTR ADC":
      return keys.some((key) => key.includes("ADC"));
    case "INSTR APP":
      return keys.some((key) => key.includes("APP"));
    case "INSTR ACC":
      return keys.some((key) => key.includes("ACC"));
    case "INSTR OCC":
      return keys.some((key) => key.includes("OCC"));
    case "INSTR PLR":
      return keys.some((key) => key.includes("PLR"));
    default:
      return false;
  }
}

export function hasAnyInstructorQualification(member: SummaryScheduleMember) {
  return getInstructorQualificationKeys(member).length > 0;
}

export function countUniqueMembers(members: SummaryScheduleMember[]) {
  return new Set(members.map(memberKey)).size;
}

export function getHighestRating(members: SummaryScheduleMember[]) {
  let bestRank = RATING_RANK.length;
  let bestLabel = "";
  const seen = new Set<string>();

  members.forEach((member) => {
    const key = memberKey(member);
    if (seen.has(key)) return;
    seen.add(key);

    const rating = normalizeUpper(member.highest_rating);
    if (!rating) return;

    const rank = RATING_RANK.indexOf(rating);
    if (rank !== -1 && rank < bestRank) {
      bestRank = rank;
      bestLabel = rating;
    }
  });

  return bestLabel;
}

export function getSufficiencyColor(count: number, minimum: number): string {
  const delta = count - minimum;

  if (delta < 0) {
    if (delta <= -2) {
      return "bg-rose-200/95 ring-1 ring-inset ring-rose-300/70 dark:bg-rose-900/70 dark:ring-rose-700/50";
    }

    return "bg-rose-100/95 ring-1 ring-inset ring-rose-200/70 dark:bg-rose-900/55 dark:ring-rose-700/45";
  }

  if (delta === 0) {
    return "bg-amber-100/95 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-900/55 dark:ring-amber-700/45";
  }

  if (delta === 1) {
    return "bg-emerald-200/95 ring-1 ring-inset ring-emerald-300/75 dark:bg-emerald-900/55 dark:ring-emerald-700/50";
  }

  if (delta === 2) {
    return "bg-emerald-300/95 ring-1 ring-inset ring-emerald-400/75 dark:bg-emerald-800/65 dark:ring-emerald-600/55";
  }

  return "bg-emerald-400/95 ring-1 ring-inset ring-emerald-500/80 dark:bg-emerald-700/80 dark:ring-emerald-500/60";
}

export function buildMembersByCell(scheduleMembers: SummaryScheduleMember[], activeDateKeys: Iterable<string>) {
  const activeDateKeySet = new Set(activeDateKeys);
  const membersByCell = new Map<string, SummaryScheduleMember[]>();

  scheduleMembers.forEach((member) => {
    if (!activeDateKeySet.has(member.duty_date)) return;
    if (!memberDisplayName(member)) return;

    getDutyShiftMatches(member.duty_code)
      .filter((shiftCode): shiftCode is AvailabilityShiftCode => shiftCode === "M" || shiftCode === "A" || shiftCode === "N")
      .forEach((shiftCode) => {
        const key = `${member.duty_date}::${shiftCode}`;
        const existing = membersByCell.get(key) || [];
        existing.push(member);
        membersByCell.set(key, existing);
      });
  });

  return membersByCell;
}

function getRequiredCountForGroup(group: GroupNum, shiftCode: AvailabilityShiftCode) {
  return shiftCode === "N" ? GROUP_SHIFT_MINIMUMS[group][1] : GROUP_SHIFT_MINIMUMS[group][0];
}

function getShiftTeamCodeForDate(isoDate: string, shiftCode: AvailabilityShiftCode) {
  const teamCode = ROTATION_TEAM_KEYS.find((teamKey) => getTeamDutyForDateKey(teamKey, isoDate) === shiftCode);
  return teamCode || shiftCode;
}

function buildShiftSection(
  isoDate: string,
  shiftCode: AvailabilityShiftCode,
  membersByCell: Map<string, SummaryScheduleMember[]>,
): AvailabilityShiftReportSection {
  const cellMembers = membersByCell.get(`${isoDate}::${shiftCode}`) || [];
  const groups = (Object.keys(RATING_GROUPS).map(Number) as GroupNum[]).map((group) => {
    const available = countUniqueMembers(
      cellMembers.filter((member) => RATING_GROUPS[group].categories.some((category) => matchesSummaryCategory(category, member))),
    );
    const required = getRequiredCountForGroup(group, shiftCode);

    return {
      group,
      label: RATING_GROUPS[group].shortLabel,
      available,
      required,
      net: available - required,
      colorClass: getSufficiencyColor(available, required),
    } satisfies AvailabilityGroupReportCell;
  });

  const totalAvailable = groups.reduce((sum, group) => sum + group.available, 0);
  const totalRequired = TOTAL_SHIFT_REQUIREMENTS[shiftCode];

  return {
    shiftCode,
    teamCode: getShiftTeamCodeForDate(isoDate, shiftCode),
    totalAvailable,
    totalRequired,
    net: totalAvailable - totalRequired,
    groups,
  };
}

export function buildMonthlyAvailabilityReport(referenceDate: Date, scheduleMembers: SummaryScheduleMember[]): MonthlyAvailabilityReport {
  const monthDateKeys = buildMonthDateKeys(referenceDate);
  const membersByCell = buildMembersByCell(scheduleMembers, monthDateKeys);
  const rows = eachDayOfInterval({
    start: startOfMonth(referenceDate),
    end: endOfMonth(referenceDate),
  }).map((date) => {
    const isoDate = format(date, "yyyy-MM-dd");
    const shifts = {
      M: buildShiftSection(isoDate, "M", membersByCell),
      A: buildShiftSection(isoDate, "A", membersByCell),
      N: buildShiftSection(isoDate, "N", membersByCell),
    } satisfies Record<AvailabilityShiftCode, AvailabilityShiftReportSection>;

    const availability = {
      M: countUniqueMembers(membersByCell.get(`${isoDate}::M`) || []),
      A: countUniqueMembers(membersByCell.get(`${isoDate}::A`) || []),
      N: countUniqueMembers(membersByCell.get(`${isoDate}::N`) || []),
    } satisfies Record<AvailabilityShiftCode, number>;

    return {
      isoDate,
      dateLabel: format(date, "d-MMM-yyyy"),
      dayLabel: format(date, "EEE"),
      availability,
      net: {
        M: availability.M - TOTAL_SHIFT_REQUIREMENTS.M,
        A: availability.A - TOTAL_SHIFT_REQUIREMENTS.A,
        N: availability.N - TOTAL_SHIFT_REQUIREMENTS.N,
      },
      shifts,
    } satisfies AvailabilityReportRow;
  });

  return {
    monthLabel: format(referenceDate, "MMMM yyyy"),
    rows,
    requirements: {
      totals: TOTAL_SHIFT_REQUIREMENTS,
      groups: (Object.keys(RATING_GROUPS).map(Number) as GroupNum[]).map((group) => ({
        group,
        label: RATING_GROUPS[group].label,
        shortLabel: RATING_GROUPS[group].shortLabel,
        morningAfternoon: GROUP_SHIFT_MINIMUMS[group][0],
        night: GROUP_SHIFT_MINIMUMS[group][1],
      })),
    },
  };
}