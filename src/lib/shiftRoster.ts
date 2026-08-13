import { format } from "date-fns";

import { parseRosterDate } from "@/lib/rosterDate";
import { getDutyShiftMatches, getTeamDutyForDateKey, normalizeTeamKey } from "@/lib/teamDutyRotation";
import type { RosterEntry } from "@/hooks/useRosters";

/**
 * shiftRoster.ts — turns a date into a ready-to-render shift roster.
 *
 * The whole point of this module is that nobody picks a team or a shift by
 * hand.  Given a date, the 5-day rotation in `teamDutyRotation` already says
 * which team is on Morning, Afternoon and Night, so the view derives its own
 * columns.  Roster rows are then dropped into those columns.
 */

export type ShiftCode = "M" | "A" | "N";

export interface ShiftSlot {
  code: ShiftCode;
  name: string;
  /** Duty window from dutyConfig's shift model, for the column subtitle. */
  window: string;
}

export const SHIFT_SLOTS: ShiftSlot[] = [
  { code: "M", name: "Morning", window: "0700 – 1300" },
  { code: "A", name: "Afternoon", window: "1300 – 1900" },
  { code: "N", name: "Night", window: "1900 – 0700" },
];

/** Teams that take part in the M/A/N/NO/CO rotation. "G" is general duty. */
const ROTATION_TEAMS = ["A", "B", "C", "D", "E"];

const SHIFT_NAME_TO_CODE: Record<string, ShiftCode> = {
  MORNING: "M",
  AFTERNOON: "A",
  NIGHT: "N",
  M: "M",
  A: "A",
  N: "N",
};

const EXTRA_DUTY_LABELS = ["EXTRA DUTY"];
const DUTY_CHANGE_LABELS = ["DUTY CHANGE", "DUTY EXCHANGE"];

export interface ShiftRosterMember {
  /** Stable per-row key: rows have no reliable id in the schedules fallback. */
  key: string;
  name: string;
  /**
   * Duty annotation — from the roster's `position` column, which the sync fills
   * from position/mark/remark/half (ACC, ALPHA, EXTRA DUTY, LEAVE, …).
   * Rendered under the name.
   */
  duty: string;
  /**
   * Operational position / sector — from the roster's `unit` column
   * (UBN, UKN, ACC-PLR, WSO, …).  Rendered as the badge.
   */
  position: string;
  /** Team the person belongs to, not the team that owns the shift. */
  team: string;
  /** True when this person is not from the team rostered onto this shift. */
  isOffTeam: boolean;
}

export interface ShiftRosterGroup {
  code: ShiftCode;
  name: string;
  window: string;
  /** Team(s) the rotation puts on this shift — normally exactly one. */
  teams: string[];
  members: ShiftRosterMember[];
  extraDuty: ShiftRosterMember[];
  dutyChange: ShiftRosterMember[];
  onLeave: ShiftRosterMember[];
}

export interface ShiftRosterDay {
  isoDate: string;
  groups: ShiftRosterGroup[];
  /** Teams resting that day, shown as context under the columns. */
  nightOffTeams: string[];
  clearOffTeams: string[];
  /** Where the rows came from — the UI says so when it had to fall back. */
  source: "rosters" | "schedules" | "empty";
  totalMembers: number;
}

function normalizeUpper(value?: string | null) {
  return String(value || "").trim().toUpperCase();
}

function toShiftCode(value?: string | null): ShiftCode | null {
  return SHIFT_NAME_TO_CODE[normalizeUpper(value)] ?? null;
}

/**
 * Which team the rotation puts on each shift for `isoDate`.  Returns arrays
 * because a hand-edited rotation could in principle double up; the normal
 * case is one team per shift.
 */
export function getShiftTeamsForDate(isoDate: string): Record<ShiftCode, string[]> {
  const teams: Record<ShiftCode, string[]> = { M: [], A: [], N: [] };
  if (!isoDate) return teams;

  for (const team of ROTATION_TEAMS) {
    const duty = getTeamDutyForDateKey(team, isoDate);
    if (duty === "M" || duty === "A" || duty === "N") {
      teams[duty].push(team);
    }
  }

  return teams;
}

/**
 * The single team the rotation puts on one shift of one date.
 *
 * Accepts either a shift name ("Morning") or a code ("M"), so callers that
 * already work in shift names — like the ATC duty grid — can use it directly.
 * Returns "" when the shift cannot be read, which callers treat as "not ready"
 * rather than guessing a team.
 */
export function getTeamForDateAndShift(isoDate: string, shift: string): string {
  const code = toShiftCode(shift);
  if (!code || !isoDate) return "";
  return getShiftTeamsForDate(isoDate)[code][0] ?? "";
}

/** Teams on Night-Off / Clear-Off for `isoDate`. */
export function getOffDutyTeamsForDate(isoDate: string) {
  const nightOffTeams: string[] = [];
  const clearOffTeams: string[] = [];
  if (!isoDate) return { nightOffTeams, clearOffTeams };

  for (const team of ROTATION_TEAMS) {
    const duty = getTeamDutyForDateKey(team, isoDate);
    if (duty === "NO") nightOffTeams.push(team);
    if (duty === "CO") clearOffTeams.push(team);
  }

  return { nightOffTeams, clearOffTeams };
}

/**
 * The shift running at `now`, so a phone opening the page lands on the shift
 * that is actually on duty rather than always on Morning.
 */
export function getCurrentShiftCode(now: Date = new Date()): ShiftCode {
  const hour = now.getHours();
  if (hour >= 7 && hour < 13) return "M";
  if (hour >= 13 && hour < 19) return "A";
  return "N";
}

function classifyRosterRow(position: string, duty: string) {
  const haystack = `${normalizeUpper(position)} ${normalizeUpper(duty)}`;
  if (EXTRA_DUTY_LABELS.some((label) => haystack.includes(label))) return "extra" as const;
  if (DUTY_CHANGE_LABELS.some((label) => haystack.includes(label))) return "change" as const;
  if (haystack.includes("LEAVE")) return "leave" as const;
  return "duty" as const;
}

function compareMembers(left: ShiftRosterMember, right: ShiftRosterMember) {
  const positionDelta = left.position.localeCompare(right.position);
  if (positionDelta !== 0) return positionDelta;
  return left.name.localeCompare(right.name);
}

function createEmptyGroups(isoDate: string): ShiftRosterGroup[] {
  const shiftTeams = getShiftTeamsForDate(isoDate);
  return SHIFT_SLOTS.map((slot) => ({
    code: slot.code,
    name: slot.name,
    window: slot.window,
    teams: shiftTeams[slot.code],
    members: [],
    extraDuty: [],
    dutyChange: [],
    onLeave: [],
  }));
}

function pushMember(group: ShiftRosterGroup, member: ShiftRosterMember, bucket: ReturnType<typeof classifyRosterRow>) {
  if (bucket === "extra") group.extraDuty.push(member);
  else if (bucket === "change") group.dutyChange.push(member);
  else if (bucket === "leave") group.onLeave.push(member);
  else group.members.push(member);
}

/**
 * Primary path: rows synced into the `rosters` table, which carry unit and
 * position detail.  Rows whose shift cannot be read are dropped — they have no
 * column to land in.
 */
export function buildShiftRosterFromRosters(entries: RosterEntry[], isoDate: string): ShiftRosterDay {
  const groups = createEmptyGroups(isoDate);
  const groupByCode = new Map(groups.map((group) => [group.code, group]));

  entries.forEach((entry, index) => {
    const parsed = parseRosterDate(entry.date);
    if (!parsed || format(parsed, "yyyy-MM-dd") !== isoDate) return;

    const shiftCode = toShiftCode(entry.shift);
    if (!shiftCode) return;

    const group = groupByCode.get(shiftCode);
    if (!group) return;

    const name = String(entry.employee_name || "").trim();
    const position = String(entry.unit || "").trim();
    const duty = String(entry.position || "").trim();
    if (!name && !position) return;

    const team = normalizeTeamKey(entry.team);

    pushMember(
      group,
      {
        key: entry.id || `${shiftCode}-${index}-${name}`,
        name,
        duty,
        position,
        team,
        isOffTeam: team !== "G" && group.teams.length > 0 && !group.teams.includes(team),
      },
      classifyRosterRow(position, duty),
    );
  });

  return finalizeDay(groups, isoDate, "rosters");
}

export interface ScheduleRosterRow {
  employee_code: string | null;
  employee_name: string | null;
  duty_code: string | null;
  duty_description: string | null;
  /** Team from the employee's profile, when it could be resolved. */
  team?: string | null;
}

/**
 * Fallback path: derive the roster from duty codes in `employee_schedules`
 * when the external sync has not populated `rosters` for this date.  There is
 * no unit/position detail here, so members carry their duty description
 * instead — enough to answer "who is on this shift".
 */
export function buildShiftRosterFromSchedules(rows: ScheduleRosterRow[], isoDate: string): ShiftRosterDay {
  const groups = createEmptyGroups(isoDate);
  const groupByCode = new Map(groups.map((group) => [group.code, group]));

  rows.forEach((row, index) => {
    const name = String(row.employee_name || "").trim();
    if (!name) return;

    const dutyCode = String(row.duty_code || "").trim();
    const matches = getDutyShiftMatches(dutyCode).filter(
      (code): code is ShiftCode => code === "M" || code === "A" || code === "N",
    );
    if (matches.length === 0) return;

    const team = normalizeTeamKey(row.team);
    // A compound code such as "A+M" means the person is doing an extra duty on
    // top of their own shift, which is exactly the Extra Duty bucket.
    const isCompound = dutyCode.includes("+");

    // No unit/sector detail exists in the schedules table, so the duty line
    // carries the description and the badge carries the raw code — falling back
    // to the code alone rather than printing it twice.
    const description = String(row.duty_description || "").trim();

    matches.forEach((shiftCode) => {
      const group = groupByCode.get(shiftCode);
      if (!group) return;

      const isOffTeam = team !== "G" && group.teams.length > 0 && !group.teams.includes(team);

      pushMember(
        group,
        {
          key: `${row.employee_code || name}-${shiftCode}-${index}`,
          name,
          duty: description || dutyCode.toUpperCase(),
          position: description ? dutyCode.toUpperCase() : "",
          team,
          isOffTeam,
        },
        isCompound ? "extra" : "duty",
      );
    });
  });

  return finalizeDay(groups, isoDate, "schedules");
}

function finalizeDay(
  groups: ShiftRosterGroup[],
  isoDate: string,
  source: ShiftRosterDay["source"],
): ShiftRosterDay {
  groups.forEach((group) => {
    group.members.sort(compareMembers);
    group.extraDuty.sort(compareMembers);
    group.dutyChange.sort(compareMembers);
    group.onLeave.sort(compareMembers);
  });

  const { nightOffTeams, clearOffTeams } = getOffDutyTeamsForDate(isoDate);
  const totalMembers = groups.reduce(
    (sum, group) => sum + group.members.length + group.extraDuty.length + group.dutyChange.length + group.onLeave.length,
    0,
  );

  return {
    isoDate,
    groups,
    nightOffTeams,
    clearOffTeams,
    source: totalMembers === 0 ? "empty" : source,
    totalMembers,
  };
}

/** Case-insensitive match across the fields a user would search on. */
export function memberMatchesSearch(member: ShiftRosterMember, search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) return true;

  return [member.name, member.duty, member.position, member.team]
    .some((value) => String(value || "").toLowerCase().includes(normalized));
}

/** Applies a search term across every bucket, keeping the group shape intact. */
export function filterShiftRosterDay(day: ShiftRosterDay, search: string): ShiftRosterDay {
  if (!search.trim()) return day;

  const groups = day.groups.map((group) => ({
    ...group,
    members: group.members.filter((member) => memberMatchesSearch(member, search)),
    extraDuty: group.extraDuty.filter((member) => memberMatchesSearch(member, search)),
    dutyChange: group.dutyChange.filter((member) => memberMatchesSearch(member, search)),
    onLeave: group.onLeave.filter((member) => memberMatchesSearch(member, search)),
  }));

  const totalMembers = groups.reduce(
    (sum, group) => sum + group.members.length + group.extraDuty.length + group.dutyChange.length + group.onLeave.length,
    0,
  );

  return { ...day, groups, totalMembers };
}
