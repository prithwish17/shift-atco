import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { buildNameIndex, findUniqueNameMatch } from "@/lib/nameMatching";
import { getRosterDateQueryValues } from "@/lib/rosterDate";
import {
  buildShiftRosterFromRosters,
  buildShiftRosterFromSchedules,
  type ScheduleRosterRow,
  type ShiftRosterDay,
} from "@/lib/shiftRoster";
import type { RosterEntry } from "@/hooks/useRosters";

/**
 * useShiftRoster — one day of roster, sized for a free-tier project.
 *
 * Every query here is scoped to a single date and selects only the columns the
 * view renders, so a page load costs a few KB rather than the whole table.  The
 * month-wide Daily Availability Chart pages the entire `rosters` table; this
 * deliberately does not, because it is mounted for every employee.
 *
 * The profile lookup used by the fallback is cached under its own key so
 * flicking between dates reuses it instead of refetching per day.
 */

/** Roster rows are small but a single day should never be unbounded. */
const ROSTER_ROW_LIMIT = 2000;

const PROFILE_QUERY_KEY = ["shift-roster-profiles"] as const;
/** Profiles change rarely — hold them for the session rather than per date. */
const PROFILE_STALE_TIME = 30 * 60_000;

interface ProfileTeamRecord {
  employee_id: string | null;
  full_name: string | null;
  current_shift: string | null;
}

async function fetchProfileTeams(): Promise<ProfileTeamRecord[]> {
  // `is_hidden` is missing from the generated types; filtering on it through
  // the typed builder blows the instantiation depth limit, so the builder is
  // widened first — the result is asserted back to a narrow shape below.
  const { data, error } = await (supabase.from("profiles") as any)
    .select("employee_id, full_name, current_shift")
    .neq("is_hidden", true);

  if (error) throw error;
  return (data || []) as ProfileTeamRecord[];
}

async function fetchRosterRowsForDate(isoDate: string): Promise<RosterEntry[]> {
  const dateValues = getRosterDateQueryValues(isoDate);
  if (dateValues.length === 0) return [];

  // `rosters.date` is a text column holding several legacy spellings, so the
  // day is matched by value list rather than a range predicate.
  const { data, error } = await supabase
    .from("rosters")
    .select("id, date, shift, team, unit, employee_name, position, row_index")
    .in("date", dateValues)
    .limit(ROSTER_ROW_LIMIT);

  if (error) throw error;
  return (data || []) as RosterEntry[];
}

async function fetchScheduleRowsForDate(isoDate: string, queryClient: QueryClient): Promise<ScheduleRosterRow[]> {
  const { data, error } = await supabase
    .from("employee_schedules" as any)
    .select("employee_code, employee_name, duty_code, duty_description")
    .eq("duty_date", isoDate)
    .limit(ROSTER_ROW_LIMIT);

  if (error) throw error;

  // `employee_schedules` is absent from the generated types, so the row shape
  // cannot be inferred and has to be asserted through `unknown`.
  const scheduleRows = (data || []) as unknown as ScheduleRosterRow[];
  if (scheduleRows.length === 0) return [];

  const profiles = await queryClient.fetchQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: fetchProfileTeams,
    staleTime: PROFILE_STALE_TIME,
  });

  const profileById = new Map(
    profiles.map((profile) => [String(profile.employee_id || "").trim(), profile]),
  );
  const profileByName = buildNameIndex(profiles, (profile) => profile.full_name);

  return scheduleRows.map((row) => {
    const code = String(row.employee_code || "").trim();
    const profile = profileById.get(code) || findUniqueNameMatch(profileByName, row.employee_name);
    return { ...row, team: profile?.current_shift ?? null };
  });
}

/**
 * The day plus the rows it was built from.  The grid view rebuilds the sheet's
 * matrix out of `unit` × `position`, which `ShiftRosterDay` has already flattened
 * away — carrying the rows here keeps that to one query rather than two.
 */
export interface ShiftRosterResult extends ShiftRosterDay {
  rows: RosterEntry[];
}

export function useShiftRoster(isoDate: string) {
  const queryClient = useQueryClient();

  return useQuery<ShiftRosterResult>({
    queryKey: ["shift-roster", isoDate],
    enabled: Boolean(isoDate),
    // Roster edits land through a sync, not continuously, so a longer window
    // here is the single biggest saving on a shared free-tier project.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    // Deliberately no placeholderData: showing the previous date's rows under a
    // newly-picked date is worse than a brief skeleton, and the view already
    // renders the shift/team header instantly from the rotation rule.
    queryFn: async () => {
      const rosterRows = await fetchRosterRowsForDate(isoDate);
      const fromRosters = buildShiftRosterFromRosters(rosterRows, isoDate);
      if (fromRosters.totalMembers > 0) return { ...fromRosters, rows: rosterRows };

      // Nothing published for this date — derive the day from duty codes so
      // the view still answers "who is on this shift".  The grid needs the
      // sheet's own unit/position coordinates, which duty codes do not carry,
      // so `rows` stays empty and the grid view falls back to the list.
      const scheduleRows = await fetchScheduleRowsForDate(isoDate, queryClient);
      const fromSchedules = buildShiftRosterFromSchedules(scheduleRows, isoDate);
      // Preserve the empty-but-valid shape (with rotation teams) when neither
      // source has rows, so the header still shows the teams on duty.
      const day = fromSchedules.totalMembers > 0 ? fromSchedules : fromRosters;
      return { ...day, rows: [] };
    },
  });
}
