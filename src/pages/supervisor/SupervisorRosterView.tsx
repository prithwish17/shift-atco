import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eachDayOfInterval, addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { Calendar, CalendarRange, ChevronLeft, ChevronRight, Search, Sparkles, Table2, X } from "lucide-react";

import { DashboardLayout } from "@/components/DashboardLayout";
import { MobileZoomFrame } from "@/components/MobileZoomFrame";
import RosterViewTable from "@/components/RosterViewTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { normalizeEmployeeMatchName } from "@/lib/nameMatching";
import {
  SUPERVISOR_EMPTY_STATE_LARGE,
  SUPERVISOR_MONTH_PILL,
  SUPERVISOR_STATUS_BADGE_LOADING,
  SUPERVISOR_STATUS_PANEL,
  SUPERVISOR_STATUS_SHELL_ERROR,
  SUPERVISOR_STATUS_SHELL_LOADING,
  SUPERVISOR_STATUS_SUBPANEL,
  SUPERVISOR_TOOLBAR_GROUP,
  SUPERVISOR_TOOLBAR_ICON_BUTTON,
  SUPERVISOR_TOOLBAR_SHELL,
  getSupervisorLegendTone,
} from "@/lib/supervisorTableTheme";
import { supabase } from "@/integrations/supabase/client";
import { buildRosterMatrix, SHIFT_NAME_TO_DUTY_CODE, SHIFT_ORDER, type RosterMatrixData, type RosterMatrixRow } from "@/lib/rosterMatrix";
import { parseRosterDate, type RosterEntry } from "@/hooks/useRosters";
import { getDutyShiftMatches, normalizeTeamKey, type TeamDutyCode } from "@/lib/teamDutyRotation";
import { useNavigate } from "react-router-dom";
import { getSufficiencyColor, type SummaryScheduleMember } from "@/lib/supervisorAvailability";
import { useSupervisorScheduleMembers } from "@/hooks/useSupervisorScheduleMembers";
import { useToast } from "@/hooks/use-toast";
import { logSupervisorEdit } from "@/lib/supervisorAuditLog";

const SECTION_CONFIG = {
  ownTeam: { label: "OWN TEAM DUTY", minRows: 0, rowType: "ownTeam" as const },
  extra: { label: "EXTRA DUTY", minRows: 0, rowType: "extra" as const },
  normal: { label: "NORMAL DUTY", minRows: 0, rowType: "normal" as const },
  general: { label: "GENERAL DUTY", minRows: 0, rowType: "general" as const },
};

const SUMMARY_CATEGORIES = [
  "AVAIL. ATCOs",
  "HIGHEST RATING",
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
  "ALPHA",
  "WSO",
  "SAR TRAINED ATCOs",
  "FEMALE ATCOs IN SHIFT",
] as const;

const MOBILE_ROSTER_SCALE = 0.65;

const INSTRUCTOR_SECTOR_ROWS = [
  "INSTR ADC",
  "INSTR APP",
  "INSTR ACC",
  "INSTR OCC",
  "INSTR PLR",
] as const;

const SHIFT_NAME_TO_CODE: Record<string, Extract<TeamDutyCode, "M" | "A" | "N">> = {
  Morning: "M",
  Afternoon: "A",
  Night: "N",
};

function normalizeUpper(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function pushUniqueValue(map: Map<string, string[]>, key: string, value: string) {
  if (!value) return;
  const existing = map.get(key) || [];
  if (!existing.includes(value)) {
    existing.push(value);
    map.set(key, existing);
  }
}

function hasCompoundDutyCode(dutyCode?: string | null) {
  return String(dutyCode || "").includes("+");
}

function isGeneralDutyMember(member: SummaryScheduleMember) {
  const dutyCode = normalizeUpper(member.duty_code);
  const dutyDescription = normalizeUpper(member.duty_description);
  return dutyCode === "G" || dutyCode === "GO" || dutyDescription.includes("GENERAL");
}

function memberDisplayName(member: Pick<SummaryScheduleMember, "employee_name" | "employee_id">) {
  return String(member.employee_name || member.employee_id || "").trim();
}

function buildStackedSectionRows(
  matrixData: RosterMatrixData,
  valuesByCell: Map<string, string[]>,
  config: { label: string; minRows: number; rowType: RosterMatrixRow["rowType"] },
) {
  const maxRowsNeeded = matrixData.dates.reduce((maxCount, dateColumn) => {
    const dateMax = SHIFT_ORDER.reduce((shiftMax, shiftName) => {
      const shiftCode = SHIFT_NAME_TO_DUTY_CODE[shiftName];
      const count = (valuesByCell.get(`${dateColumn.isoDate}::${shiftCode}`) || []).length;
      return Math.max(shiftMax, count);
    }, 0);

    return Math.max(maxCount, dateMax);
  }, 0);

  const rowCount = Math.max(config.minRows, maxRowsNeeded);
  if (rowCount === 0) return [];

  // Section header row
  const headerRow: RosterMatrixRow = {
    slNo: "",
    unit: config.label,
    cells: Array(matrixData.dates.length * SHIFT_ORDER.length).fill(""),
    rowType: "header",
  };

  // Person rows
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    slNo: "",
    unit: `Person ${i + 1}`,
    cells: Array(matrixData.dates.length * SHIFT_ORDER.length).fill(""),
    rowType: config.rowType,
  } satisfies RosterMatrixRow));

  matrixData.dates.forEach((dateColumn, dateIndex) => {
    SHIFT_ORDER.forEach((shiftName, shiftIndex) => {
      const shiftCode = SHIFT_NAME_TO_DUTY_CODE[shiftName];
      const values = valuesByCell.get(`${dateColumn.isoDate}::${shiftCode}`) || [];

      values.forEach((value, valueIndex) => {
        if (!rows[valueIndex]) return;
        rows[valueIndex].cells[dateIndex * SHIFT_ORDER.length + shiftIndex] = value;
      });
    });
  });

  return [headerRow, ...rows];
}

function buildShiftTeamLookup(matrixData: RosterMatrixData) {
  const teamByCell = new Map<string, string>();

  matrixData.dates.forEach((dateColumn) => {
    SHIFT_ORDER.forEach((shiftName, shiftIndex) => {
      const shiftCode = SHIFT_NAME_TO_DUTY_CODE[shiftName];
      const teamCode = normalizeTeamKey(dateColumn.shiftCodes[shiftIndex]);
      teamByCell.set(`${dateColumn.isoDate}::${shiftCode}`, teamCode);
    });
  });

  return teamByCell;
}

function buildScheduleDutyRows(matrixData: RosterMatrixData, scheduleMembers: SummaryScheduleMember[]) {
  if (matrixData.dates.length === 0) return [] as RosterMatrixRow[];

  const activeDateKeys = new Set(matrixData.dates.map((dateColumn) => dateColumn.isoDate));
  const shiftTeamLookup = buildShiftTeamLookup(matrixData);
  const ownTeamValuesByCell = new Map<string, string[]>();
  const extraValuesByCell = new Map<string, string[]>();
  const normalValuesByCell = new Map<string, string[]>();
  const generalValuesByCell = new Map<string, string[]>();

  scheduleMembers.forEach((member) => {
    if (!activeDateKeys.has(member.duty_date)) return;

    const displayName = memberDisplayName(member);
    if (!displayName) return;

    const shiftMatches = getDutyShiftMatches(member.duty_code).filter(
      (shiftCode): shiftCode is Extract<TeamDutyCode, "M" | "A" | "N"> =>
        shiftCode === "M" || shiftCode === "A" || shiftCode === "N",
    );

    shiftMatches.forEach((shiftCode) => {
      const cellKey = `${member.duty_date}::${shiftCode}`;

      // Extra duty: compound duty codes (contains "+")
      if (hasCompoundDutyCode(member.duty_code)) {
        pushUniqueValue(extraValuesByCell, cellKey, displayName);
        return;
      }

      // General duty
      if (isGeneralDutyMember(member)) {
        pushUniqueValue(generalValuesByCell, cellKey, displayName);
        return;
      }

      const memberTeam = normalizeTeamKey(member.current_shift);
      const allottedTeam = shiftTeamLookup.get(cellKey);

      // Bug fix: G-shift members with a non-general duty code must appear in
      // Normal Duty (general-pool filling a regular slot). Previously they were
      // silently dropped, which made AVAIL. ATCOs > total names in lists.
      if (memberTeam === "G") {
        pushUniqueValue(normalValuesByCell, cellKey, displayName);
        return;
      }

      // Bug fix: if the roster matrix has no team assignment for this cell,
      // fall back to Own Team Duty instead of silently dropping the member.
      if (!allottedTeam) {
        pushUniqueValue(ownTeamValuesByCell, cellKey, displayName);
        return;
      }

      if (memberTeam === allottedTeam) {
        // Own team: same team, simple duty code
        pushUniqueValue(ownTeamValuesByCell, cellKey, displayName);
      } else {
        // Normal duty: different team, simple duty code
        pushUniqueValue(normalValuesByCell, cellKey, displayName);
      }
    });
  });

  return [
    ...buildStackedSectionRows(matrixData, ownTeamValuesByCell, SECTION_CONFIG.ownTeam),
    ...buildStackedSectionRows(matrixData, extraValuesByCell, SECTION_CONFIG.extra),
    ...buildStackedSectionRows(matrixData, normalValuesByCell, SECTION_CONFIG.normal),
    ...buildStackedSectionRows(matrixData, generalValuesByCell, SECTION_CONFIG.general),
  ];
}

/**
 * Build a map of candidate name lists per cell key for the Extra Duty section.
 * Rules:
 *   Morning cell (::M) → Afternoon-shift workers (duty resolves to "A")
 *   Afternoon cell (::A) → Morning-shift workers (duty resolves to "M")
 *   Night cell (::N) → Night-Off workers (duty_code === "NO")
 * Excludes names already assigned to that cell.
 */
function buildExtraDutyCandidates(
  matrixData: RosterMatrixData,
  scheduleMembers: SummaryScheduleMember[],
): Map<string, string[]> {
  const activeDateKeys = new Set(matrixData.dates.map((d) => d.isoDate));

  // Build set of already-assigned names per extra cell (compound codes + user selections)
  const assignedByCell = new Map<string, Set<string>>();
  scheduleMembers.forEach((member) => {
    if (!activeDateKeys.has(member.duty_date)) return;
    if (!hasCompoundDutyCode(member.duty_code)) return;
    const displayName = memberDisplayName(member);
    if (!displayName) return;
    const shiftMatches = getDutyShiftMatches(member.duty_code ?? "").filter(
      (s): s is "M" | "A" | "N" => s === "M" || s === "A" || s === "N",
    );
    shiftMatches.forEach((shiftCode) => {
      const key = `${member.duty_date}::${shiftCode}`;
      if (!assignedByCell.has(key)) assignedByCell.set(key, new Set());
      assignedByCell.get(key)!.add(displayName);
    });
  });

  const candidatesByCell = new Map<string, string[]>();

  scheduleMembers.forEach((member) => {
    if (!activeDateKeys.has(member.duty_date)) return;
    const displayName = memberDisplayName(member);
    if (!displayName) return;

    const dutyCode = normalizeUpper(member.duty_code);

    // Night-Off workers → candidates for Night column
    if (dutyCode === "NO") {
      const cellKey = `${member.duty_date}::N`;
      if (!assignedByCell.get(cellKey)?.has(displayName)) {
        pushUniqueValue(candidatesByCell, cellKey, displayName);
      }
      return;
    }

    // Skip members already doing extra (compound) duty
    if (hasCompoundDutyCode(member.duty_code)) return;

    const shiftMatches = getDutyShiftMatches(dutyCode).filter(
      (s): s is "M" | "A" | "N" => s === "M" || s === "A" || s === "N",
    );

    shiftMatches.forEach((shiftCode) => {
      // Cross-shift rule: Morning workers → Afternoon column, Afternoon workers → Morning column
      const targetShift: "M" | "A" | null =
        shiftCode === "M" ? "A" : shiftCode === "A" ? "M" : null;
      if (!targetShift) return;

      const cellKey = `${member.duty_date}::${targetShift}`;
      if (!assignedByCell.get(cellKey)?.has(displayName)) {
        pushUniqueValue(candidatesByCell, cellKey, displayName);
      }
    });
  });

  // Sort each candidate list alphabetically
  candidatesByCell.forEach((names, key) => {
    candidatesByCell.set(key, [...names].sort());
  });

  return candidatesByCell;
}

function memberKey(member: Pick<SummaryScheduleMember, "employee_id" | "employee_name">) {
  return member.employee_id || normalizeEmployeeMatchName(member.employee_name) || "unknown";
}

function matchesSummaryCategory(category: string, member: SummaryScheduleMember) {
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
      const rs = member.rating_summary || {};
      // Value may be "SAR", "YES", or other non-empty string — any non-empty value counts
      return Boolean(rs["SAR"] || rs["SAR & AIS"] || rs["AIS"]);
    }
    case "WSO": {
      const rs = member.rating_summary || {};
      return Boolean(rs["WSO"]);
    }
    case "FEMALE ATCOs IN SHIFT":
      // gender stored as "F" or "FEMALE" from employee data sync
      return gender === "F" || gender === "FEMALE";
    default:
      return false;
  }
}

function getInstructorQualificationKeys(member: SummaryScheduleMember) {
  const validityKeys = Object.keys(member.instructor_validity || {});
  const ojtiKeys = Object.entries(member.ojti || {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);

  return Array.from(new Set([...validityKeys, ...ojtiKeys].map((key) => normalizeUpper(key)).filter(Boolean)));
}

function matchesInstructorSector(category: (typeof INSTRUCTOR_SECTOR_ROWS)[number], member: SummaryScheduleMember) {
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

function hasAnyInstructorQualification(member: SummaryScheduleMember) {
  return getInstructorQualificationKeys(member).length > 0;
}

function countUniqueMembers(members: SummaryScheduleMember[]) {
  return new Set(members.map(memberKey)).size;
}

// Rating hierarchy from highest to lowest for "HIGHEST RATING" summary
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

function getHighestRating(members: SummaryScheduleMember[]): string {
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

// ── Manpower group definitions ───────────────────────────────────────────────
type GroupNum = 1 | 2 | 3 | 4 | 5;

const RATING_GROUPS: Record<GroupNum, { label: string; categories: string[] }> = {
  1: { label: "Group 1 — RSR", categories: ["RSR+UBN", "RSR"] },
  2: { label: "Group 2 — ASR", categories: ["ASR+RSR", "ASR+APP"] },
  3: { label: "Group 3 — ACC/OCC", categories: ["ACC-PLR", "OCC+ACC-PLR", "ADC+ACC-PLR", "ACC-PLR+ACC-P", "ADC+ACC-P", "ACC-P+OCC"] },
  4: { label: "Group 4 — ADC/SMC", categories: ["ADC/SMC"] },
  5: { label: "Group 5 — ALPHA", categories: ["ALPHA"] },
};

// OCC-related ratings used for the OCC constraint check
const OCC_RATING_CATEGORIES = ["OCC", "OCC+ACC-PLR", "ACC-P+OCC"];

const CATEGORY_TO_GROUP: Record<string, GroupNum> = {
  "RSR+UBN": 1, "RSR": 1,
  "ASR+RSR": 2, "ASR+APP": 2,
  "ACC-PLR": 3, "OCC+ACC-PLR": 3, "ADC+ACC-PLR": 3, "ACC-PLR+ACC-P": 3, "ADC+ACC-P": 3, "ACC-P+OCC": 3,
  "ADC/SMC": 4, "ALPHA": 5,
};

// [morning/afternoon minimum, night minimum]
const GROUP_SHIFT_MINIMUMS: Record<GroupNum, [number, number]> = {
  1: [12, 16], 2: [4, 4], 3: [11, 10], 4: [9, 9], 5: [11, 10],
};
const OCC_SHIFT_MINIMUMS: [number, number] = [4, 7]; // M/A >3 means >=4, N >6 means >=7

function buildSummaryRows(
  matrixData: RosterMatrixData,
  scheduleMembers: SummaryScheduleMember[],
): RosterMatrixRow[] {
  if (matrixData.dates.length === 0) return [];

  const activeDateKeys = new Set(matrixData.dates.map((dateColumn) => dateColumn.isoDate));
  const membersByCell = new Map<string, SummaryScheduleMember[]>();

  scheduleMembers.forEach((member) => {
    if (!activeDateKeys.has(member.duty_date)) return;
    // Bug fix: exclude members with no resolvable display name so AVAIL. ATCOs
    // count stays consistent with the duty lists, which also skip nameless members.
    if (!memberDisplayName(member)) return;

    getDutyShiftMatches(member.duty_code)
      .filter((shiftCode): shiftCode is Extract<TeamDutyCode, "M" | "A" | "N"> =>
        shiftCode === "M" || shiftCode === "A" || shiftCode === "N",
      )
      .forEach((shiftCode) => {
        const key = `${member.duty_date}::${shiftCode}`;
        const existing = membersByCell.get(key) || [];
        existing.push(member);
        membersByCell.set(key, existing);
      });
  });

  const ALL_COUNTED_CATEGORIES = [
    "AVAIL. ATCOs", "RSR+UBN", "RSR", "ASR+RSR", "ASR+APP",
    "ACC-PLR", "OCC+ACC-PLR", "ADC+ACC-PLR", "ACC-PLR+ACC-P", "ADC+ACC-P", "ACC-P+OCC",
    "OCC", "ADC/SMC", "ALPHA", "WSO", "SAR TRAINED ATCOs", "FEMALE ATCOs IN SHIFT",
    ...INSTRUCTOR_SECTOR_ROWS,
  ];

  // Fix 5: Pre-classify each unique member into their matching categories once.
  // Old approach: O(categories × cells × members) — matchesSummaryCategory ran
  // for every (category, cell) pair.
  // New approach: classify each unique member once → O(members × categories),
  // then count per cell by set-lookup → O(cells × members).
  const memberCats = new Map<string, Set<string>>();
  const getOrClassify = (member: SummaryScheduleMember): Set<string> => {
    const key = memberKey(member);
    let cats = memberCats.get(key);
    if (!cats) {
      cats = new Set<string>();
      for (const cat of ALL_COUNTED_CATEGORIES) {
        if (cat === "AVAIL. ATCOs") continue;
        const isInstructor = INSTRUCTOR_SECTOR_ROWS.includes(cat as (typeof INSTRUCTOR_SECTOR_ROWS)[number]);
        const matches = isInstructor
          ? matchesInstructorSector(cat as (typeof INSTRUCTOR_SECTOR_ROWS)[number], member)
          : matchesSummaryCategory(cat, member);
        if (matches) cats.add(cat);
      }
      memberCats.set(key, cats);
    }
    return cats;
  };

  // ── Pass 1: compute every category count per cell ───────────────────────
  const catCount = new Map<string, number>(); // key: `${cellKey}::${category}`
  for (const dateColumn of matrixData.dates) {
    for (const shiftName of SHIFT_ORDER) {
      const shiftCode = SHIFT_NAME_TO_CODE[shiftName];
      const cellKey = `${dateColumn.isoDate}::${shiftCode}`;
      const members = membersByCell.get(cellKey) || [];

      // AVAIL. ATCOs: unique member count (unchanged)
      catCount.set(`${cellKey}::AVAIL. ATCOs`, countUniqueMembers(members));

      // All other categories: build a per-category set of unique member keys using
      // the pre-classified category sets — one pass over members per cell.
      const perCatSeen = new Map<string, Set<string>>();
      for (const member of members) {
        const mk = memberKey(member);
        for (const cat of getOrClassify(member)) {
          let seen = perCatSeen.get(cat);
          if (!seen) { seen = new Set(); perCatSeen.set(cat, seen); }
          seen.add(mk);
        }
      }
      for (const cat of ALL_COUNTED_CATEGORIES) {
        if (cat === "AVAIL. ATCOs") continue;
        catCount.set(`${cellKey}::${cat}`, perCatSeen.get(cat)?.size ?? 0);
      }
    }
  }

  // ── Helpers that use the fully-populated catCount ─────────────────────
  const getCount = (cellKey: string, cat: string) => catCount.get(`${cellKey}::${cat}`) || 0;

  const getGroupTotal = (cellKey: string, gn: GroupNum) =>
    RATING_GROUPS[gn].categories.reduce((sum, cat) => sum + getCount(cellKey, cat), 0);

  const getOccTotal = (cellKey: string) =>
    OCC_RATING_CATEGORIES.reduce((sum, cat) => sum + getCount(cellKey, cat), 0);

  const getInstructorZeroHighlight = (count: number) =>
    count === 0 ? "bg-red-200 dark:bg-red-950/70" : "";

  const buildCatRow = (category: string): RosterMatrixRow => {
    const cells = matrixData.dates.flatMap((d) =>
      SHIFT_ORDER.map((s) => {
        const ck = `${d.isoDate}::${SHIFT_NAME_TO_CODE[s]}`;
        if (category === "HIGHEST RATING") return getHighestRating(membersByCell.get(ck) || []);
        return String(getCount(ck, category));
      }),
    );

    const cellColors = INSTRUCTOR_SECTOR_ROWS.includes(category as (typeof INSTRUCTOR_SECTOR_ROWS)[number])
      ? matrixData.dates.flatMap((d) =>
          SHIFT_ORDER.map((s) => {
            const ck = `${d.isoDate}::${SHIFT_NAME_TO_CODE[s]}`;
            return getInstructorZeroHighlight(getCount(ck, category));
          }),
        )
      : undefined;

    const displayLabel = INSTRUCTOR_SECTOR_ROWS.includes(category as (typeof INSTRUCTOR_SECTOR_ROWS)[number])
      ? category.replace(/^INSTR\s+/, "")
      : category;

    return { slNo: "", unit: displayLabel, rowType: "summary" as const, cells, cellColors };
  };

  const buildGroupHeader = (gn: GroupNum): RosterMatrixRow => {
    const [mMin, nMin] = GROUP_SHIFT_MINIMUMS[gn];
    const cells = matrixData.dates.flatMap((d) =>
      SHIFT_ORDER.map((s) => String(getGroupTotal(`${d.isoDate}::${SHIFT_NAME_TO_CODE[s]}`, gn))),
    );
    const cellColors = matrixData.dates.flatMap((d) =>
      SHIFT_ORDER.map((s) => {
        const ck = `${d.isoDate}::${SHIFT_NAME_TO_CODE[s]}`;
        return getSufficiencyColor(getGroupTotal(ck, gn), GROUP_SHIFT_MINIMUMS[gn][s === "Night" ? 1 : 0]);
      }),
    );
    return {
      slNo: "", unit: `${RATING_GROUPS[gn].label}  (M/A ≥${mMin}, N ≥${nMin})`,
      rowType: "header" as const, cells, cellColors,
    };
  };

  const buildOccHeader = (): RosterMatrixRow => ({
    slNo: "", unit: "OCC Constraint  (M/A >3, N >6)",
    rowType: "header" as const,
    cells: matrixData.dates.flatMap((d) =>
      SHIFT_ORDER.map((s) => String(getOccTotal(`${d.isoDate}::${SHIFT_NAME_TO_CODE[s]}`))),
    ),
    cellColors: matrixData.dates.flatMap((d) =>
      SHIFT_ORDER.map((s) => {
        const ck = `${d.isoDate}::${SHIFT_NAME_TO_CODE[s]}`;
        return getSufficiencyColor(getOccTotal(ck), OCC_SHIFT_MINIMUMS[s === "Night" ? 1 : 0]);
      }),
    ),
  });

  const buildInstructorHeader = (): RosterMatrixRow => ({
    slNo: "",
    unit: "Instructor Coverage",
    rowType: "header" as const,
    cells: matrixData.dates.flatMap((d) =>
      SHIFT_ORDER.map((s) => {
        const ck = `${d.isoDate}::${SHIFT_NAME_TO_CODE[s]}`;
        return String(countUniqueMembers((membersByCell.get(ck) || []).filter((member) => hasAnyInstructorQualification(member))));
      }),
    ),
    cellColors: matrixData.dates.flatMap((d) =>
      SHIFT_ORDER.map((s) => {
        const ck = `${d.isoDate}::${SHIFT_NAME_TO_CODE[s]}`;
        return getInstructorZeroHighlight(
          countUniqueMembers((membersByCell.get(ck) || []).filter((member) => hasAnyInstructorQualification(member))),
        );
      }),
    ),
  });

  // ── Assemble final output in grouped order ───────────────────────────────
  return [
    buildCatRow("AVAIL. ATCOs"),
    buildInstructorHeader(),
    ...INSTRUCTOR_SECTOR_ROWS.map((category) => buildCatRow(category)),
    // Group 1
    buildGroupHeader(1),
    buildCatRow("RSR+UBN"),
    buildCatRow("RSR"),
    // Group 2
    buildGroupHeader(2),
    buildCatRow("ASR+RSR"),
    buildCatRow("ASR+APP"),
    // Group 3
    buildGroupHeader(3),
    buildCatRow("ACC-PLR"),
    buildCatRow("OCC+ACC-PLR"),
    buildCatRow("ADC+ACC-PLR"),
    buildCatRow("ACC-PLR+ACC-P"),
    buildCatRow("ADC+ACC-P"),
    buildCatRow("ACC-P+OCC"),
    // OCC sub-constraint
    buildOccHeader(),
    buildCatRow("OCC"),
    // Group 4
    buildGroupHeader(4),
    buildCatRow("ADC/SMC"),
    // Group 5
    buildGroupHeader(5),
    buildCatRow("ALPHA"),
    // Ungrouped
    buildCatRow("WSO"),
    buildCatRow("SAR TRAINED ATCOs"),
    buildCatRow("FEMALE ATCOs IN SHIFT"),
  ];
}

// Minimum width (px) below which the roster table becomes harder to use
const MIN_USEFUL_WIDTH = 800;

export default function SupervisorRosterView() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [monthOffset, setMonthOffset] = useState(0);
  const [windowTooSmall, setWindowTooSmall] = useState(() => window.innerWidth < MIN_USEFUL_WIDTH);
  const [windowWarnDismissed, setWindowWarnDismissed] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const check = () => {
      const tooSmall = window.innerWidth < MIN_USEFUL_WIDTH;
      setWindowTooSmall(tooSmall);
      if (!tooSmall) setWindowWarnDismissed(false);
    };
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Always cover the full selected month regardless of what roster data exists
  const currentMonthDateKeys = useMemo(() => {
    const target = addMonths(new Date(), monthOffset);
    return eachDayOfInterval({ start: startOfMonth(target), end: endOfMonth(target) }).map((d) =>
      format(d, "yyyy-MM-dd"),
    );
  }, [monthOffset]);

  const { data: rosterRows = [], isLoading, isError, refetch } = useQuery<RosterEntry[]>({
    // Fix 3: Include monthOffset in the query key so each month gets its own
    // cache entry — previously all months shared the same stale cache.
    queryKey: ["supervisor-roster-view", monthOffset],
    queryFn: async () => {
      // Fix 2: Reduced limit from 10K → 5K.
      // A single month's roster entries are typically 300-500 rows.
      const { data: rosterRows, error } = await (supabase.from("rosters" as any)
        .select("id, date, shift, team, unit, employee_name, position, created_at")
        .order("created_at", { ascending: false })
        .limit(5000));

      if (error) throw error;
      return ((rosterRows || []) as unknown) as RosterEntry[];
    },
    staleTime: 60_000,
  });

  const matrixData = useMemo(() => buildRosterMatrix(rosterRows, addMonths(new Date(), monthOffset)), [rosterRows, monthOffset]);

  const scheduleRangeStart = currentMonthDateKeys[0];
  const scheduleRangeEnd = currentMonthDateKeys[currentMonthDateKeys.length - 1];
  const { data: scheduleMembers = [], isLoading: scheduleMembersLoading } = useSupervisorScheduleMembers(
    scheduleRangeStart,
    scheduleRangeEnd,
  );

  const updateDutyMutation = useMutation({
    mutationFn: async ({ employeeCode, date, newDutyCode }: { employeeCode: string; date: string; newDutyCode: string; context?: string }) => {
      const { error } = await supabase
        .from("employee_schedules" as any)
        .update({ duty_code: newDutyCode })
        .eq("employee_code", employeeCode)
        .eq("duty_date", date);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["supervisor-schedule-members"] });
      toast({
        title: "Schedule Updated",
        description: "Duty code was synchronized successfully.",
      });
      logSupervisorEdit({
        action: "update",
        table: "employee_schedules",
        description: variables.context
          ? `${variables.context}: ${variables.employeeCode} on ${variables.date} → ${variables.newDutyCode}`
          : `Schedule duty changed: ${variables.employeeCode} on ${variables.date} → ${variables.newDutyCode}`,
        recordId: `${variables.employeeCode}::${variables.date}`,
        after: { duty_code: variables.newDutyCode },
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onAddExtraDuty = useCallback((cellKey: string, name: string) => {
    const [date, shift] = cellKey.split("::");
    const member = scheduleMembers.find((m) => memberDisplayName(m) === name && m.duty_date === date);
    if (!member || !member.employee_id) return;

    let newDutyCode = "";
    if (shift === "M") newDutyCode = "A+M";
    else if (shift === "A") newDutyCode = "M+A";
    else if (shift === "N") newDutyCode = "NO+N";

    if (newDutyCode) {
      updateDutyMutation.mutate({ employeeCode: member.employee_id, date, newDutyCode, context: `Mark extra duty (${shift})` });
    }
  }, [scheduleMembers, updateDutyMutation]);

  const onRemoveExtraDuty = useCallback((cellKey: string, name: string) => {
    const [date, shift] = cellKey.split("::");
    const member = scheduleMembers.find((m) => memberDisplayName(m) === name && m.duty_date === date);
    if (!member || !member.employee_id) return;

    let revertCode = "";
    if (shift === "M") revertCode = "A";
    else if (shift === "A") revertCode = "M";
    else if (shift === "N") revertCode = "NO";

    if (revertCode) {
      updateDutyMutation.mutate({ employeeCode: member.employee_id, date, newDutyCode: revertCode, context: `Remove extra duty / undo (${shift})` });
    }
  }, [scheduleMembers, updateDutyMutation]);

  const data = useMemo<RosterMatrixData>(() => {
    const scheduleDutyRows = buildScheduleDutyRows(matrixData, scheduleMembers);
    const summaryRows = buildSummaryRows(matrixData, scheduleMembers);

    let dutyRowCounter = 1;
    const numberedScheduleDutyRows = scheduleDutyRows.map((row) => {
      if (row.rowType === "header") {
        return {
          ...row,
          slNo: "",
        };
      }

      const nextRow = {
        ...row,
        slNo: String(dutyRowCounter),
      };

      dutyRowCounter += 1;
      return nextRow;
    });

    const topSummaryRows = summaryRows.map((row) => ({
      ...row,
      slNo: "",
    }));

    const combinedRows = [...topSummaryRows, ...numberedScheduleDutyRows];

    return {
      ...matrixData,
      rows: combinedRows,
    };
  }, [matrixData, scheduleMembers]);

  const extraDutyCandidates = useMemo(
    () => buildExtraDutyCandidates(matrixData, scheduleMembers),
    [matrixData, scheduleMembers],
  );

  const dateOptions = useMemo(() => data.dates.map((dateColumn) => dateColumn.date), [data.dates]);

  const pageIsLoading = isLoading || scheduleMembersLoading;

  if (pageIsLoading) {
    return (
      <DashboardLayout role="supervisor">
        <MobileZoomFrame mobileScale={MOBILE_ROSTER_SCALE} mobileMode="zoom">
          <div className={SUPERVISOR_STATUS_SHELL_LOADING}>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(6,182,212,0.16),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(99,102,241,0.12),_transparent_28%)] dark:bg-[radial-gradient(circle_at_top_right,_rgba(34,211,238,0.18),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(99,102,241,0.12),_transparent_24%)]" />
          <div className="absolute right-0 top-0 h-40 w-40 translate-x-10 -translate-y-10 rounded-full bg-cyan-200/35 blur-3xl dark:bg-cyan-500/20" />
          <div className="absolute bottom-0 left-0 h-32 w-32 -translate-x-8 translate-y-8 rounded-full bg-indigo-200/35 blur-3xl dark:bg-indigo-500/20" />

          <div className="relative flex min-h-[calc(100vh-140px)] items-center justify-center p-5 md:p-8">
            <div className={SUPERVISOR_STATUS_PANEL}>
              <div className={SUPERVISOR_STATUS_BADGE_LOADING}>
                <Sparkles className="h-3.5 w-3.5" />
                Live View
              </div>

              <div className="relative h-16 w-16">
                <div className="absolute inset-0 rounded-full border-4 border-slate-200 dark:border-slate-700" />
                <div className="absolute inset-0 rounded-full border-4 border-cyan-500 border-t-transparent animate-spin dark:border-cyan-400" />
                <Table2 className="absolute inset-0 m-auto h-6 w-6 text-cyan-600 dark:text-cyan-300" />
              </div>

              <div className="space-y-2">
                <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">Loading Daily Availability Chart</h2>
                <p className="mx-auto max-w-sm text-sm leading-6 text-slate-600 dark:text-slate-300">
                  Fetching roster data and computing shift availability across all teams. This may take a moment.
                </p>
              </div>

              <div className={SUPERVISOR_STATUS_SUBPANEL}>
                <div className="flex items-center gap-3">
                  <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                    isLoading ? "bg-cyan-500 animate-pulse" : "bg-emerald-500"
                  }`} />
                  <span className="text-xs text-slate-600 dark:text-slate-300">
                    {isLoading ? "Loading roster entries..." : "Roster entries loaded"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                    scheduleMembersLoading ? "bg-cyan-500 animate-pulse" : isLoading ? "bg-slate-300 dark:bg-slate-600" : "bg-emerald-500"
                  }`} />
                  <span className="text-xs text-slate-600 dark:text-slate-300">
                    {scheduleMembersLoading ? "Loading employee schedules and profiles..." : isLoading ? "Waiting..." : "Schedules loaded"}
                  </span>
                </div>
              </div>
            </div>
          </div>
          </div>
        </MobileZoomFrame>
      </DashboardLayout>
    );
  }

  if (isError || !data) {
    return (
      <DashboardLayout role="supervisor">
        <MobileZoomFrame mobileScale={MOBILE_ROSTER_SCALE} mobileMode="zoom">
          <div className={SUPERVISOR_STATUS_SHELL_ERROR}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(251,113,133,0.14),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(244,63,94,0.1),_transparent_22%)] dark:bg-[radial-gradient(circle_at_top_right,_rgba(251,113,133,0.14),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(244,63,94,0.1),_transparent_22%)]" />
            <div className="relative flex min-h-[calc(100vh-140px)] items-center justify-center p-5 md:p-8">
              <div className={SUPERVISOR_STATUS_PANEL}>
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-rose-200/80 bg-white/80 text-rose-600 shadow-sm dark:border-rose-800/60 dark:bg-rose-950/50 dark:text-rose-200">
                  <Table2 className="h-6 w-6" />
                </div>
                <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">Unable to load roster view</h1>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-300">The live roster data could not be loaded right now.</p>
                <Button
                  type="button"
                  className="mt-5 h-10 rounded-xl bg-slate-900 px-5 text-sm font-medium text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                  onClick={() => refetch()}
                >
                  Retry
                </Button>
              </div>
            </div>
          </div>
        </MobileZoomFrame>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role="supervisor">
      <MobileZoomFrame mobileScale={MOBILE_ROSTER_SCALE} mobileMode="zoom">
        <div className="flex flex-col gap-2">
        {/* ── Compact controls toolbar ── */}
        <div className={SUPERVISOR_TOOLBAR_SHELL}>
          {/* Month navigation */}
          <div className={SUPERVISOR_TOOLBAR_GROUP}>

            <button
              type="button"
              onClick={() => { setMonthOffset((o) => o - 1); setSelectedDate(""); }}
              className={SUPERVISOR_TOOLBAR_ICON_BUTTON}
              aria-label="Previous month"
            >
              <ChevronLeft size={14} />
            </button>
            <div className={SUPERVISOR_MONTH_PILL}>
              {data.monthLabel}
            </div>
            <button
              type="button"
              onClick={() => { setMonthOffset((o) => o + 1); setSelectedDate(""); }}
              className={SUPERVISOR_TOOLBAR_ICON_BUTTON}
              aria-label="Next month"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Employee search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" size={13} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employees"
              className="h-8 w-44 rounded-xl border-slate-200 bg-white pl-8 pr-3 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-52"
            />
          </div>

          {/* Jump to date */}
          <Select value={selectedDate} onValueChange={setSelectedDate}>
            <SelectTrigger className="h-8 w-36 rounded-xl border-slate-200 bg-white text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:w-40">
              <Calendar size={13} className="mr-1.5 shrink-0 text-slate-400 dark:text-slate-500" />
              <SelectValue placeholder="Jump to date" />
            </SelectTrigger>
            <SelectContent>
              {dateOptions.map((dateValue) => (
                <SelectItem key={dateValue} value={dateValue} className="text-xs">
                  {dateValue}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            type="button"
            variant="outline"
            className="h-8 rounded-xl border-blue-600 bg-blue-600 px-3 text-xs font-medium text-white shadow-sm transition hover:border-blue-700 hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-500 dark:text-white dark:hover:border-blue-400 dark:hover:bg-blue-400"
            onClick={() => navigate("/supervisor/availability-report")}
          >
            <CalendarRange className="mr-1.5 h-3.5 w-3.5 text-white" />
            Summary view
          </Button>

        </div>

        {/* ── Dynamic roster table — fills remaining viewport height ── */}
        {data.dates.length === 0 || data.rows.length === 0 ? (
          <div className={SUPERVISOR_EMPTY_STATE_LARGE}>
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-slate-200/80 bg-white/80 text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <Table2 className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">No roster data available</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Live roster entries are not available for the current view yet.</p>
            </div>
          </div>
        ) : (
          <RosterViewTable
            data={data}
            searchTerm={search}
            selectedDate={selectedDate}
            mobileScale={MOBILE_ROSTER_SCALE}
            extraDutyCandidates={extraDutyCandidates}
            onAddExtraDuty={onAddExtraDuty}
            onRemoveExtraDuty={onRemoveExtraDuty}
          />
        )}
        </div>
      </MobileZoomFrame>
      {windowTooSmall && !windowWarnDismissed && (
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 flex justify-center px-4 pb-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-amber-300/80 bg-amber-50 px-4 py-2.5 shadow-lg ring-1 ring-amber-200/60 dark:border-amber-700/60 dark:bg-amber-950/90 dark:ring-amber-800/50">
            <span className="text-amber-500 dark:text-amber-400" aria-hidden>⚠️</span>
            <p className="text-[13px] font-medium text-amber-900 dark:text-amber-200">
              Window size is too small — increase the window width for best experience.
            </p>
            <button
              onClick={() => setWindowWarnDismissed(true)}
              className="ml-1 rounded-full p-0.5 text-amber-600 hover:bg-amber-200/60 dark:text-amber-400 dark:hover:bg-amber-800/60"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}