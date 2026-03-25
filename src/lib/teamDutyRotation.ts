import { differenceInCalendarDays, parseISO } from "date-fns";

export type TeamDutyCode = "M" | "A" | "N" | "NO" | "CO";

export const DUTY_CYCLE: TeamDutyCode[] = ["M", "A", "N", "NO", "CO"];

export const TEAM_DUTY_BASE: Record<string, TeamDutyCode> = {
  A: "N",
  B: "A",
  C: "M",
  D: "CO",
  E: "NO",
  G: "M",
};

export const DUTY_ROTATION_ANCHOR_DATE_IST = "2026-03-09";

const HOLIDAY_CODES = new Set(["NO", "CO", "SAT", "SUN", "CH", "NH", "NA", "SL", "GO", "TR"]);

const SPECIAL_DUTY_MATCH: Record<string, TeamDutyCode[]> = {
  "M+A": ["M", "A"],
  "NO+N": ["N"],
  "SAT+NO": ["NO"],
  "SUN+N": ["N"],
  "SUN+M": ["M"],
  "SUN+A": ["A"],
  "SUN+NO": ["NO"],
  "SAT+N": ["N"],
  "CO+N": ["N"],
  "CO+A": ["A"],
  "CO+M": ["M"],
  "A+M": ["A", "M"],
  SL: ["CO"],
  TR: ["CO"],
  GO: ["CO"],
};

export function normalizeTeamKey(value?: string | null) {
  if (!value) return "G";
  const normalized = value.toUpperCase().trim();
  return normalized === "GENERAL" ? "G" : normalized || "G";
}

export function getTeamDutyForDateKey(teamKey: string, dateKey: string): TeamDutyCode {
  const normalizedTeam = normalizeTeamKey(teamKey);
  const base = TEAM_DUTY_BASE[normalizedTeam] || "M";
  const baseIndex = DUTY_CYCLE.indexOf(base);
  const offset = differenceInCalendarDays(parseISO(dateKey), parseISO(DUTY_ROTATION_ANCHOR_DATE_IST));
  const idx = (baseIndex + (offset % DUTY_CYCLE.length) + DUTY_CYCLE.length) % DUTY_CYCLE.length;
  return DUTY_CYCLE[idx];
}

export function getTeamDutyLabel(duty: TeamDutyCode) {
  switch (duty) {
    case "M":
      return "Morning";
    case "A":
      return "Afternoon";
    case "N":
      return "Night";
    case "NO":
      return "Night Off";
    case "CO":
      return "Clear Off";
    default:
      return duty;
  }
}

export function parseDutyTokens(dutyCode?: string | null) {
  if (!dutyCode) return [];
  return dutyCode
    .toUpperCase()
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
}

export function normalizeAttendanceShiftToken(token: string) {
  const normalized = token.trim().toUpperCase();
  if (normalized === "GENERAL" || normalized === "GO") return "G";
  return normalized;
}

export function getAttendanceShiftTokens(dutyCode?: string | null) {
  return parseDutyTokens(dutyCode).map(normalizeAttendanceShiftToken);
}

export function getDutyShiftMatches(dutyCode: string | null | undefined) {
  if (!dutyCode) return [] as TeamDutyCode[];
  const normalized = dutyCode.toUpperCase().trim();
  const explicit = SPECIAL_DUTY_MATCH[normalized];
  if (explicit) return explicit;

  const tokens = parseDutyTokens(normalized);
  return tokens.filter((token): token is TeamDutyCode =>
    token === "M" || token === "A" || token === "N" || token === "NO" || token === "CO"
  );
}

export function isEligibleDutyForAttendance(dutyCode: string | null | undefined, teamDuty: TeamDutyCode) {
  if (teamDuty === "NO" || teamDuty === "CO") return false;

  const matches = getDutyShiftMatches(dutyCode);
  if (matches.length === 0 || !matches.includes(teamDuty)) return false;

  const tokens = parseDutyTokens(dutyCode);
  if (tokens.every((token) => HOLIDAY_CODES.has(token))) return false;
  return true;
}

export function isHolidayOrOffDuty(dutyCode: string | null | undefined) {
  const tokens = parseDutyTokens(dutyCode);
  if (tokens.length === 0) return false;
  return tokens.every((token) => HOLIDAY_CODES.has(token));
}
