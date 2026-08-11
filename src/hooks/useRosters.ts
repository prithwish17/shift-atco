import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { getFunctionsProxyBaseUrl } from "@/lib/appConfig";
import { logCriticalEvent } from "@/lib/sentryHelpers";
import { getRosterDateQueryValues, getRosterDateRangeQueryValues, parseRosterDate } from "@/lib/rosterDate";
import { getRosterTeamQueryValues, normalizeRosterTeamKey } from "@/lib/rosterTeam";

export { parseRosterDate } from "@/lib/rosterDate";

export interface RosterEntry {
  id?: string;
  date: string;
  shift: string;
  team: string;
  unit: string;
  employee_name: string;
  position: string;
  created_at?: string;
}

const SPECIAL_ROSTER_LABELS = ["EXTRA DUTY", "DUTY CHANGE", "DUTY EXCHANGE"];

function sanitizeFilterValue(value?: string) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === "all") return undefined;
  return normalized;
}

function normalizeRosterTeam(value?: string | null) {
  return normalizeRosterTeamKey(value);
}

function normalizeRosterShift(value?: string | null) {
  return String(value || "").trim().toUpperCase();
}

function matchesRosterDate(value: string | undefined, targetIsoDate?: string) {
  if (!targetIsoDate) return true;
  const parsed = parseRosterDate(value);
  return parsed ? format(parsed, "yyyy-MM-dd") === targetIsoDate : false;
}

function matchesRosterSearch(entry: RosterEntry, search?: string) {
  const normalizedSearch = String(search || "").trim().toLowerCase();
  if (!normalizedSearch) return true;

  return [entry.employee_name, entry.unit, entry.position, entry.team, entry.shift, entry.date]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => value.includes(normalizedSearch));
}

function isSpecialRosterEntry(entry: RosterEntry) {
  const unit = String(entry.unit || "").trim().toUpperCase();
  const position = String(entry.position || "").trim().toUpperCase();
  return SPECIAL_ROSTER_LABELS.some((label) => unit.includes(label) || position.includes(label));
}

// Fetch fresh data from the Google Apps Script via edge function
export function useFetchRoster() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ team, shift, date }: { team: string; shift: string; date?: string }) => {
      const payload = { team, shift, date };

      const { data, error } = await supabase.functions.invoke("fetch-roster", {
        body: payload,
      });

      if (!error) {
        return ((data as { data?: RosterEntry[] } | null)?.data || []) as RosterEntry[];
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw error;

      const base = import.meta.env.DEV ? getFunctionsProxyBaseUrl() : window.location.origin;

      const res = await fetch(`${base}/api/functions/fetch-roster`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || contentType.includes("text/html")) {
        const errBody = contentType.includes("application/json")
          ? await res.json().catch(() => ({}))
          : {};
        const errorMsg =
          (errBody as { error?: string }).error ||
          error.message ||
          `Failed to fetch roster${contentType.includes("text/html") ? ": received HTML instead of JSON" : ""}`;
        logCriticalEvent('roster_generation_failure', {
          statusCode: res.status,
          contentType,
          team: payload.team,
          shift: payload.shift,
        });
        throw new Error(errorMsg);
      }

      const json = await res.json();
      return (json.data || []) as RosterEntry[];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rosters"] });
      queryClient.invalidateQueries({ queryKey: ["my-roster"] });
    },
  });
}

// Read persisted rosters from Supabase
export function useRosters(filters?: {
  team?: string;
  shift?: string;
  search?: string;
  date?: string;
  excludeSpecialEntries?: boolean;
}) {
  const teamFilter = sanitizeFilterValue(filters?.team);
  const shiftFilter = sanitizeFilterValue(filters?.shift);
  const searchFilter = sanitizeFilterValue(filters?.search);
  const dateFilter = sanitizeFilterValue(filters?.date);
  const dateQueryValues = getRosterDateQueryValues(dateFilter);
  const teamQueryValues = teamFilter ? getRosterTeamQueryValues(teamFilter) : [];
  const excludeSpecialEntries = !!filters?.excludeSpecialEntries;

  return useQuery({
    queryKey: ["rosters", teamFilter, shiftFilter, searchFilter, dateFilter, excludeSpecialEntries],
    queryFn: async () => {
      // Push team and shift filters to the database so the limit(5000) is
      // applied AFTER pre-filtering, not across the whole table.  Without this,
      // when the rosters table exceeds 5000 rows (easy at scale: teams × shifts
      // × dates × employees), the oldest-inserted shift gets silently dropped
      // and appears missing on every date.
      //
      // Fix: When both team and shift filters are applied, a single slice
      // rarely exceeds 5000 rows so a simple .limit(5000) suffices.
      // When either filter is "all" (unset), paginate to avoid truncation
      // that silently drops E team data.
      const hasNarrowFilter = Boolean(teamFilter && shiftFilter);

      if (hasNarrowFilter) {
        // Narrowly filtered — single page is safe
        let query = (supabase.from("rosters" as any) as any)
          .select("*")
          .order("created_at", { ascending: false })
          .in("team", teamQueryValues)
          .ilike("shift", shiftFilter!);

        if (dateQueryValues.length > 0) query = query.in("date", dateQueryValues);

        const { data, error } = await query.limit(5000);

        if (error) throw error;

        return ((data || []) as unknown as RosterEntry[]).filter((entry) => {
          if (teamFilter && normalizeRosterTeam(entry.team) !== normalizeRosterTeam(teamFilter)) return false;
          if (shiftFilter && normalizeRosterShift(entry.shift) !== normalizeRosterShift(shiftFilter)) return false;
          if (!matchesRosterDate(entry.date, dateFilter)) return false;
          if (!matchesRosterSearch(entry, searchFilter)) return false;
          if (excludeSpecialEntries && isSpecialRosterEntry(entry)) return false;
          return true;
        });
      }

      // Broad query (all teams or all shifts) — paginate to avoid truncation
      const PAGE_SIZE = 5000;
      let allRows: RosterEntry[] = [];
      let from = 0;
      let hasMore = true;

      while (hasMore) {
        let query = (supabase.from("rosters" as any) as any)
          .select("*")
          .order("created_at", { ascending: false });

        if (dateQueryValues.length > 0) query = query.in("date", dateQueryValues);
        if (teamFilter) query = query.in("team", teamQueryValues);
        if (shiftFilter) query = query.ilike("shift", shiftFilter);

        const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
        if (error) throw error;

        const rows = (data || []) as unknown as RosterEntry[];
        allRows = allRows.concat(rows);
        hasMore = rows.length === PAGE_SIZE;
        from += PAGE_SIZE;

        if (allRows.length >= 30_000) break;
      }

      return allRows.filter((entry) => {
        if (teamFilter && normalizeRosterTeam(entry.team) !== normalizeRosterTeam(teamFilter)) return false;
        if (shiftFilter && normalizeRosterShift(entry.shift) !== normalizeRosterShift(shiftFilter)) return false;
        if (!matchesRosterDate(entry.date, dateFilter)) return false;
        if (!matchesRosterSearch(entry, searchFilter)) return false;
        if (excludeSpecialEntries && isSpecialRosterEntry(entry)) return false;
        return true;
      });
    },
    staleTime: 60_000,
  });
}

/**
 * Roster entries for one employee, optionally narrowed to [from, to] (ISO dates).
 *
 * Always pass a range when the caller only cares about a window.  `rosters.date`
 * is a text column, so an unbounded `.order("date").limit(n)` sorts
 * lexicographically — legacy spellings such as "30-Jul-26" sort above every
 * canonical "2026-..." row, and a roster published weeks ahead pushes today off
 * the end of the page entirely.  That is how duties that exist in the table stop
 * reaching the employee's dashboard.
 */
export function useMyRoster(employeeName?: string, from?: string, to?: string) {
  const normalizedName = String(employeeName || "").trim();

  return useQuery({
    queryKey: ["my-roster", normalizedName, from ?? null, to ?? null],
    enabled: !!normalizedName,
    staleTime: 60_000,
    queryFn: async () => {
      let query = (supabase.from("rosters" as any) as any)
        .select("*")
        .ilike("employee_name", normalizedName);

      // Narrow windows are matched spelling-by-spelling so legacy rows still
      // hit; wider ones fall back to a range over the canonical ISO form.
      const dateValues = getRosterDateRangeQueryValues(from, to);
      if (dateValues.length > 0) {
        query = query.in("date", dateValues);
      } else if (from && to) {
        query = query.gte("date", from).lte("date", to);
      }

      const { data, error } = await query.order("date", { ascending: false }).limit(2000);
      if (error) throw error;
      return (data || []) as unknown as RosterEntry[];
    },
  });
}
