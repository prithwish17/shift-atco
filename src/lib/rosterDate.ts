import { format, parse } from "date-fns";

export const ROSTER_DATE_FORMATS = [
  "dd-MMM-yyyy",
  "d-MMM-yyyy",
  "yyyy-MM-dd",
  "dd/MM/yyyy",
  "d/M/yyyy",
  "dd-MM-yyyy",
  "M/d/yyyy",
  "MM/dd/yyyy",
] as const;

export function parseRosterDate(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  for (const formatString of ROSTER_DATE_FORMATS) {
    const parsed = parse(raw, formatString, new Date());
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

export function getRosterDateQueryValues(targetIsoDate?: string) {
  if (!targetIsoDate) return [];
  const parsed = parse(targetIsoDate, "yyyy-MM-dd", new Date());
  if (Number.isNaN(parsed.getTime())) return [targetIsoDate];

  return [...new Set([
    format(parsed, "d-MMM-yyyy"),
    format(parsed, "dd-MMM-yyyy"),
    format(parsed, "yyyy-MM-dd"),
    format(parsed, "dd/MM/yyyy"),
    format(parsed, "d/M/yyyy"),
    format(parsed, "dd-MM-yyyy"),
    format(parsed, "M/d/yyyy"),
    format(parsed, "MM/dd/yyyy"),
  ])];
}
