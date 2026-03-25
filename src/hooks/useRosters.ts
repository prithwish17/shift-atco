import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, parse } from "date-fns";

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

const ROSTER_DATE_FORMATS = [
  "dd-MMM-yyyy",
  "d-MMM-yyyy",
  "yyyy-MM-dd",
  "dd/MM/yyyy",
  "d/M/yyyy",
  "dd-MM-yyyy",
  "M/d/yyyy",
  "MM/dd/yyyy",
] as const;

function sanitizeFilterValue(value?: string) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.toLowerCase() === "all") return undefined;
  return normalized;
}

function normalizeRosterTeam(value?: string | null) {
  return String(value || "").trim().toUpperCase();
}

function normalizeRosterShift(value?: string | null) {
  return String(value || "").trim().toUpperCase();
}

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
    mutationFn: async ({ team, shift }: { team: string; shift: string }) => {
      const payload = { team, shift };

      const { data, error } = await supabase.functions.invoke("fetch-roster", {
        body: payload,
      });

      if (!error) {
        return ((data as { data?: RosterEntry[] } | null)?.data || []) as RosterEntry[];
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw error;

      const base =
        import.meta.env.DEV
          ? (import.meta.env.VITE_FUNCTIONS_PROXY_BASE_URL || "https://shift-atco.vercel.app")
          : window.location.origin;

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
        throw new Error(
          (errBody as { error?: string }).error ||
          error.message ||
          `Failed to fetch roster${contentType.includes("text/html") ? ": received HTML instead of JSON" : ""}`
        );
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
  const excludeSpecialEntries = !!filters?.excludeSpecialEntries;

  return useQuery({
    queryKey: ["rosters", teamFilter, shiftFilter, searchFilter, dateFilter, excludeSpecialEntries],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rosters" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000);

      if (error) throw error;

      const rows = ((data || []) as unknown as RosterEntry[]).filter((entry) => {
        if (teamFilter && normalizeRosterTeam(entry.team) !== normalizeRosterTeam(teamFilter)) {
          return false;
        }

        if (shiftFilter && normalizeRosterShift(entry.shift) !== normalizeRosterShift(shiftFilter)) {
          return false;
        }

        if (!matchesRosterDate(entry.date, dateFilter)) {
          return false;
        }

        if (!matchesRosterSearch(entry, searchFilter)) {
          return false;
        }

        if (excludeSpecialEntries && isSpecialRosterEntry(entry)) {
          return false;
        }

        return true;
      });

      return rows;
    },
    staleTime: 60_000,
  });
}

// Fetch roster entries for a specific employee by name
export function useMyRoster(employeeName?: string) {
  return useQuery({
    queryKey: ["my-roster", employeeName],
    enabled: !!employeeName,
    queryFn: async () => {
      const { data, error } = await (supabase.from("rosters" as any)
        .select("*")
        .ilike("employee_name", employeeName!)
        .order("date", { ascending: false })
        .limit(50));
      if (error) throw error;
      return (data || []) as unknown as RosterEntry[];
    },
  });
}
